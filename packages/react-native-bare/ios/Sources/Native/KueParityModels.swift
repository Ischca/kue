import Foundation

public struct KueContextOverrides: Sendable {
    public var osVersion: String?, deviceModel: String?, appVersion: String?, buildNumber: String?, route: String?
    public var screenWidth: Double?, screenHeight: Double?
    public init(osVersion: String? = nil, deviceModel: String? = nil, appVersion: String? = nil,
                buildNumber: String? = nil, route: String? = nil, screenWidth: Double? = nil, screenHeight: Double? = nil) {
        self.osVersion = osVersion; self.deviceModel = deviceModel; self.appVersion = appVersion
        self.buildNumber = buildNumber; self.route = route; self.screenWidth = screenWidth; self.screenHeight = screenHeight
    }
    public func merging(_ overrides: Self) -> Self {
        Self(osVersion: overrides.osVersion ?? osVersion, deviceModel: overrides.deviceModel ?? deviceModel,
            appVersion: overrides.appVersion ?? appVersion, buildNumber: overrides.buildNumber ?? buildNumber,
            route: overrides.route ?? route, screenWidth: overrides.screenWidth ?? screenWidth,
            screenHeight: overrides.screenHeight ?? screenHeight)
    }
}
extension KueReportContext {
    public func merging(_ overrides: KueContextOverrides) -> Self {
        Self(platform: platform, osVersion: overrides.osVersion ?? osVersion, deviceModel: overrides.deviceModel ?? deviceModel,
            appVersion: overrides.appVersion ?? appVersion, buildNumber: overrides.buildNumber ?? buildNumber,
            screenWidth: overrides.screenWidth ?? screenWidth, screenHeight: overrides.screenHeight ?? screenHeight,
            route: overrides.route ?? route)
    }
}

