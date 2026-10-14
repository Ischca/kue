import Foundation

public struct KueCrop: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public static let full = KueCrop(x: 0, y: 0, width: 1, height: 1)
    var isValid: Bool {
        [x, y, width, height].allSatisfy(\.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 &&
        x + width <= 1 && y + height <= 1
    }
}

public struct KueImageSize: Codable, Equatable, Sendable {
    public let width: Int
    public let height: Int
    public init(width: Int, height: Int) { self.width = width; self.height = height }
    var isValid: Bool { width > 0 && height > 0 && width <= 100_000 && height <= 100_000 }
}

/// OS/device model metadata only. No device name, identifier, account, or location is collected.
public struct KueReportContext: Codable, Equatable, Sendable {
    public let platform: String
    public let osVersion: String?
    public let deviceModel: String?
    public let appVersion: String?
    public let buildNumber: String?
    public let screenWidth: Double?
    public let screenHeight: Double?
    public let route: String?
    public init(platform: String = "ios", osVersion: String? = nil, deviceModel: String? = nil,
                appVersion: String? = nil, buildNumber: String? = nil, screenWidth: Double? = nil,
                screenHeight: Double? = nil, route: String? = nil) {
        self.platform = platform; self.osVersion = osVersion; self.deviceModel = deviceModel
        self.appVersion = appVersion; self.buildNumber = buildNumber; self.screenWidth = screenWidth
        self.screenHeight = screenHeight; self.route = route
    }
    var isValid: Bool {
        guard platform == "ios" || platform == "android" else { return false }
        for (value, limit) in [(osVersion, 128), (deviceModel, 256), (appVersion, 128), (buildNumber, 128), (route, 2048)] {
            if let value, value.utf8.count > limit { return false }
        }
        return [screenWidth, screenHeight].allSatisfy { $0 == nil || ($0!.isFinite && $0! > 0 && $0! <= 100_000) }
    }
}

/// Immutable prepared payload. Retain this value for a retry; changing a memo/crop requires a new report.
public struct KueReport: Codable, Sendable {
    public let clientReportId: String
    public let memo: String
    public let crop: KueCrop
    public let imageData: Data
    public let mimeType: String
    public let sourceSize: KueImageSize
    public let outputSize: KueImageSize
    public let context: KueReportContext
    public let capturedAt: Date
    // MIME boundaries have a stricter alphabet/length limit than public report IDs.
    let multipartBoundary: String

    public init(clientReportId: String = UUID().uuidString, memo: String, crop: KueCrop,
                imageData: Data, mimeType: String = "image/png", sourceSize: KueImageSize,
                outputSize: KueImageSize, context: KueReportContext, capturedAt: Date = Date()) throws {
        let memo = memo.trimmingCharacters(in: .whitespacesAndNewlines)
        let png = imageData.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        let jpeg = imageData.starts(with: [0xff, 0xd8, 0xff])
        guard clientReportId.range(of: "^[A-Za-z0-9._~-]{16,128}$", options: .regularExpression) != nil,
              !memo.isEmpty, !memo.contains("\0"), memo.utf8.count <= 4096,
              crop.isValid, sourceSize.isValid, outputSize.isValid, context.isValid,
              !imageData.isEmpty, imageData.count <= 10 * 1024 * 1024,
              capturedAt.timeIntervalSince1970.isFinite,
              (mimeType == "image/png" && png) || (mimeType == "image/jpeg" && jpeg) else {
            throw KueError(code: .invalidReport)
        }
        self.clientReportId = clientReportId; self.memo = memo; self.crop = crop; self.imageData = imageData
        self.mimeType = mimeType; self.sourceSize = sourceSize; self.outputSize = outputSize
        self.context = context; self.capturedAt = capturedAt
        self.multipartBoundary = "Kue_" + UUID().uuidString
    }

    public func metadata() throws -> Data {
        struct Capture: Encodable {
            let capturedAt: String; let crop: KueCrop; let sourceSize: KueImageSize
            let outputSize: KueImageSize; let mimeType: String
        }
        struct Metadata: Encodable { let schemaVersion = 1; let context: KueReportContext; let capture: Capture }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(Metadata(context: context, capture: Capture(capturedAt: formatter.string(from: capturedAt),
            crop: crop, sourceSize: sourceSize, outputSize: outputSize, mimeType: mimeType)))
    }
    func validateStored() throws {
        _ = try KueReport(clientReportId: clientReportId, memo: memo, crop: crop, imageData: imageData,
            mimeType: mimeType, sourceSize: sourceSize, outputSize: outputSize, context: context, capturedAt: capturedAt)
        guard multipartBoundary.range(of: "^Kue_[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil else { throw KueError(code: .invalidReport) }
    }
}

public struct KueReceipt: Codable, Equatable, Sendable {
    public let clientReportId: String
    public let id: String
    public let status: String
    /// Secret read capability. Do not log this value or attach it to an Issue.
    public let receiptToken: String?
    public init(clientReportId: String, id: String, status: String, receiptToken: String? = nil) {
        self.clientReportId = clientReportId; self.id = id; self.status = status; self.receiptToken = receiptToken
    }
}

public struct KueError: Error, LocalizedError, Sendable {
    public enum Code: String, Sendable {
        case invalidConfig = "invalid_config", invalidReport = "invalid_report"
        case networkError = "network_error", requestTimeout = "request_timeout", localSaveFailed = "local_save_failed"
        case unexpectedResponse = "unexpected_response", uploadRejected = "upload_rejected"
        case disabled, busy, captureFailed = "capture_failed", submissionCancelled = "submission_cancelled"
        case outboxFull = "outbox_full", destinationChanged = "destination_changed", draftLocked = "draft_locked"
        case recordingUnavailable = "recording_unavailable", recordingNeedsCloud = "recording_needs_cloud"
        case recordingNeedsIndie = "recording_needs_indie", recordingVerificationFailed = "recording_verification_failed"
        case recorderMissing = "recorder_missing", recordingFailed = "recording_failed", storageUnreadable = "storage_unreadable"
    }
    public let code: Code
    public let status: Int?
    public let serverCode: String?
    public let retryable: Bool
    public let retryAfter: TimeInterval?
    public init(code: Code, status: Int? = nil, serverCode: String? = nil,
                retryable: Bool = false, retryAfter: TimeInterval? = nil) {
        self.code = code; self.status = status; self.serverCode = serverCode
        self.retryable = retryable; self.retryAfter = retryAfter
    }
    public var errorDescription: String? { "KUE: \(code.rawValue)" + (status.map { " (HTTP \($0))" } ?? "") }
    /// Unknown local callback failures carry no callback message or network assumption.
    static func localCallbackFailure(_ error: Error) -> Error {
        if error is CancellationError { return error }
        return error as? KueError ?? KueError(code: .localSaveFailed, retryable: true)
    }
}
