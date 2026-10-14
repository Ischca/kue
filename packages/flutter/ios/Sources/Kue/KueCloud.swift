import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct KueCloudConfiguration: Sendable {
    public let endpoint: URL
    public let projectKey: String
    public let timeout: TimeInterval
    /// Same dashboard path used by Expo's explicit plan action; contains no project key.
    var plansURL: URL { endpoint.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("app") }
    /// HTTPS origin only. Explicit development opt-in permits HTTP loopback, never a remote host.
    public init(apiBaseURL: String, projectKey: String, timeout: TimeInterval = 15,
                allowLocalhostHTTP: Bool = false) throws {
        let key = projectKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.range(of: "^pk_[A-Za-z0-9_-]{8,128}$", options: .regularExpression) != nil,
              let parts = URLComponents(string: apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/", parts.url != nil,
              timeout.isFinite, timeout > 0, timeout <= 120 else { throw KueError(code: .invalidConfig) }
        let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
        #if DEBUG
        let development = true
        #else
        let development = false
        #endif
        guard scheme == "https" || (development && allowLocalhostHTTP && scheme == "http" && loopback) else {
            throw KueError(code: .invalidConfig)
        }
        var origin = parts; origin.path = "/v1/reports"
        guard let endpoint = origin.url else { throw KueError(code: .invalidConfig) }
        self.endpoint = endpoint; self.projectKey = key; self.timeout = timeout
    }
}

/// Internal browser dispatch seam; tests can observe the explicit action without opening Safari.
enum KuePlansBrowser {
    static func open(_ url: URL, using handler: (URL, @escaping (Bool) -> Void) -> Void,
                     onFailure: @escaping () -> Void) {
        handler(url) { opened in if !opened { onFailure() } }
    }
}

/// An injected transport must also reject redirects and avoid cookies/credential storage.
public protocol KueHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public final class KueURLSessionTransport: NSObject, KueHTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    public override init() { super.init() }
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = request.timeoutInterval
        configuration.timeoutIntervalForResource = request.timeoutInterval
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw KueError(code: .unexpectedResponse, retryable: true) }
        return (data, response)
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask,
                           willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                           completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public struct KueCloudClient: Sendable {
    public let configuration: KueCloudConfiguration
    private let transport: any KueHTTPTransport
    public init(configuration: KueCloudConfiguration, transport: any KueHTTPTransport = KueURLSessionTransport()) {
        self.configuration = configuration; self.transport = transport
    }
    public func request(for report: KueReport) throws -> URLRequest {
        try report.validateStored()
        // Stable multipart bytes on manual retry, including the same screenshot and report ID.
        let boundary = report.multipartBoundary
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"screenshot\"; filename=\"capture.\(report.mimeType == "image/png" ? "png" : "jpg")\"\r\nContent-Type: \(report.mimeType)\r\n\r\n")
        body.append(report.imageData)
        append("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"memo\"\r\n\r\n\(report.memo)")
        append("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n")
        body.append(try report.metadata()); append("\r\n--\(boundary)--\r\n")
        var request = URLRequest(url: configuration.endpoint)
        request.httpMethod = "POST"; request.timeoutInterval = configuration.timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(configuration.projectKey)", forHTTPHeaderField: "Authorization")
        request.setValue(report.clientReportId, forHTTPHeaderField: "Idempotency-Key")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body; request.httpShouldHandleCookies = false
        return request
    }
    /// One foreground submission only. No automatic retry, polling, persistence, or background upload.
    public func submit(_ report: KueReport) async throws -> KueReceipt {
        try await upload(request(for: report), clientReportId: report.clientReportId)
    }
    public func request(for group: KueReportGroup) throws -> URLRequest {
        try group.validateStored()
        let boundary = group.multipartBoundary
        var body = Data()
        func append(_ value: String) { body.append(Data(value.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"manifest\"\r\n\r\n")
        body.append(try group.manifest())
        for (index, finding) in group.findings.enumerated() {
            let ext = finding.isVideo ? "mp4" : finding.mimeType == "image/png" ? "png" : "jpg"
            append("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"capture_\(index)\"; filename=\"capture.\(ext)\"\r\nContent-Type: \(finding.mimeType)\r\n\r\n")
            body.append(finding.mediaData)
        }
        append("\r\n--\(boundary)--\r\n")
        var request = authorizedRequest(path: "/v1/report-groups")
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue(group.clientReportId, forHTTPHeaderField: "Idempotency-Key")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        return request
    }
    public func submit(_ group: KueReportGroup) async throws -> KueReceipt {
        try await upload(request(for: group), clientReportId: group.clientReportId)
    }
    public func projectFeatures() async throws -> KueProjectFeatures {
        let (data, response) = try await send(authorizedRequest(path: "/v1/project/features"))
        guard (200...299).contains(response.statusCode) else { throw rejection(data, response) }
        struct Body: Decodable { let schemaVersion: Int; let groups: Bool; let recording: KueProjectFeatures.Recording }
        guard let body = try? JSONDecoder().decode(Body.self, from: data), body.schemaVersion == 1 else {
            throw KueError(code: .unexpectedResponse, retryable: true)
        }
        return KueProjectFeatures(groups: body.groups, recording: body.recording)
    }
    public func reportStatus(_ receipt: KueReceipt) async throws -> KueReportStatus {
        guard receipt.id.range(of: "^report_[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              let token = receipt.receiptToken, token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            throw KueError(code: .invalidReport)
        }
        var request = authorizedRequest(path: "/v1/reports/" + receipt.id)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        guard (200...299).contains(response.statusCode) else {
            throw KueError(code: .unexpectedResponse, status: response.statusCode,
                retryable: response.statusCode == 429 || response.statusCode >= 500,
                retryAfter: Self.parseRetryAfter(response.value(forHTTPHeaderField: "Retry-After")))
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object.keys.contains("githubIssue"), object["error"] == nil || !(object["error"] is NSNull) else {
            throw KueError(code: .unexpectedResponse, retryable: true)
        }
        guard let body = try? JSONDecoder().decode(KueReportStatus.self, from: data), body.id == receipt.id,
              ["received", "queued", "creating_issue", "completed", "failed"].contains(body.status),
              body.githubIssue == nil || (body.githubIssue!.number > 0 && body.githubIssue!.number <= 9_007_199_254_740_991 && body.githubIssue!.url.range(of: "^https://github\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/issues/[0-9]+$", options: .regularExpression) != nil) else {
            throw KueError(code: .unexpectedResponse, retryable: true)
        }
        return body
    }
    private func authorizedRequest(path: String) -> URLRequest {
        var parts = URLComponents(url: configuration.endpoint, resolvingAgainstBaseURL: false)!; parts.path = path
        var request = URLRequest(url: parts.url!); request.timeoutInterval = configuration.timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer " + configuration.projectKey, forHTTPHeaderField: "Authorization")
        request.httpShouldHandleCookies = false; return request
    }
    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try Task.checkCancellation()
        do {
            let result = try await transport.send(request)
            guard result.1.url == request.url, result.0.count <= 65_536 else { throw KueError(code: .unexpectedResponse, retryable: true) }
            return result
        } catch let error as KueError { throw error }
        catch is CancellationError { throw CancellationError() }
        catch let error as URLError {
            if Task.isCancelled { throw CancellationError() }
            throw KueError(code: error.code == .timedOut ? .requestTimeout : .networkError, retryable: true)
        }
        catch { throw KueError(code: .networkError, retryable: true) }
    }
    private func rejection(_ data: Data, _ response: HTTPURLResponse) -> KueError {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let candidate = (json?["error"] as? [String: Any])?["code"] as? String
        let code = candidate.flatMap { $0.range(of: "^[A-Za-z0-9._-]{1,64}$", options: .regularExpression) == nil ? nil : $0 }
        return KueError(code: .uploadRejected, status: response.statusCode, serverCode: code,
            retryable: (response.statusCode == 429 && code != "quota_exceeded") || response.statusCode >= 500,
            retryAfter: Self.parseRetryAfter(response.value(forHTTPHeaderField: "Retry-After")))
    }
    private func upload(_ request: URLRequest, clientReportId: String) async throws -> KueReceipt {
        let data: Data; let response: HTTPURLResponse
        (data, response) = try await send(request)
        guard response.statusCode == 202 else { throw rejection(data, response) }
        guard let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = body["id"] as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let status = body["status"] as? String, ["received", "queued"].contains(status) else {
            throw KueError(code: .unexpectedResponse, status: 202, retryable: true)
        }
        var receiptToken: String?
        if let value = body["receiptToken"] {
            guard let token = value as? String,
                  token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
                throw KueError(code: .unexpectedResponse, status: 202, retryable: true)
            }
            receiptToken = token
        }
        return KueReceipt(clientReportId: clientReportId, id: id.trimmingCharacters(in: .whitespacesAndNewlines),
                          status: status, receiptToken: receiptToken)
    }
    static func parseRetryAfter(_ value: String?, now: Date = Date()) -> TimeInterval? {
        guard let value else { return nil }
        if let seconds = Double(value), seconds.isFinite, seconds >= 0 { return seconds }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter.date(from: value).map { max(0, $0.timeIntervalSince(now)) }
    }
}

/// Display conversion is bounded independently of the server's actual retry deadline.
/// Large finite Retry-After values must not overflow Int or enable an early retry.
struct KueRetryCountdown {
    let waiting: Bool
    let exceedsOneDay: Bool
    let seconds: Int
    init(deadline: Date?, now: Date) {
        guard let deadline else { waiting = false; exceedsOneDay = false; seconds = 0; return }
        let remaining = deadline.timeIntervalSince(now)
        waiting = deadline > now
        exceedsOneDay = waiting && (!remaining.isFinite || remaining > 86_400)
        seconds = exceedsOneDay ? 86_400 : Int(max(0, min(86_400, ceil(remaining))))
    }
}