public struct KueVideoReport: Codable, Sendable {
    public let clientReportId: String, memo: String
    public let videoData: Data
    public let durationMs: Int, outputSize: KueImageSize
    public let context: KueReportContext, capturedAt: Date
    public init(clientReportId: String = UUID().uuidString, memo: String, videoData: Data, durationMs: Int,
                outputSize: KueImageSize, context: KueReportContext, capturedAt: Date = Date()) throws {
        let memo = memo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clientReportId.range(of: "^[A-Za-z0-9._~-]{16,128}$", options: .regularExpression) != nil,
              !memo.isEmpty, !memo.contains("\0"), memo.utf8.count <= 4096, outputSize.isValid, context.isValid,
              durationMs > 0, durationMs <= 60_000, videoData.count >= 12, videoData.count <= 20 * 1024 * 1024,
              videoData.subdata(in: 4..<8) == Data("ftyp".utf8), capturedAt.timeIntervalSince1970.isFinite else {
            throw KueError(code: .invalidReport)
        }
        self.clientReportId = clientReportId; self.memo = memo; self.videoData = videoData; self.durationMs = durationMs
        self.outputSize = outputSize; self.context = context; self.capturedAt = capturedAt
    }
    public func metadata() throws -> Data {
        let capture: [String: Any] = ["capturedAt": ISO8601DateFormatter().string(from: capturedAt), "kind": "video",
            "durationMs": durationMs, "outputSize": ["width": outputSize.width, "height": outputSize.height], "mimeType": "video/mp4"]
        return try JSONSerialization.data(withJSONObject: ["schemaVersion": 2,
            "context": JSONSerialization.jsonObject(with: JSONEncoder().encode(context)), "capture": capture], options: [.sortedKeys])
    }
    func validateStored() throws {
        _ = try KueVideoReport(clientReportId: clientReportId, memo: memo, videoData: videoData,
            durationMs: durationMs, outputSize: outputSize, context: context, capturedAt: capturedAt)
    }
}
public enum KueFinding: Codable, Sendable {
    case screenshot(KueReport), video(KueVideoReport)
    public var clientReportId: String { switch self { case .screenshot(let r): return r.clientReportId; case .video(let r): return r.clientReportId } }
    public var memo: String { switch self { case .screenshot(let r): return r.memo; case .video(let r): return r.memo } }
    public var mediaData: Data { switch self { case .screenshot(let r): return r.imageData; case .video(let r): return r.videoData } }
    public var mimeType: String { switch self { case .screenshot(let r): return r.mimeType; case .video: return "video/mp4" } }
    public var isVideo: Bool { if case .video = self { return true }; return false }
    public func metadata() throws -> Data { switch self { case .screenshot(let r): return try r.metadata(); case .video(let r): return try r.metadata() } }
}
public struct KueReportGroup: Codable, Sendable {
    public let clientReportId: String, title: String
    public let findings: [KueFinding]
    let multipartBoundary: String
    public init(clientReportId: String = UUID().uuidString, title: String, findings: [KueFinding]) throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clientReportId.range(of: "^[A-Za-z0-9._~-]{16,128}$", options: .regularExpression) != nil,
              !title.isEmpty, title.unicodeScalars.count <= 200, !title.contains("\n"), !title.contains("\r"), !title.contains("\0"),
              (1...10).contains(findings.count), findings.reduce(0, { $0 + $1.mediaData.count }) <= 20 * 1024 * 1024 else {
            throw KueError(code: .invalidReport)
        }
        self.clientReportId = clientReportId; self.title = title; self.findings = findings
        for finding in findings { switch finding { case .screenshot(let report): try report.validateStored(); case .video(let report): try report.validateStored() } }
        multipartBoundary = "Kue_" + UUID().uuidString
        guard try manifest().count <= 48 * 1024 else { throw KueError(code: .invalidReport) }
    }
    public func manifest() throws -> Data {
        let values = try findings.map { ["memo": $0.memo, "metadata": try JSONSerialization.jsonObject(with: $0.metadata())] }
        return try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "title": title, "findings": values], options: [.sortedKeys])
    }
    func validateStored() throws {
        _ = try KueReportGroup(clientReportId: clientReportId, title: title, findings: findings)
        guard multipartBoundary.range(of: "^Kue_[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil else { throw KueError(code: .invalidReport) }
    }
}
struct KueGroupDraft {
    private(set) var findings: [KueFinding] = []
    private(set) var prepared: KueReportGroup?
    var locked: Bool { prepared != nil }
    var full: Bool { findings.count >= 10 }
    mutating func add(_ finding: KueFinding) throws {
        guard !locked else { throw KueError(code: .draftLocked) }
        if findings.contains(where: { $0.clientReportId == finding.clientReportId }) { return }
        guard !full, findings.reduce(finding.mediaData.count, { $0 + $1.mediaData.count }) <= 20 * 1024 * 1024 else { throw KueError(code: .invalidReport) }
        findings.append(finding)
    }
    mutating func remove(_ id: String) throws {
        guard !locked else { throw KueError(code: .draftLocked) }; findings.removeAll { $0.clientReportId == id }
    }
    mutating func prepare(title: String) throws -> KueReportGroup {
        if let prepared { return prepared }
        let group = try KueReportGroup(title: title, findings: findings); prepared = group; return group
    }
}
public struct KueProjectFeatures: Codable, Equatable, Sendable {
    public struct Recording: Codable, Equatable, Sendable { public let entitled: Bool, available: Bool }
    public let groups: Bool, recording: Recording
}
public struct KueReportStatus: Codable, Equatable, Sendable {
    public struct GitHubIssue: Codable, Equatable, Sendable { public let number: Int, url: String }
    public struct Failure: Codable, Equatable, Sendable { public let code: String }
    public let id: String, status: String
    public let githubIssue: GitHubIssue?, error: Failure?
}
public enum KueRecordingMode: String { case auto, off }
public enum KueRecordingAvailability: String {
    case off, cloudRequired = "cloud_required", checking, checkFailed = "check_failed", upgrade, unavailable, rebuild, ready
    static func resolve(mode: KueRecordingMode, hasCloud: Bool, features: KueProjectFeatures?, failed: Bool, nativeAvailable: Bool) -> Self {
        if mode == .off { return .off }; if !hasCloud { return .cloudRequired }
        guard let features else { return failed ? .checkFailed : .checking }
        if !features.recording.entitled { return .upgrade }; if !features.recording.available { return .unavailable }
        return nativeAvailable ? .ready : .rebuild
    }
}
