#if canImport(UIKit)
import UIKit
import Combine

@MainActor final class KueRNSession {
    var mountOrder: Int { configuration.mountOrder }
    var engineID: String { bridge?.engine ?? ownerID }
    let ownerID = UUID().uuidString
    let id: String, controller: KueController
    private weak var bridge: KueRNBridge?
    private let media: KueRNMedia
    private var configuration: KueRNConfiguration
    private(set) var alive = true
    private(set) weak var window: UIWindow?
    private(set) var enabled: Bool
    private var ownsUI = false
    private var observation: AnyCancellable?
    private var lifecycle: [NSObjectProtocol] = []
    private var windowWaiters: [UUID: CheckedContinuation<Void, Error>] = [:]
    private var captureWaiter: CheckedContinuation<Void, Error>?
    private var operationID: String?
    private var subscriptions: [String: @MainActor () -> Void] = [:]
    private var utilities: [UUID: Task<Any?, Error>] = [:]
    private var lastState: Data?, lastStateError: Data?
    private var stateGeneration = 0
    lazy var requests = KueRNRequests(media: media,
        request: { [weak self] request, kind, payload in guard let self else { return }; self.bridge?.request(self.id, id: request, kind: kind, payload: payload) },
        event: { [weak self] kind, payload in self?.event(kind, payload) })
    init(id: String, bridge: KueRNBridge, configuration: KueRNConfiguration, provider: (any KueRecordingProvider)?) throws {
        self.id = id; self.bridge = bridge; self.media = bridge.media; self.configuration = configuration; self.enabled = configuration.enabled
        // Callbacks are installed after initialization and retain this exact session destination.
        let destination: KueDestination = configuration.local
            ? .local(submitLabel: configuration.values["submitLabel"] as! String, onSubmit: { _ in throw KueRNFailure("request_cancelled") })
            : .cloud(configuration.cloud!)
        controller = KueController(destination: destination, enabled: false,
            locale: KueLocale(rawValue: configuration.values["locale"] as? String ?? "") ?? .preferred, recorder: provider)
        controller.transport = bridge.transport()
        if configuration.local {
            controller.cloud = configuration.cloud
            controller.destination = .local(submitLabel: configuration.values["submitLabel"] as! String) { [weak self] report in
                guard let self, self.alive, self.controller.enabled else { throw CancellationError() }; try Task.checkCancellation(); try await self.submit(.screenshot(report))
            }
        }
        if configuration.localGroup {
            controller.onSubmitGroup = { [weak self] group in guard let self, self.alive, self.controller.enabled else { throw CancellationError() }; try Task.checkCancellation(); try await self.submit(group) }
        }
        if configuration.adapter { controller.capture = { [weak self] in guard let self, self.alive else { throw CancellationError() }; return try await self.capture() } }
        controller.onReceipt = { [weak self] receipt in self?.event("receipt", ["receipt": KueRNWire.receipt(receipt)]); self?.sendState() }
        controller.onQueued = { [weak self] id in self?.event("queued", ["clientReportId": id]); self?.sendState() }
        controller.onError = { [weak self] error in self?.event("error", ["error": KueRNWire.error(error)]); self?.sendState() }
        controller.onCaptureFinished = { [weak self] error in self?.captured(error) }
        controller.onReportOutcome = { [weak self] result in self?.outcome(result.rawValue) }
        controller.triggers = configuration.triggerIDs.map { trigger in
            KueTriggerSource { [weak self] open in
                guard let self, self.alive else { throw CancellationError() }
                let subscription = UUID().uuidString; self.subscriptions[subscription] = open
                do {
                    _ = try await self.requests.request("subscribeTrigger", timeout: self.configuration.timeout,
                        payload: { _ in ["triggerId": trigger, "subscriptionId": subscription] }, retire: { [weak self] in self?.unsubscribe(subscription) })
                    return { [weak self] in self?.unsubscribe(subscription) }
                } catch { self.unsubscribe(subscription); throw error }
            }
        }
        try applyMutable(configuration)
        observation = controller.objectWillChange.sink { [weak self] _ in Task { @MainActor in self?.sendState() } }
    }
    func bind(_ window: UIWindow) {
        guard alive else { return }
        if self.window !== window {
            self.window = window
            lifecycle.forEach(NotificationCenter.default.removeObserver); lifecycle.removeAll()
            let names: [Notification.Name] = window.windowScene == nil
                ? [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification, UIApplication.didBecomeActiveNotification]
                : [UIScene.willDeactivateNotification, UIScene.didEnterBackgroundNotification, UIScene.didActivateNotification]
            for name in names {
                lifecycle.append(NotificationCenter.default.addObserver(forName: name, object: window.windowScene, queue: .main) { [weak self] note in
                    Task { @MainActor in
                        guard let self else { return }
                        if note.name != UIApplication.didBecomeActiveNotification && note.name != UIScene.didActivateNotification { self.cancelWork() }
                        self.sendState()
                    }
                })
            }
        }
        KueRNUIOwners.refresh(self)
        let waiting = Array(windowWaiters.values); windowWaiters.removeAll(); waiting.forEach { $0.resume() }; sendState()
    }
    func waitForWindow() async throws {
        if window != nil { return }; let token = UUID()
        try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { continuation in
                windowWaiters[token] = continuation
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    self?.windowWaiters.removeValue(forKey: token)?.resume(throwing: KueRNFailure("capture_unavailable"))
                }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.windowWaiters.removeValue(forKey: token)?.resume(throwing: CancellationError()) } })
    }
    func setUIOwner(_ active: Bool) {
        guard alive, ownsUI != active else { return }
        if !active { cancelWork(); controller.enabled = false; controller.detach() }
        ownsUI = active
        if active, enabled, let window { controller.enabled = true; controller.attach(to: window) }
        sendState()
    }
    func detach() {
        guard alive else { return }
        KueRNUIOwners.remove(self)
        cancelWork(); controller.detach()
        for id in Array(subscriptions.keys) { unsubscribe(id) }
        alive = false; observation?.cancel(); observation = nil
        lifecycle.forEach(NotificationCenter.default.removeObserver); lifecycle.removeAll()
        let waiting = Array(windowWaiters.values); windowWaiters.removeAll(); waiting.forEach { $0.resume(throwing: CancellationError()) }
        window = nil; stateGeneration += 1
    }
    private func event(_ kind: String, _ value: [String: Any] = [:]) { guard alive else { return }; bridge?.event(id, kind: kind, payload: value) }
    private func captured(_ error: KueError?) {
        let waiter = captureWaiter; captureWaiter = nil
        if let error { waiter?.resume(throwing: error); outcome("failed", error: error) }
        else if let waiter {
            if !alive || !controller.enabled || !controller.foregroundActive { waiter.resume(throwing: CancellationError()) }
            else { waiter.resume() }
        } else if operationID == nil { operationID = UUID().uuidString }
        sendState()
    }
    private func outcome(_ value: String, error: Error? = nil) {
        guard let operation = operationID else { return }; operationID = nil
        var data: [String: Any] = ["operationId": operation, "outcome": value]
        if let error { data["error"] = KueRNWire.error(error) }; event("outcome", data); sendState()
    }
    private func cancelWork() {
        utilities.values.forEach { $0.cancel() }; requests.cancelAll()
        let waiter = captureWaiter; captureWaiter = nil; waiter?.resume(throwing: CancellationError())
    }
    private func unsubscribe(_ id: String) {
        guard subscriptions.removeValue(forKey: id) != nil else { return }; event("unsubscribeTrigger", ["subscriptionId": id])
    }
    private func submit(_ finding: KueFinding) async throws {
        _ = try await requests.request("submit", timeout: configuration.timeout, payload: { request in
            guard let bridge else { throw CancellationError() }
            let uri = try bridge.media.export(finding.mediaData, mimeType: finding.mimeType, request: request)
            return ["handlerId": configuration.handlerID!, "report": try KueRNWire.finding(finding, uri: uri)]
        })
    }
    private func submit(_ group: KueReportGroup) async throws {
        _ = try await requests.request("submitGroup", timeout: configuration.timeout, payload: { request in
            guard let bridge else { throw CancellationError() }
            let findings = try group.findings.map { finding in
                try KueRNWire.finding(finding, uri: bridge.media.export(finding.mediaData, mimeType: finding.mimeType, request: request))
            }
            return ["handlerId": configuration.groupHandlerID!, "group": ["clientReportId": group.clientReportId, "title": group.title, "findings": findings]]
        })
    }
    private func capture() async throws -> KueCapturedImage {
        if operationID == nil { operationID = UUID().uuidString }
        var requestID: String?
        let response = try await requests.request("capture", timeout: configuration.timeout,
            payload: { _ in ["operationId": operationID!, "captureAdapterId": configuration.adapterID!] }, completedID: { requestID = $0 })
        defer { if let requestID { requests.imported(requestID) } }
        try Task.checkCancellation()
        guard alive, controller.enabled, let bridge else { throw CancellationError() }
        guard let value = response as? [String: Any] else { throw KueRNFailure("capture_unavailable") }
        let width = try KueRNWire.integer(value, "width", maximum: 16_000_000), height = try KueRNWire.integer(value, "height", maximum: 16_000_000)
        let data = try bridge.media.image(KueRNWire.string(value, "uri"), width: width, height: height, mimeType: KueRNWire.string(value, "mimeType"))
        guard let image = UIImage(data: data), image.cgImage != nil else { throw KueRNFailure("capture_unavailable") }
        return try KueCapturedImage(image: image, capturedAt: KueRNWire.date(KueRNWire.string(value, "capturedAt")), context: KueRNWire.context(KueRNWire.optionalObject(value, "context")))
    }
    private func applyMutable(_ config: KueRNConfiguration) throws {
        let values = config.values
        let locale = KueLocale(rawValue: try KueRNWire.string(values, "locale", fallback: KueLocale.preferred.rawValue))!
        let design = KueButtonDesign(rawValue: try KueRNWire.string(values, "buttonDesign", fallback: "classic"))!
        if controller.locale != locale { controller.locale = locale }; if controller.buttonDesign != design { controller.buttonDesign = design }
        controller.context = try KueRNWire.context(KueRNWire.optionalObject(values, "context"))
        if config.local, let label = values["submitLabel"] as? String { try controller.updateLocalSubmitLabel(label) }
        controller.groupSubmitLabel = values["groupSubmitLabel"] as? String ?? values["submitLabel"] as? String
        let floating = try KueRNWire.flag(values, "floatingButton", fallback: true), shake = try KueRNWire.flag(values, "shakeTrigger"), screenshot = try KueRNWire.flag(values, "systemScreenshotTrigger")
        if controller.floatingButton != floating { controller.floatingButton = floating }; if controller.shakeTrigger != shake { controller.shakeTrigger = shake }
        if controller.screenshotTrigger != screenshot { controller.screenshotTrigger = screenshot }
        let recording = KueRecordingMode(rawValue: try KueRNWire.string(values, "recording", fallback: "auto"))!
        if controller.recording != recording { controller.recording = recording }
        if controller.offlineQueue != (try KueRNWire.flag(values, "offlineQueue")) { controller.offlineQueue = try KueRNWire.flag(values, "offlineQueue") }
        enabled = config.enabled
        KueRNUIOwners.refresh(self)
    }
    private func cloud() throws -> KueCloudConfiguration { guard let config = configuration.cloud else { throw KueRNFailure("invalid_config") }; return config }
    func perform(_ action: String, arguments: [String: Any]) async throws -> Any? {
        if !["features", "status", "retryPendingReports"].contains(action) { return try await command(action, arguments: arguments) }
        guard alive, controller.enabled, controller.foregroundActive else { throw KueRNFailure("disabled") }
        let token = UUID(), task = Task<Any?, Error> { [weak self] in guard let self else { throw CancellationError() }; return try await self.command(action, arguments: arguments) }
        utilities[token] = task; defer { utilities.removeValue(forKey: token) }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private func command(_ action: String, arguments: [String: Any]) async throws -> Any? {
        defer { sendState() }
        switch action {
        case "update":
            if KueRNWire.explicitFalse(arguments, "enabled") { enabled = false; KueRNUIOwners.refresh(self); cancelWork(); controller.enabled = false; controller.detach() }
            if arguments["recording"] as? String == "off", controller.recording != .off { controller.recording = .off }
            let next = try KueRNConfiguration(arguments)
            guard next.fingerprint == configuration.fingerprint else { throw KueRNFailure("configuration_changed") }
            try applyMutable(next); configuration = next
        case "reportIssue":
            let context = try KueRNWire.context(KueRNWire.optionalObject(arguments, "context"))
            let operation = try KueRNWire.id(KueRNWire.string(arguments, "operationId"))
            let memo = try KueRNWire.string(arguments, "memo", fallback: "")
            guard operationID == nil else { throw KueRNFailure("busy") }
            operationID = operation
            do {
                try await withTaskCancellationHandler(operation: {
                    try Task.checkCancellation()
                    try await withCheckedThrowingContinuation { continuation in
                        captureWaiter = continuation
                        do { try controller.reportIssue(memo: memo, context: context) }
                        catch { if captureWaiter != nil { captureWaiter = nil; continuation.resume(throwing: error) } }
                    }
                }, onCancel: { Task { @MainActor [weak self] in self?.cancelWork() } })
            } catch { if operationID == operation { operationID = nil }; throw error }
        case "trigger":
            let id = try KueRNWire.id(KueRNWire.string(arguments, "subscriptionId"))
            guard let open = subscriptions[id] else { throw KueRNFailure("request_cancelled") }; open()
        case "openSavedFindings", "openOutbox", "beginRecording":
            guard controller.enabled, controller.foregroundActive else { throw KueRNFailure("disabled") }
            guard !controller.busy else { throw KueRNFailure("busy") }
            if action == "openSavedFindings" { controller.openSavedFindings() }
            else if action == "openOutbox" { controller.openOutbox() }
            else { guard controller.recording != .off else { throw KueRNFailure("disabled") }; controller.beginRecording() }
        case "stopRecording": controller.stopRecording()
        case "state": return try await state()
        case "features": return KueRNWire.features(try await controller.refreshProjectFeatures())
        case "status": return KueRNWire.status(try await KueCloudClient(configuration: cloud(), transport: controller.transport).reportStatus(KueRNWire.receipt(KueRNWire.object(arguments, "receipt"))))
        case "pendingReports": return try await KueOutbox.shared.pending(config: cloud(), includeOtherDestinations: KueRNWire.flag(arguments, "includeOtherDestinations")).map(KueRNWire.pending)
        case "discardPendingReport": try await KueOutbox.shared.discard(id: KueRNWire.string(arguments, "clientReportId"), config: KueRNWire.flag(arguments, "includeOtherDestinations") ? nil : cloud())
        case "retryPendingReports":
            let config = try cloud(), client = KueCloudClient(configuration: config, transport: controller.transport)
            try await KueOutbox.shared.retryPending(config: config, force: KueRNWire.flag(arguments, "force"),
                active: { [weak self] in await MainActor.run { self?.alive == true && self?.controller.enabled == true && self?.controller.foregroundActive == true } },
                send: { try await client.submit($0) },
                onReceipt: { [weak self] receipt in await MainActor.run { self?.event("receipt", ["receipt": KueRNWire.receipt(receipt)]) } },
                onError: { [weak self] error in await MainActor.run { self?.event("error", ["error": KueRNWire.error(error)]) } })
        default: throw KueRNFailure("unsupported_operation")
        }
        return nil
    }
    private func state() async throws -> [String: Any] {
        let pending: Int
        if let config = configuration.cloud { pending = try await KueOutbox.shared.pending(config: config, includeOtherDestinations: true).count }
        else { pending = 0 }
        return ["attached": ownsUI && window != nil, "enabled": controller.enabled, "foreground": controller.foregroundActive,
            "reporterOpen": controller.reporterOpen, "busy": controller.busy, "capturing": controller.capturingImage, "recordingActive": controller.recordingActive,
            "savedCount": controller.savedFindings.count, "pendingCount": pending, "recordingAvailability": controller.recordingAvailability.rawValue,
            "groupLocked": controller.groupLocked, "groupFull": controller.groupFull, "recorderIncluded": controller.recorderIncluded]
    }
    func sendState() {
        guard alive else { return }; stateGeneration += 1; let generation = stateGeneration
        Task { [weak self] in
            guard let self else { return }
            do {
                let value = try await self.state(), data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
                guard self.alive, generation == self.stateGeneration, data != self.lastState else { return }
                self.lastState = data; self.lastStateError = nil; self.event("state", ["state": value])
            } catch {
                let value = KueRNWire.error(error), data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
                guard self.alive, generation == self.stateGeneration, data != self.lastStateError else { return }
                self.lastStateError = data; self.event("error", ["error": value])
            }
        }
    }
}
#endif
