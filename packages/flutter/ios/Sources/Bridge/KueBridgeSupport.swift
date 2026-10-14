import Foundation
import UIKit
import Flutter

struct KueBridgeFailure: Error {
    let code: String
    let retryable: Bool
    init(_ code: String, retryable: Bool = false) { self.code = code; self.retryable = retryable }
}

enum KueBridgeDTO {
    static func error(_ error: Error) -> [String: Any] {
        if let value = error as? KueError {
            var result: [String: Any] = ["code": value.code.rawValue, "retryable": value.retryable]
            if let status = value.status { result["status"] = status }
            if let code = value.serverCode { result["serverCode"] = code }
            if let delay = value.retryAfter {
                let milliseconds = (delay * 1000).rounded(.up)
                if milliseconds.isFinite, milliseconds >= 0, milliseconds <= 9_007_199_254_740_991 {
                    result["retryAfterMs"] = Int64(milliseconds)
                } else {
                    // Keep the native deadline; do not suggest an earlier Dart retry.
                    result["retryable"] = false
                }
            }
            return result
        }
        if let value = error as? KueBridgeFailure { return ["code": value.code, "retryable": value.retryable] }
        return ["code": error is CancellationError ? "request_cancelled" : "native_error", "retryable": false]
    }
    static func flutterError(_ error: Error) -> FlutterError {
        let details = Self.error(error)
        return FlutterError(code: details["code"] as? String ?? "native_error", message: "KUE native operation failed.", details: details)
    }
    static func receipt(_ value: KueReceipt) -> [String: Any] {
        var data: [String: Any] = ["clientReportId": value.clientReportId, "id": value.id, "status": value.status]
        if let token = value.receiptToken { data["receiptToken"] = token }
        return data
    }
    static func finding(_ value: KueFinding) throws -> [String: Any] {
        ["clientReportId": value.clientReportId, "memo": value.memo,
         "metadataJson": String(decoding: try value.metadata(), as: UTF8.self),
         "mediaBytes": FlutterStandardTypedData(bytes: value.mediaData)]
    }
    static func group(_ value: KueReportGroup) throws -> [String: Any] {
        ["clientReportId": value.clientReportId, "title": value.title, "findings": try value.findings.map(finding)]
    }
    static func features(_ value: KueProjectFeatures) -> [String: Any] {
        ["schemaVersion": 1, "groups": value.groups,
         "recording": ["entitled": value.recording.entitled, "available": value.recording.available]]
    }
    static func status(_ value: KueReportStatus) -> [String: Any] {
        var data: [String: Any] = ["id": value.id, "status": value.status, "githubIssue": NSNull()]
        if let issue = value.githubIssue { data["githubIssue"] = ["number": issue.number, "url": issue.url] }
        if let error = value.error { data["error"] = ["code": error.code] }
        return data
    }
    static func pending(_ value: KuePendingReport) -> [String: Any] {
        func milliseconds(_ date: Date) -> Int64 {
            // A server deadline can exceed Dart DateTime's representable range.
            // This display bound never changes the native retry deadline.
            Int64(max(-8_640_000_000_000_000, min(8_640_000_000_000_000, date.timeIntervalSince1970 * 1000)))
        }
        return ["clientReportId": value.clientReportId, "savedAt": milliseconds(value.savedAt),
                "nextAttemptAt": milliseconds(value.nextAttemptAt), "state": value.state,
                "currentDestination": value.currentDestination]
    }
    static func context(_ data: [String: Any]?) throws -> KueContextOverrides {
        let data = data ?? [:]
        func string(_ name: String, limit: Int) throws -> String? {
            guard let raw = data[name], !(raw is NSNull) else { return nil }
            guard let value = raw as? String, value.utf8.count <= limit, !value.contains("\0") else { throw KueBridgeFailure("invalid_config") }
            return value
        }
        func dimension(_ name: String) throws -> Double? {
            guard let raw = data[name], !(raw is NSNull) else { return nil }
            guard let value = raw as? NSNumber, value.doubleValue.isFinite, value.doubleValue > 0, value.doubleValue <= 100_000 else { throw KueBridgeFailure("invalid_config") }
            return value.doubleValue
        }
        return try KueContextOverrides(osVersion: string("osVersion", limit: 128), deviceModel: string("deviceModel", limit: 256),
            appVersion: string("appVersion", limit: 128), buildNumber: string("buildNumber", limit: 128), route: string("route", limit: 2048),
            screenWidth: dimension("screenWidth"), screenHeight: dimension("screenHeight"))
    }
}

