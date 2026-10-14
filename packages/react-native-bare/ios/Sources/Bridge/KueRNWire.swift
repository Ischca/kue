import Foundation
import CoreFoundation

struct KueRNFailure: Error {
    let code: String, retryable: Bool
    init(_ code: String, retryable: Bool = false) { self.code = code; self.retryable = retryable }
}

enum KueRNWire {
    static let maximumJSON = 128 * 1024
    static func parse(_ text: String) throws -> [String: Any] {
        let data = Data(text.utf8)
        guard !data.isEmpty, data.count <= maximumJSON,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              try number(value, "schemaVersion") == 1 else { throw KueRNFailure("invalid_config") }
        try validate(value, depth: 0); return value
    }
    private static func validate(_ value: Any, depth: Int) throws {
        guard depth <= 32 else { throw KueRNFailure("invalid_config") }
        if let number = value as? NSNumber, !number.doubleValue.isFinite { throw KueRNFailure("invalid_config") }
        if let object = value as? [String: Any] { for child in object.values { try validate(child, depth: depth + 1) } }
        else if let array = value as? [Any] { for child in array { try validate(child, depth: depth + 1) } }
    }
    static func json(_ object: [String: Any]) throws -> String {
        try validate(object, depth: 0)
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= maximumJSON else { throw KueRNFailure("invalid_config") }
        return String(decoding: data, as: UTF8.self)
    }
    static func ok(_ value: Any? = nil) -> String {
        (try? json(["schemaVersion": 1, "ok": true, "value": value ?? NSNull()])) ?? failure(KueRNFailure("native_error"))
    }
    static func failure(_ error: Error) -> String {
        // Known sanitized codes only; no error descriptions, file paths or capability URLs.
        (try? json(["schemaVersion": 1, "ok": false, "error": Self.error(error)])) ?? "{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"native_error\",\"retryable\":false}}"
    }
    static func error(_ error: Error) -> [String: Any] {
        if let value = error as? KueError {
            var result: [String: Any] = ["code": value.code.rawValue, "retryable": value.retryable]
            if let status = value.status { result["httpStatus"] = status }
            if let code = value.serverCode { result["serverCode"] = code }
            if let delay = value.retryAfter {
                if delay.isFinite, delay >= 0, delay <= 9_007_199_254_740_991.0 / 1000 { result["retryAfterSeconds"] = delay }
                else { result["retryable"] = false }
            }
            return result
        }
        if let value = error as? KueRNFailure { return ["code": value.code, "retryable": value.retryable] }
        return ["code": error is CancellationError ? "request_cancelled" : "native_error", "retryable": false]
    }
    static func id(_ value: String) throws -> String {
        guard (1...128).contains(value.utf8.count), value.range(of: "^[A-Za-z0-9._:~-]+$", options: .regularExpression) != nil else { throw KueRNFailure("invalid_config") }
        return value
    }
    static func string(_ data: [String: Any], _ key: String, fallback: String? = nil) throws -> String {
        guard let raw = data[key], !(raw is NSNull) else {
            if let fallback { return fallback }; throw KueRNFailure("invalid_config")
        }
        guard let value = raw as? String else { throw KueRNFailure("invalid_config") }; return value
    }
    static func flag(_ data: [String: Any], _ key: String, fallback: Bool = false) throws -> Bool {
        guard let raw = data[key], !(raw is NSNull) else { return fallback }
        guard let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw KueRNFailure("invalid_config") }
        return number.boolValue
    }
    static func number(_ data: [String: Any], _ key: String, fallback: Double? = nil) throws -> Double {
        guard let raw = data[key], !(raw is NSNull) else {
            if let fallback { return fallback }; throw KueRNFailure("invalid_config")
        }
        guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { throw KueRNFailure("invalid_config") }
        return value.doubleValue
    }
    static func integer(_ data: [String: Any], _ key: String, maximum: Int, fallback: Int? = nil) throws -> Int {
        let value = try number(data, key, fallback: fallback.map(Double.init))
        guard value >= 0, value <= Double(maximum), value.rounded(.towardZero) == value else { throw KueRNFailure("invalid_config") }
        return Int(value)
    }
    static func object(_ data: [String: Any], _ key: String) throws -> [String: Any] {
        guard let value = data[key] as? [String: Any] else { throw KueRNFailure("invalid_config") }; return value
    }
    static func optionalObject(_ data: [String: Any], _ key: String) throws -> [String: Any]? {
        guard let raw = data[key], !(raw is NSNull) else { return nil }
        guard let value = raw as? [String: Any] else { throw KueRNFailure("invalid_config") }; return value
    }
    static func explicitFalse(_ data: [String: Any], _ key: String) -> Bool {
        guard let raw = data[key] as? NSNumber, CFGetTypeID(raw) == CFBooleanGetTypeID() else { return false }
        return !raw.boolValue
    }
    static func context(_ data: [String: Any]?, allowPlatform: Bool = false) throws -> KueContextOverrides {
        let data = data ?? [:]
        guard allowPlatform || !data.keys.contains("platform") else { throw KueRNFailure("invalid_config") }
        func bounded(_ key: String, _ maximum: Int) throws -> String? {
            if data[key] == nil || data[key] is NSNull { return nil }
            let value = try string(data, key)
            guard value.utf8.count <= maximum, !value.contains("\0") else { throw KueRNFailure("invalid_config") }; return value
        }
        func dimension(_ key: String) throws -> Double? {
            if data[key] == nil || data[key] is NSNull { return nil }
            let value = try number(data, key); guard value > 0, value <= 100_000 else { throw KueRNFailure("invalid_config") }; return value
        }
        return try KueContextOverrides(osVersion: bounded("osVersion", 128), deviceModel: bounded("deviceModel", 256),
            appVersion: bounded("appVersion", 128), buildNumber: bounded("buildNumber", 128), route: bounded("route", 2048),
            screenWidth: dimension("screenWidth"), screenHeight: dimension("screenHeight"))
    }
    static func cloud(_ data: [String: Any], statusOnly: Bool = false) throws -> KueCloudConfiguration {
        try KueCloudConfiguration(apiBaseURL: string(data, "apiBaseUrl"),
            projectKey: statusOnly ? "pk_local_status_placeholder" : string(data, "projectKey"),
            timeout: number(data, "timeoutMs", fallback: 15_000) / 1000,
            allowLocalhostHTTP: flag(data, "allowDevelopmentLocalhostHttp"))
    }
    static func date(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = formatter.date(from: value) { return result }
        formatter.formatOptions = [.withInternetDateTime]
        guard let result = formatter.date(from: value) else { throw KueRNFailure("invalid_config") }; return result
    }
    static func iso(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter.string(from: value)
    }
    static func receipt(_ value: KueReceipt) -> [String: Any] {
        var result: [String: Any] = ["clientReportId": value.clientReportId, "id": value.id, "status": value.status]
        if let token = value.receiptToken { result["receiptToken"] = token }; return result
    }
    static func receipt(_ data: [String: Any]) throws -> KueReceipt {
        try KueReceipt(clientReportId: string(data, "clientReportId", fallback: "receipt_00000000"), id: string(data, "id"),
            status: string(data, "status", fallback: "received"), receiptToken: data["receiptToken"] as? String)
    }
    static func features(_ value: KueProjectFeatures) -> [String: Any] {
        ["schemaVersion": 1, "groups": value.groups, "recording": ["entitled": value.recording.entitled, "available": value.recording.available]]
    }
    static func status(_ value: KueReportStatus) -> [String: Any] {
        var result: [String: Any] = ["id": value.id, "status": value.status, "githubIssue": NSNull()]
        if let issue = value.githubIssue { result["githubIssue"] = ["number": issue.number, "url": issue.url] }
        if let error = value.error { result["error"] = ["code": error.code] }; return result
    }
    static func pending(_ value: KuePendingReport) -> [String: Any] {
        func milliseconds(_ date: Date) -> Double { max(-8_640_000_000_000_000, min(8_640_000_000_000_000, date.timeIntervalSince1970 * 1000)) }
        return ["clientReportId": value.clientReportId, "savedAt": milliseconds(value.savedAt), "nextAttemptAt": milliseconds(value.nextAttemptAt),
                "state": value.state, "currentDestination": value.currentDestination, "attempts": value.attempts]
    }
    static func finding(_ value: KueFinding, uri: String) throws -> [String: Any] {
        guard let metadata = try JSONSerialization.jsonObject(with: value.metadata()) as? [String: Any],
              let capture = metadata["capture"] as? [String: Any], let context = metadata["context"] else { throw KueRNFailure("invalid_report") }
        var result: [String: Any] = ["clientReportId": value.clientReportId, "memo": value.memo, "context": context, "capturedAt": iso({
            switch value { case .screenshot(let report): return report.capturedAt; case .video(let report): return report.capturedAt }
        }())]
        switch value {
        case .screenshot(let report):
            result["crop"] = capture["crop"]; result["sourceSize"] = capture["sourceSize"]
            result["screenshot"] = ["uri": uri, "width": report.outputSize.width, "height": report.outputSize.height, "mimeType": report.mimeType]
        case .video(let report):
            result["video"] = ["uri": uri, "width": report.outputSize.width, "height": report.outputSize.height, "mimeType": "video/mp4",
                               "durationMs": report.durationMs, "byteSize": report.videoData.count, "capturedAt": iso(report.capturedAt)]
        }
        return result
    }
}

