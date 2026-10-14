import Foundation
import CryptoKit

public struct KuePendingReport: Equatable, Sendable {
    public let clientReportId: String, savedAt: Date, nextAttemptAt: Date
    public let state: String, currentDestination: Bool
    public let attempts: Int
}
public enum KueOutboxResult: Sendable { case accepted(KueReceipt), queued(String) }

/// Durable single-image reports only. No destination retargeting, group/video conversion or background service.
public actor KueOutbox {
    public static let shared = KueOutbox()
    public static let maxCount = 10, maxBytes = 50 * 1024 * 1024
    public static let retention: TimeInterval = 7 * 86_400
    private struct State: Codable { var attempts = 0; var nextAttemptAt = Date(timeIntervalSince1970: 0); var state = "pending" }
    private struct Entry: Codable { let report: KueReport, destination: String, savedAt: Date }
    private let directory: URL
    private let clock: @Sendable () -> Date
    private var running: [String: Task<KueOutboxResult, Error>] = [:]
    private var flushing = Set<String>()
    public init(directory: URL? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("kue-outbox-v1", isDirectory: true)
        clock = now
    }
    static func destination(_ config: KueCloudConfiguration) -> String {
        SHA256.hash(data: Data((config.endpoint.absoluteString + "\n" + config.projectKey).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func item(_ id: String) throws -> URL {
        guard id.range(of: "^[A-Za-z0-9._~-]{16,128}$", options: .regularExpression) != nil else { throw KueError(code: .invalidReport) }
        let url = directory.appendingPathComponent("item-" + id, isDirectory: true)
        if (try? FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeSymbolicLink { throw KueError(code: .storageUnreadable) }
        if FileManager.default.fileExists(atPath: url.path) {
            let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true, values.isDirectory == true else { throw KueError(code: .storageUnreadable) }
        }
        return url
    }
    private func ensureDirectory() throws {
        if (try? FileManager.default.attributesOfItem(atPath: directory.path)[.type] as? FileAttributeType) == .typeSymbolicLink { throw KueError(code: .storageUnreadable) }
        if FileManager.default.fileExists(atPath: directory.path) {
            guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw KueError(code: .storageUnreadable) }
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw KueError(code: .storageUnreadable) }
        var root = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try? root.setResourceValues(values)
    }
    private func entries() throws -> [Entry] {
        try ensureDirectory()
        let children = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        var result: [Entry] = []
        for child in children where child.lastPathComponent.hasPrefix("item-") {
            let id = String(child.lastPathComponent.dropFirst(5))
            let values = try child.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isDirectory == true, values.isSymbolicLink != true, (try? item(id)) != nil else { continue }
            let marker = child.appendingPathComponent("report.json")
            if !FileManager.default.fileExists(atPath: marker.path) { try FileManager.default.removeItem(at: child); continue }
            let markerValues = try marker.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard markerValues.isSymbolicLink != true, (markerValues.fileSize ?? Int.max) <= 15 * 1024 * 1024,
                  let entry = try? JSONDecoder().decode(Entry.self, from: Data(contentsOf: marker)),
                  entry.report.clientReportId == id, entry.savedAt.timeIntervalSince1970.isFinite,
                  entry.destination.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw KueError(code: .storageUnreadable) }
            try entry.report.validateStored()
            if clock().timeIntervalSince(entry.savedAt) > Self.retention && running[id] == nil {
                try FileManager.default.removeItem(at: child)
            } else { result.append(entry) }
        }
        return result.sorted { $0.savedAt < $1.savedAt }
    }
    private func state(_ id: String) throws -> State {
        let file = try item(id).appendingPathComponent("state.json")
        if (try? FileManager.default.attributesOfItem(atPath: file.path)[.type] as? FileAttributeType) == .typeSymbolicLink { throw KueError(code: .storageUnreadable) }
        if FileManager.default.fileExists(atPath: file.path) {
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard values.isSymbolicLink != true, (values.fileSize ?? Int.max) <= 2048 else { throw KueError(code: .storageUnreadable) }
        }
        // Immutable report.json survives interrupted retry-state replacement.
        guard let bytes = try? Data(contentsOf: file), bytes.count <= 2048,
              let value = try? JSONDecoder().decode(State.self, from: bytes), (0...1_000_000).contains(value.attempts),
              value.nextAttemptAt.timeIntervalSince1970.isFinite, ["pending", "blocked"].contains(value.state) else { return State() }
        return value
    }
    public func pending(config: KueCloudConfiguration, includeOtherDestinations: Bool = false) throws -> [KuePendingReport] {
        let destination = Self.destination(config)
        return try entries().filter { includeOtherDestinations || $0.destination == destination }.map {
            let value = try state($0.report.clientReportId)
            return KuePendingReport(clientReportId: $0.report.clientReportId, savedAt: $0.savedAt,
                nextAttemptAt: value.nextAttemptAt, state: value.state, currentDestination: $0.destination == destination, attempts: value.attempts)
        }
    }
    public func discard(id: String, config: KueCloudConfiguration? = nil) throws {
        guard running[id] == nil else { throw KueError(code: .busy) }
        guard let entry = try entries().first(where: { $0.report.clientReportId == id }) else { return }
        if let config, entry.destination != Self.destination(config) { throw KueError(code: .destinationChanged) }
        try FileManager.default.removeItem(at: item(id))
    }
    public func submit(_ report: KueReport, config: KueCloudConfiguration,
                       send: (@Sendable (KueReport) async throws -> KueReceipt)? = nil) async throws -> KueOutboxResult {
        let all = try entries(); let destination = Self.destination(config)
        let entry: Entry
        if let existing = all.first(where: { $0.report.clientReportId == report.clientReportId }) {
            guard existing.destination == destination else { throw KueError(code: .destinationChanged) }
            let old = existing.report
            guard old.memo == report.memo, old.imageData == report.imageData, old.crop == report.crop,
                  old.mimeType == report.mimeType, old.sourceSize == report.sourceSize, old.outputSize == report.outputSize,
                  old.context == report.context, old.capturedAt == report.capturedAt else { throw KueError(code: .invalidReport) }
            entry = existing
        } else {
            try report.validateStored()
            guard all.count < Self.maxCount, all.reduce(report.imageData.count, { $0 + $1.report.imageData.count }) <= Self.maxBytes else { throw KueError(code: .outboxFull) }
            entry = Entry(report: report, destination: destination, savedAt: clock())
            let folder = try item(report.clientReportId); try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try JSONEncoder().encode(entry).write(to: folder.appendingPathComponent("report.json"), options: [.atomic])
        }
        return try await deliver(entry, send: send ?? { try await KueCloudClient(configuration: config).submit($0) })
    }
    private func deliver(_ entry: Entry, send: @escaping @Sendable (KueReport) async throws -> KueReceipt) async throws -> KueOutboxResult {
        let id = entry.report.clientReportId
        if let existing = running[id] { return try await existing.value }
        let operation = Task<KueOutboxResult, Error> {
            do {
                let receipt = try await send(entry.report)
                try? FileManager.default.removeItem(at: item(id))
                return .accepted(receipt)
            } catch {
                var value = try state(id); value.attempts = min(value.attempts + 1, 1_000_000)
                let failure = error as? KueError
                let retryable = failure?.retryable == true || error is CancellationError
                value.state = retryable ? "pending" : "blocked"
                let backoff = min(3600, 30 * pow(2, Double(min(value.attempts - 1, 7))))
                value.nextAttemptAt = clock().addingTimeInterval(max(backoff, failure?.retryAfter ?? 0))
                try JSONEncoder().encode(value).write(to: item(id).appendingPathComponent("state.json"), options: [.atomic])
                if error is CancellationError { throw error }
                if !retryable { throw error }
                return .queued(id)
            }
        }
        running[id] = operation; defer { running[id] = nil }
        return try await withTaskCancellationHandler(operation: { try await operation.value }, onCancel: { operation.cancel() })
    }
    /// Foreground caller schedules this; force bypasses blocked/backoff but never changes destination.
    public func retryPending(config: KueCloudConfiguration, force: Bool = false,
        active: @escaping @Sendable () async -> Bool = { true },
        send: (@Sendable (KueReport) async throws -> KueReceipt)? = nil,
        onReceipt: (@Sendable (KueReceipt) async -> Void)? = nil, onError: (@Sendable (KueError) async -> Void)? = nil) async throws {
        let destination = Self.destination(config); guard !flushing.contains(destination) else { return }
        flushing.insert(destination); defer { flushing.remove(destination) }
        for snapshot in try entries().filter({ $0.destination == destination }) {
            guard await active(), !Task.isCancelled else { break }
            guard let entry = try entries().first(where: { $0.report.clientReportId == snapshot.report.clientReportId }) else { continue }
            let value = try state(entry.report.clientReportId)
            if !force && (value.state == "blocked" || value.nextAttemptAt > clock()) { continue }
            do {
                let result = try await deliver(entry, send: send ?? { try await KueCloudClient(configuration: config).submit($0) })
                if case .accepted(let receipt) = result, !Task.isCancelled { await onReceipt?(receipt) }
            } catch is CancellationError { break }
            catch { await onError?(error as? KueError ?? KueError(code: .storageUnreadable)) }
        }
    }
}