struct KueBridgeConfiguration {
    let values: [String: Any]
    let fingerprint: Data
    let cloud: KueCloudConfiguration?
    let enabled: Bool, local: Bool, localGroup: Bool
    let handlerID: String?, groupHandlerID: String?
    let triggerIDs: [String]
    let timeout: TimeInterval
    init(_ values: [String: Any]) throws {
        self.values = values
        func flag(_ key: String, default fallback: Bool = false) throws -> Bool {
            guard let value = values[key], !(value is NSNull) else { return fallback }
            guard let result = value as? Bool else { throw KueBridgeFailure("invalid_config") }; return result
        }
        func id(_ key: String, required: Bool) throws -> String? {
            guard let value = values[key], !(value is NSNull) else { if required { throw KueBridgeFailure("invalid_config") }; return nil }
            guard let result = value as? String, !result.isEmpty, result.utf8.count <= 128 else { throw KueBridgeFailure("invalid_config") }; return result
        }
        enabled = try flag("enabled"); local = try flag("hasOnSubmit"); localGroup = try flag("hasOnSubmitGroup")
        handlerID = try id("handlerId", required: local); groupHandlerID = try id("groupHandlerId", required: localGroup)
        triggerIDs = values["triggerIds"] as? [String] ?? []
        guard triggerIDs.count <= 32, Set(triggerIDs).count == triggerIDs.count,
              triggerIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
              ["auto", "off"].contains(values["recording"] as? String ?? "auto"),
              ["ja", "en"].contains(values["locale"] as? String ?? "en"),
              ["classic", "mascot"].contains(values["buttonDesign"] as? String ?? "classic") else { throw KueBridgeFailure("invalid_config") }
        let timeoutMs = (values["callbackTimeoutMs"] as? NSNumber)?.doubleValue ?? 30_000
        guard timeoutMs.isFinite, timeoutMs > 0, timeoutMs <= 120_000 else { throw KueBridgeFailure("invalid_config") }
        timeout = timeoutMs / 1000
        if let data = values["cloud"] as? [String: Any] {
            guard let origin = data["apiBaseUrl"] as? String, let key = data["projectKey"] as? String else { throw KueBridgeFailure("invalid_config") }
            let milliseconds = (data["timeoutMs"] as? NSNumber)?.doubleValue ?? 15_000
            cloud = try KueCloudConfiguration(apiBaseURL: origin, projectKey: key, timeout: milliseconds / 1000,
                allowLocalhostHTTP: data["allowDevelopmentLocalhostHttp"] as? Bool ?? false)
        } else { cloud = nil }
        guard local || cloud != nil else { throw KueBridgeFailure("invalid_config") }
        if local { guard let label = values["submitLabel"] as? String, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw KueBridgeFailure("invalid_config") } }
        if localGroup {
            let label = (values["groupSubmitLabel"] as? String) ?? (values["submitLabel"] as? String) ?? ""
            guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw KueBridgeFailure("invalid_config") }
        }
        _ = try KueBridgeDTO.context(values["context"] as? [String: Any])
        var immutable: [String: Any] = [:]
        for key in ["cloud", "hasOnSubmit", "hasOnSubmitGroup", "handlerId", "groupHandlerId", "offlineQueue", "triggerIds", "callbackTimeoutMs"] {
            immutable[key] = values[key] ?? NSNull()
        }
        fingerprint = try JSONSerialization.data(withJSONObject: immutable, options: [.sortedKeys])
    }
}

/// One request completion, deadline and cancellation gate. No payload logging.
@MainActor final class KueBridgeRPC {
    private final class Pending {
        let continuation: CheckedContinuation<Any?, Error>
        let retire: (() -> Void)?
        var deadline: Task<Void, Never>?
        init(_ continuation: CheckedContinuation<Any?, Error>, retire: (() -> Void)?) { self.continuation = continuation; self.retire = retire }
    }
    private let channel: FlutterMethodChannel
    private var pending: [UUID: Pending] = [:]
    init(_ channel: FlutterMethodChannel) { self.channel = channel }
    func request(_ method: String, arguments: [String: Any], timeout: TimeInterval,
                 onRetire: (() -> Void)? = nil) async throws -> Any? {
        let id = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let value = Pending(continuation, retire: onRetire); pending[id] = value
                value.deadline = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64((timeout + 0.25) * 1_000_000_000))
                    guard !Task.isCancelled else { return }
                    self?.finish(id, result: .failure(KueError(code: .requestTimeout, retryable: true)), retire: true)
                }
                channel.invokeMethod(method, arguments: arguments) { [weak self] reply in
                    Task { @MainActor in
                        if let failure = reply as? FlutterError {
                            let details = failure.details as? [String: Any]
                            let code: KueError.Code
                            switch failure.code {
                            case "request_cancelled": code = .submissionCancelled
                            case "request_timeout": code = .requestTimeout
                            case "local_save_failed": code = .localSaveFailed
                            case "capture_unavailable", "capture_failed": code = .captureFailed
                            case "invalid_report": code = .invalidReport
                            default: code = method == "capture" ? .captureFailed : .localSaveFailed
                            }
                            self?.finish(id, result: .failure(KueError(code: code,
                                retryable: details?["retryable"] as? Bool ?? (code != .submissionCancelled))), retire: true)
                        } else if reply is NSObject, (reply as AnyObject) === FlutterMethodNotImplemented {
                            self?.finish(id, result: .failure(KueError(code: .invalidConfig)), retire: true)
                        } else { self?.finish(id, result: .success(reply), retire: false) }
                    }
                }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.finish(id, result: .failure(CancellationError()), retire: true) } })
    }
    private func finish(_ id: UUID, result: Result<Any?, Error>, retire: Bool) {
        guard let value = pending.removeValue(forKey: id) else { return }
        value.deadline?.cancel(); if retire { value.retire?() }; value.continuation.resume(with: result)
    }
    func cancelAll() { for id in Array(pending.keys) { finish(id, result: .failure(CancellationError()), retire: true) } }
}