struct KueRNConfiguration {
    let values: [String: Any], fingerprint: Data, cloud: KueCloudConfiguration?
    let enabled: Bool, local: Bool, localGroup: Bool, adapter: Bool
    let mountOrder: Int
    let handlerID: String?, groupHandlerID: String?, adapterID: String?, triggerIDs: [String], timeout: TimeInterval
    init(_ values: [String: Any]) throws {
        self.values = values; mountOrder = try KueRNWire.integer(values, "mountOrder", maximum: 2_147_483_647)
        guard mountOrder > 0 else { throw KueRNFailure("invalid_config") }
        enabled = try KueRNWire.flag(values, "enabled")
        local = try KueRNWire.flag(values, "hasOnSubmit"); localGroup = try KueRNWire.flag(values, "hasOnSubmitGroup")
        adapter = try KueRNWire.flag(values, "hasCaptureAdapter")
        func identifier(_ key: String, required: Bool) throws -> String? {
            if values[key] == nil || values[key] is NSNull { if required { throw KueRNFailure("invalid_config") }; return nil }
            return try KueRNWire.id(KueRNWire.string(values, key))
        }
        handlerID = try identifier("handlerId", required: local); groupHandlerID = try identifier("groupHandlerId", required: localGroup)
        adapterID = try identifier("captureAdapterId", required: adapter)
        if let raw = values["triggerIds"] { guard let ids = raw as? [String], ids.count <= 32 else { throw KueRNFailure("invalid_config") }; triggerIDs = try ids.map(KueRNWire.id) }
        else { triggerIDs = [] }
        guard Set(triggerIDs).count == triggerIDs.count,
              ["auto", "off"].contains(try KueRNWire.string(values, "recording", fallback: "auto")),
              ["ja", "en"].contains(try KueRNWire.string(values, "locale", fallback: "en")),
              ["classic", "mascot"].contains(try KueRNWire.string(values, "buttonDesign", fallback: "classic")) else { throw KueRNFailure("invalid_config") }
        timeout = try KueRNWire.number(values, "callbackTimeoutMs", fallback: 30_000) / 1000
        guard timeout > 0, timeout <= 120 else { throw KueRNFailure("invalid_config") }
        if let raw = values["cloud"], !(raw is NSNull) { guard let data = raw as? [String: Any] else { throw KueRNFailure("invalid_config") }; cloud = try KueRNWire.cloud(data) }
        else { cloud = nil }
        guard local || cloud != nil else { throw KueRNFailure("invalid_config") }
        if local { guard !(try KueRNWire.string(values, "submitLabel")).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw KueRNFailure("invalid_config") } }
        if localGroup { guard !(try KueRNWire.string(values, "groupSubmitLabel", fallback: values["submitLabel"] as? String)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw KueRNFailure("invalid_config") } }
        _ = try KueRNWire.context(KueRNWire.optionalObject(values, "context"))
        var immutable: [String: Any] = [:]
        for key in ["mountOrder", "cloud", "hasOnSubmit", "hasOnSubmitGroup", "handlerId", "groupHandlerId", "offlineQueue", "hasCaptureAdapter", "captureAdapterId", "triggerIds", "callbackTimeoutMs"] { immutable[key] = values[key] ?? NSNull() }
        fingerprint = try JSONSerialization.data(withJSONObject: immutable, options: [.sortedKeys])
    }
}
