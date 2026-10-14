import Foundation

/// Once-only acknowledgement/cancellation. Observer events carry no media bytes.
@MainActor final class KueRNRequests {
    private final class Pending {
        let continuation: CheckedContinuation<Any?, Error>, kind: String
        let retire: (() -> Void)?
        var timer: Task<Void, Never>?
        init(_ continuation: CheckedContinuation<Any?, Error>, kind: String, retire: (() -> Void)?) {
            self.continuation = continuation; self.kind = kind; self.retire = retire
        }
    }
    private var pending: [String: Pending] = [:]
    private var imports = Set<String>()
    let media: KueRNMedia
    let emitRequest: (String, String, String) -> Void
    let emitEvent: (String, [String: Any]) -> Void
    init(media: KueRNMedia, request: @escaping (String, String, String) -> Void, event: @escaping (String, [String: Any]) -> Void) {
        self.media = media; emitRequest = request; emitEvent = event
    }
    func request(_ kind: String, timeout: TimeInterval, payload: (String) throws -> [String: Any],
                 retire: (() -> Void)? = nil, completedID: ((String) -> Void)? = nil) async throws -> Any? {
        let id = UUID().uuidString
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            do {
                var value = try payload(id); value["schemaVersion"] = 1
                let encoded = try KueRNWire.json(value)
                if kind == "capture" { imports.insert(id) }
                return try await withCheckedThrowingContinuation { continuation in
                    let item = Pending(continuation, kind: kind, retire: retire); pending[id] = item
                    item.timer = Task { [weak self] in
                        try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                        guard !Task.isCancelled else { return }
                        self?.finish(id, result: .failure(KueError(code: .requestTimeout, retryable: true)), retired: true)
                    }
                    completedID?(id); emitRequest(id, kind, encoded)
                }
            } catch { media.retire(id); imported(id); throw error }
        }, onCancel: { Task { @MainActor [weak self] in self?.finish(id, result: .failure(CancellationError()), retired: true) } })
    }
    func acknowledge(_ id: String, response: String) {
        guard pending[id] != nil else { return }
        do {
            let data = try KueRNWire.parse(response)
            if try KueRNWire.flag(data, "ok") {
                guard data.keys.contains("value") else { throw KueRNFailure("invalid_config") }
                finish(id, result: .success(data["value"] is NSNull ? nil : data["value"]), retired: false)
            } else {
                let value = try KueRNWire.object(data, "error")
                let code = try KueRNWire.string(value, "code")
                let safe = ["request_cancelled", "request_timeout", "local_save_failed", "capture_unavailable", "trigger_failed"].contains(code) ? code : "local_save_failed"
                let retryable = try KueRNWire.flag(value, "retryable")
                let failure: Error
                switch safe {
                case "request_timeout": failure = KueError(code: .requestTimeout, retryable: retryable)
                case "local_save_failed": failure = KueError(code: .localSaveFailed, retryable: retryable)
                case "capture_unavailable": failure = KueError(code: .captureFailed, retryable: retryable)
                case "request_cancelled": failure = CancellationError()
                default: failure = KueRNFailure(safe, retryable: retryable)
                }
                finish(id, result: .failure(failure), retired: true)
            }
        } catch { finish(id, result: .failure(KueRNFailure("invalid_config")), retired: true) }
    }
    private func finish(_ id: String, result: Result<Any?, Error>, retired: Bool) {
        guard let item = pending.removeValue(forKey: id) else { return }
        item.timer?.cancel(); media.retire(id)
        if retired { imported(id); item.retire?(); emitEvent("cancelRequest", ["requestId": id]) }
        item.continuation.resume(with: result)
    }
    func imported(_ id: String) {
        guard imports.remove(id) != nil else { return }; emitEvent("captureImported", ["requestId": id])
    }
    func cancelAll() {
        for id in Array(pending.keys) { finish(id, result: .failure(CancellationError()), retired: true) }
        for id in Array(imports) { imported(id) }
    }
    func copy(request: String, uri: String) throws -> String {
        guard pending[request] != nil else { throw KueRNFailure("invalid_media") }; return try media.copy(request: request, uri: uri)
    }
}
