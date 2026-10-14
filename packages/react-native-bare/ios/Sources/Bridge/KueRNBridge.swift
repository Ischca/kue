#if canImport(UIKit)
import Foundation
import UIKit

@MainActor @objc(KueRNBridge) public final class KueRNBridge: NSObject {
    #if DEBUG
    public static var debugTransportFactory: (@MainActor () -> any KueHTTPTransport)?
    private let developmentTransport: (@MainActor () -> any KueHTTPTransport)?
    #endif
    let engine: String, media: KueRNMedia
    private let requestEmitter: (String, String, String, String) -> Void
    private let eventEmitter: (String, String, String) -> Void
    private var sessions: [String: KueRNSession] = [:]
    private struct Operation { let task: Task<Any?, Error>; let requiresForeground: Bool }
    private var operations: [String: Operation] = [:]
    private var calls: [UUID: Task<Void, Never>] = [:]
    private var lifecycle: [NSObjectProtocol] = []
    var alive = true
    @objc public init(engine: String, request: @escaping (String, String, String, String) -> Void,
                      event: @escaping (String, String, String) -> Void) throws {
        self.engine = engine; requestEmitter = request; eventEmitter = event; media = try KueRNMedia()
        #if DEBUG
        developmentTransport = Self.debugTransportFactory
        #endif
        super.init()
        KueRNRecordingRegistry.connect(engine, bridge: self)
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            lifecycle.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.operations.values.filter(\.requiresForeground).forEach { $0.task.cancel() } }
            })
        }
    }
    deinit { lifecycle.forEach(NotificationCenter.default.removeObserver) }
    func transport() -> any KueHTTPTransport {
        #if DEBUG
        if let factory = developmentTransport { return factory() }
        #endif
        return KueURLSessionTransport()
    }
    func request(_ session: String, id: String, kind: String, payload: String) {
        guard alive else { return }; requestEmitter(session, id, kind, payload)
    }
    func event(_ session: String, kind: String, payload: [String: Any]) {
        guard alive else { return }; var value = payload; value["schemaVersion"] = 1
        guard let encoded = try? KueRNWire.json(value) else { return }; eventEmitter(session, kind, encoded)
    }
    @objc public func handle(_ method: String, sessionId: String, action: String, json: String,
                             completion: @escaping (String) -> Void) {
        let token = UUID()
        calls[token] = Task { [weak self] in
            guard let self else { completion(KueRNWire.failure(CancellationError())); return }
            defer { self.calls.removeValue(forKey: token) }
            do {
                guard self.alive else { throw CancellationError() }
                let value = try await self.perform(method, id: sessionId, action: action, text: json)
                guard self.alive else { throw CancellationError() }; completion(KueRNWire.ok(value))
            } catch { completion(KueRNWire.failure(error)) }
        }
    }
    private func perform(_ method: String, id: String, action: String, text: String) async throws -> Any? {
        if method == "removeCopiedMediaFile" { try media.removeCopy(text); return nil }
        let value = try KueRNWire.parse(text)
        if method == "standalone" { return try await standalone(action, arguments: value) }
        _ = try KueRNWire.id(id)
        switch method {
        case "attach":
            guard sessions[id] == nil else { throw KueRNFailure("configuration_changed") }
            let configuration = try KueRNConfiguration(value)
            let session = try KueRNSession(id: id, bridge: self, configuration: configuration,
                provider: KueRNRecordingRegistry.provider(engine: engine, session: id))
            let window = try KueRNAnchorBindings.claim(id, bridge: self)
            sessions[id] = session; KueRNUIOwners.mount(session); if let window { session.bind(window) }
            do { try await session.waitForWindow() }
            catch { if sessions[id] === session { detach(id) }; throw error }
            guard sessions[id] === session, alive else { throw CancellationError() }; session.sendState(); return nil
        case "detach": detach(id); return nil
        case "copyMediaFile":
            guard let session = sessions[id], session.alive else { throw CancellationError() }
            return try session.requests.copy(request: KueRNWire.id(KueRNWire.string(value, "requestId")), uri: KueRNWire.string(value, "uri"))
        case "update", "execute":
            guard let session = sessions[id], session.alive else { throw CancellationError() }
            return try await session.perform(method == "update" ? "update" : action, arguments: value)
        default: throw KueRNFailure("unsupported_operation")
        }
    }
    @objc public func completeCallback(_ sessionId: String, requestId: String, response: String) {
        guard alive, (try? KueRNWire.id(sessionId)) != nil, (try? KueRNWire.id(requestId)) != nil else { return }
        sessions[sessionId]?.requests.acknowledge(requestId, response: response)
    }
    @objc public func invalidate() {
        guard alive else { return }
        for id in Array(sessions.keys) { detach(id) }
        alive = false; calls.values.forEach { $0.cancel() }; operations.values.forEach { $0.task.cancel() }
        calls.removeAll(); operations.removeAll(); media.close()
        KueRNRecordingRegistry.disconnect(engine, bridge: self)
        lifecycle.forEach(NotificationCenter.default.removeObserver); lifecycle.removeAll()
    }
    #if DEBUG
    func debugSession(_ id: String) -> KueRNSession? { sessions[id] }
    #endif
    private func detach(_ id: String) { sessions.removeValue(forKey: id)?.detach(); KueRNAnchorBindings.release(id, bridge: self) }
    func bind(_ id: String, window: UIWindow) { sessions[id]?.bind(window) }
    func anchorRemoved(_ id: String) { detach(id) }
    func installProvider(_ id: String, factory: (@MainActor () -> any KueRecordingProvider)?) {
        sessions[id]?.controller.installRecordingProvider(factory?()); sessions[id]?.sendState()
    }
    private func standalone(_ action: String, arguments: [String: Any]) async throws -> Any? {
        let id = try KueRNWire.id(KueRNWire.string(arguments, "operationId"))
        if action == "cancel" { operations[id]?.task.cancel(); return nil }
        guard ["submitReport", "submitReportGroup", "getProjectFeatures", "getReportStatus", "pendingReports", "retryPendingReports", "discardPendingReport"].contains(action) else { throw KueRNFailure("unsupported_operation") }
        guard operations[id] == nil else { throw KueRNFailure("busy") }
        let requiresForeground = KueRNStandalonePolicy.requiresForeground(action)
        guard !requiresForeground || UIApplication.shared.applicationState == .active else { throw KueRNFailure("disabled") }
        let task = Task<Any?, Error> { [weak self] in
            guard let self, self.alive else { throw CancellationError() }; try Task.checkCancellation()
            let config = try KueRNWire.cloud(KueRNWire.object(arguments, "cloud"), statusOnly: action == "getReportStatus")
            let client = KueCloudClient(configuration: config, transport: self.transport())
            switch action {
            case "submitReport":
                guard case .screenshot(let report) = try KueRNInputs.finding(KueRNWire.object(arguments, "report"), media: self.media) else { throw KueRNFailure("invalid_report") }
                return KueRNWire.receipt(try await client.submit(report))
            case "submitReportGroup": return KueRNWire.receipt(try await client.submit(KueRNInputs.group(KueRNWire.object(arguments, "group"), media: self.media)))
            case "getProjectFeatures": return KueRNWire.features(try await client.projectFeatures())
            case "getReportStatus": return KueRNWire.status(try await client.reportStatus(KueRNWire.receipt(KueRNWire.object(arguments, "receipt"))))
            case "pendingReports":
                try Task.checkCancellation(); return try await KueOutbox.shared.pending(config: config, includeOtherDestinations: KueRNWire.flag(arguments, "includeOtherDestinations")).map(KueRNWire.pending)
            case "discardPendingReport":
                try Task.checkCancellation(); try await KueOutbox.shared.discard(id: KueRNWire.string(arguments, "clientReportId"), config: KueRNWire.flag(arguments, "includeOtherDestinations") ? nil : config); return nil
            case "retryPendingReports":
                try await KueOutbox.shared.retryPending(config: config, force: KueRNWire.flag(arguments, "force"),
                    active: { [weak self] in await MainActor.run { self?.alive == true && UIApplication.shared.applicationState == .active } }, send: { try await client.submit($0) },
                    onReceipt: { [weak self] receipt in await MainActor.run { self?.event(id, kind: "receipt", payload: ["receipt": KueRNWire.receipt(receipt)]) } },
                    onError: { [weak self] error in await MainActor.run { self?.event(id, kind: "error", payload: ["error": KueRNWire.error(error)]) } }); return nil
            default: throw KueRNFailure("unsupported_operation")
            }
        }
        operations[id] = Operation(task: task, requiresForeground: requiresForeground); defer { operations.removeValue(forKey: id) }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
}
#endif
