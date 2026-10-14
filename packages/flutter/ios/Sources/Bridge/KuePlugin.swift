import Foundation
import UIKit
import Flutter
import Combine
import ImageIO

/// Local Flutter embedding of the native controller. No Dart/native media logging.
@MainActor public final class KuePlugin: NSObject, FlutterPlugin {
    #if DEBUG
    /// Sample/test transport only. Each engine captures the factory at registration.
    /// Release builds have no hook; normal engines retain the validated default transport.
    public static var debugTransportFactory: (@MainActor () -> any KueHTTPTransport)?
    private var developmentTransportFactory: (@MainActor () -> any KueHTTPTransport)?
    #endif
    let channel: FlutterMethodChannel
    private let messenger: AnyObject
    private var sessions: [String: KueFlutterSession] = [:]
    private let anchors = NSMapTable<NSString, KueFlutterAnchor>.strongToWeakObjects()
    private var alive = true
    private var anchorOwners: [String: UUID] = [:]
    init(channel: FlutterMethodChannel, messenger: AnyObject) { self.channel = channel; self.messenger = messenger }
    nonisolated public static func register(with registrar: FlutterPluginRegistrar) {
        let register = {
            MainActor.assumeIsolated {
                let messenger = registrar.messenger()
                let channel = FlutterMethodChannel(name: "dev.kue.qa/core", binaryMessenger: messenger)
                let plugin = KuePlugin(channel: channel, messenger: messenger)
                #if DEBUG
                plugin.developmentTransportFactory = Self.debugTransportFactory
                #endif
                registrar.addMethodCallDelegate(plugin, channel: channel)
                registrar.register(KueFlutterAnchorFactory(plugin), withId: "dev.kue.qa/host")
                registrar.publish(plugin)
                KueFlutterRecordingRegistry.connect(messenger: messenger, plugin: plugin)
            }
        }
        if Thread.isMainThread { register() } else { DispatchQueue.main.async(execute: register) }
    }
    nonisolated public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        Task { @MainActor [weak self] in
            guard let self, self.alive else { result(KueBridgeDTO.flutterError(KueBridgeFailure("request_cancelled"))); return }
            do {
                guard let arguments = call.arguments as? [String: Any], let id = arguments["sessionId"] as? String,
                      !id.isEmpty, id.utf8.count <= 128 else { throw KueBridgeFailure("invalid_config") }
                if call.method == "attach" {
                    guard self.sessions[id] == nil, let values = arguments["config"] as? [String: Any] else { throw KueBridgeFailure("configuration_changed") }
                    let config = try KueBridgeConfiguration(values)
                    let session = try KueFlutterSession(id: id, plugin: self, configuration: config,
                        provider: KueFlutterRecordingRegistry.provider(messenger: self.messenger))
                    self.sessions[id] = session
                    if let anchor = self.anchors.object(forKey: id as NSString), let window = anchor.window { session.bind(to: window) }
                    do { try await session.waitForWindow() }
                    catch {
                        if self.sessions[id] === session { self.sessions.removeValue(forKey: id); session.detach() }
                        throw error
                    }
                    guard self.sessions[id] === session, self.alive else { throw KueBridgeFailure("request_cancelled") }
                    result(["ok": true]); session.sendState(); return
                }
                if call.method == "detach" {
                    self.sessions.removeValue(forKey: id)?.detach(); result(["ok": true]); return
                }
                guard let session = self.sessions[id], session.alive else { throw KueBridgeFailure("request_cancelled") }
                let value = try await session.perform(call.method, arguments: arguments)
                guard self.sessions[id] === session, self.alive else { throw KueBridgeFailure("request_cancelled") }
                result(value)
            } catch { result(KueBridgeDTO.flutterError(error)) }
        }
    }
    @objc(detachFromEngineForRegistrar:) nonisolated public func detachFromEngine(for registrar: FlutterPluginRegistrar) {
        Task { @MainActor [weak self] in
            guard let self else { return }; self.alive = false
            let current = Array(self.sessions.values); self.sessions.removeAll(); current.forEach { $0.detach() }
            self.anchors.removeAllObjects(); self.anchorOwners.removeAll(); KueFlutterRecordingRegistry.disconnect(messenger: self.messenger, plugin: self)
            self.channel.setMethodCallHandler(nil)
        }
    }
    func bind(_ anchor: KueFlutterAnchor) {
        anchors.setObject(anchor, forKey: anchor.sessionID as NSString)
        anchorOwners[anchor.sessionID] = anchor.owner
        if let window = anchor.window { sessions[anchor.sessionID]?.bind(to: window) }
    }
    func anchorDisposed(_ id: String, owner: UUID) {
        guard anchorOwners[id] == owner else { return }
        anchorOwners.removeValue(forKey: id)
        anchors.removeObject(forKey: id as NSString)
        sessions.removeValue(forKey: id)?.detach()
    }
    func installProviderFactory(_ factory: (@MainActor () -> any KueRecordingProvider)?) {
        for session in sessions.values { session.controller.installRecordingProvider(factory?()); session.sendState() }
    }
    func configureTransport(_ controller: KueController) {
        #if DEBUG
        if let transport = developmentTransportFactory?() { controller.transport = transport }
        #endif
    }
}

@MainActor final class KueFlutterSession {
    let id: String
    weak var plugin: KuePlugin?
    var configuration: KueBridgeConfiguration
    var controller: KueController!
    var alive = true
    private let rpc: KueBridgeRPC
    private var observation: AnyCancellable?
    private weak var window: UIWindow?
    private var ready: [UUID: CheckedContinuation<Void, Error>] = [:]
    private var operationID: String?
    private var subscriptions: [String: @MainActor () -> Void] = [:]
    private var stateGeneration = 0
    private var lastState: Data?
    private var commands: [UUID: Task<Any, Error>] = [:]
    private var lifecycle: [NSObjectProtocol] = []
    init(id: String, plugin: KuePlugin, configuration: KueBridgeConfiguration, provider: (any KueRecordingProvider)?) throws {
        self.id = id; self.plugin = plugin; self.configuration = configuration; rpc = KueBridgeRPC(plugin.channel)
        let destination: KueDestination
        if configuration.local {
            destination = .local(submitLabel: configuration.values["submitLabel"] as! String) { [weak self] report in
                guard let self, self.alive else { throw CancellationError() }
                try await self.submit(report)
            }
        } else { destination = .cloud(configuration.cloud!) }
        controller = KueController(destination: destination, enabled: configuration.enabled,
            locale: KueLocale(rawValue: configuration.values["locale"] as? String ?? "en") ?? .en, recorder: provider)
        plugin.configureTransport(controller)
        if configuration.local { controller.cloud = configuration.cloud }
        controller.recording = KueRecordingMode(rawValue: configuration.values["recording"] as? String ?? "auto") ?? .auto
        controller.offlineQueue = configuration.values["offlineQueue"] as? Bool ?? false
        controller.capture = { [weak self] in
            guard let self, self.alive else { throw CancellationError() }; return try await self.capture()
        }
        if configuration.localGroup {
            controller.onSubmitGroup = { [weak self] group in
                guard let self, self.alive else { throw CancellationError() }; try await self.submit(group)
            }
        }
        controller.onReceipt = { [weak self] receipt in self?.event("receipt", ["receipt": KueBridgeDTO.receipt(receipt)]); self?.sendState() }
        controller.onQueued = { [weak self] reportID in self?.event("queued", ["clientReportId": reportID]); self?.sendState() }
        controller.onError = { [weak self] error in self?.event("error", ["error": KueBridgeDTO.error(error)]); self?.sendState() }
        controller.onCaptureFinished = { [weak self] error in
            guard let self else { return }
            if let error { self.outcome("failed", error: error) }
            self.sendState()
        }
        controller.onReportOutcome = { [weak self] outcome in self?.outcome(outcome.rawValue); self?.sendState() }
        controller.triggers = configuration.triggerIDs.map { triggerID in
            KueTriggerSource { [weak self] open in
                guard let self, self.alive else { throw CancellationError() }
                let subscriptionID = UUID().uuidString; self.subscriptions[subscriptionID] = open
                do {
                    let response = try await self.rpc.request("subscribeTrigger", arguments: ["sessionId": self.id,
                        "triggerId": triggerID, "subscriptionId": subscriptionID], timeout: self.configuration.timeout,
                        onRetire: { [weak self] in self?.unsubscribe(subscriptionID) })
                    try self.ack(response)
                    return { [weak self] in self?.unsubscribe(subscriptionID) }
                } catch { self.unsubscribe(subscriptionID); throw error }
            }
        }
        try applyMutable(configuration)
        observation = controller.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in self?.sendState() }
        }
    }
    func bind(to window: UIWindow) {
        guard alive else { return }
        if self.window !== window {
            self.window = window; controller.attach(to: window)
            lifecycle.forEach { NotificationCenter.default.removeObserver($0) }; lifecycle = []
            let names: [Notification.Name] = window.windowScene == nil
                ? [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification]
                : [UIScene.willDeactivateNotification, UIScene.didEnterBackgroundNotification]
            for name in names {
                lifecycle.append(NotificationCenter.default.addObserver(forName: name, object: window.windowScene, queue: .main) { [weak self] _ in
                    Task { @MainActor in self?.cancelCommands() }
                })
            }
        }
        let waiting = Array(ready.values); ready.removeAll(); waiting.forEach { $0.resume() }; sendState()
    }
    func waitForWindow() async throws {
        if window != nil { return }
        let token = UUID()
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                ready[token] = continuation
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    self?.ready.removeValue(forKey: token)?.resume(throwing: KueBridgeFailure("capture_unavailable"))
                }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.ready.removeValue(forKey: token)?.resume(throwing: CancellationError()) } })
    }
    func detach() {
        guard alive else { return }
        controller.detach(); alive = false; cancelCommands(); rpc.cancelAll(); observation?.cancel(); observation = nil
        lifecycle.forEach { NotificationCenter.default.removeObserver($0) }; lifecycle = []; lastState = nil
        for key in Array(subscriptions.keys) { unsubscribe(key) }
        let waiting = Array(ready.values); ready.removeAll(); waiting.forEach { $0.resume(throwing: CancellationError()) }
        window = nil; stateGeneration += 1
    }
    func event(_ type: String, _ data: [String: Any] = [:]) {
        guard alive, let plugin else { return }
        var value = data; value["sessionId"] = id; value["type"] = type
        plugin.channel.invokeMethod("event", arguments: value)
    }
    private func outcome(_ value: String, error: Error? = nil) {
        guard let operationID else { return }; self.operationID = nil
        var data: [String: Any] = ["operationId": operationID, "outcome": value]
        if let error { data["error"] = KueBridgeDTO.error(error) }; event("outcome", data)
    }
    private func ack(_ value: Any?) throws {
        guard let value = value as? [String: Any], value["ok"] as? Bool == true else { throw KueError(code: .unexpectedResponse, retryable: true) }
    }
    private func unsubscribe(_ subscriptionID: String) {
        guard subscriptions.removeValue(forKey: subscriptionID) != nil else { return }
        plugin?.channel.invokeMethod("unsubscribeTrigger", arguments: ["sessionId": id, "subscriptionId": subscriptionID])
    }
    private func capture() async throws -> KueCapturedImage {
        let operation = operationID ?? UUID().uuidString; operationID = operation
        let response = try await rpc.request("capture", arguments: ["sessionId": id, "operationId": operation], timeout: configuration.timeout)
        guard alive, operationID == operation, let response = response as? [String: Any],
              let typed = response["mediaBytes"] as? FlutterStandardTypedData, typed.data.count <= 10 * 1024 * 1024,
              let mime = response["mimeType"] as? String, ["image/png", "image/jpeg"].contains(mime),
              let timestamp = response["capturedAt"] as? String else { throw KueError(code: .captureFailed) }
        let bytes = typed.data
        let signature = mime == "image/png" ? bytes.starts(with: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) : bytes.starts(with: [0xff,0xd8])
        guard signature, let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber, let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
              width.intValue > 0, height.intValue > 0, width.intValue <= 100_000, height.intValue <= 100_000,
              Double(width.intValue) * Double(height.intValue) <= 40_000_000, let image = UIImage(data: bytes) else { throw KueError(code: .captureFailed) }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
        guard let date else { throw KueError(code: .captureFailed) }
        return try KueCapturedImage(image: image, capturedAt: date, context: KueBridgeDTO.context(response["context"] as? [String: Any]))
    }
    private func submit(_ report: KueReport) async throws {
        let value = try await rpc.request("submit", arguments: ["sessionId": id, "operationId": operationID ?? UUID().uuidString,
            "handlerId": configuration.handlerID!, "report": try KueBridgeDTO.finding(.screenshot(report))], timeout: configuration.timeout)
        try ack(value)
    }
    private func submit(_ group: KueReportGroup) async throws {
        let value = try await rpc.request("submitGroup", arguments: ["sessionId": id, "operationId": UUID().uuidString,
            "handlerId": configuration.groupHandlerID!, "group": try KueBridgeDTO.group(group)], timeout: configuration.timeout)
        try ack(value)
    }
    private func applyMutable(_ config: KueBridgeConfiguration) throws {
        let values = config.values
        let locale = KueLocale(rawValue: values["locale"] as? String ?? "en") ?? .en
        let design = KueButtonDesign(rawValue: values["buttonDesign"] as? String ?? "classic") ?? .classic
        if controller.locale != locale { controller.locale = locale }
        if controller.buttonDesign != design { controller.buttonDesign = design }
        controller.context = try KueBridgeDTO.context(values["context"] as? [String: Any])
        if config.local, let label = values["submitLabel"] as? String,
           (configuration.values["submitLabel"] as? String) != label { try controller.updateLocalSubmitLabel(label) }
        controller.groupSubmitLabel = values["groupSubmitLabel"] as? String ?? values["submitLabel"] as? String
        let floating = values["floatingButton"] as? Bool ?? true
        let shake = values["shakeTrigger"] as? Bool ?? false
        let screenshot = values["systemScreenshotTrigger"] as? Bool ?? false
        let recording = KueRecordingMode(rawValue: values["recording"] as? String ?? "auto") ?? .auto
        if controller.floatingButton != floating { controller.floatingButton = floating }
        if controller.shakeTrigger != shake { controller.shakeTrigger = shake }
        if controller.screenshotTrigger != screenshot { controller.screenshotTrigger = screenshot }
        if controller.recording != recording { controller.recording = recording }
        if controller.enabled != config.enabled { controller.enabled = config.enabled }
    }
    private func cloud() throws -> KueCloudConfiguration { guard let value = configuration.cloud else { throw KueError(code: .invalidConfig) }; return value }
    private func state() async throws -> [String: Any] {
        let count: Int
        if let config = configuration.cloud { count = try await KueOutbox.shared.pending(config: config, includeOtherDestinations: true).count }
        else { count = 0 }
        return ["enabled": controller.enabled, "savedCount": controller.savedFindings.count, "pendingCount": count,
            "groupLocked": controller.groupLocked, "groupFull": controller.groupFull,
            "recordingAvailability": controller.recordingAvailability.rawValue, "recordingActive": controller.recordingActive,
            "recorderIncluded": controller.recorderIncluded, "capturing": controller.capturingImage]
    }
    func sendState() {
        guard alive else { return }; stateGeneration += 1; let generation = stateGeneration
        Task { [weak self] in
            guard let self else { return }
            do { let value = try await self.state(); guard self.alive, generation == self.stateGeneration else { return }; let encoded = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
                guard encoded != self.lastState else { return }; self.lastState = encoded
                self.event("state", ["state": value]) }
            catch { if self.alive, generation == self.stateGeneration { self.event("error", ["error": KueBridgeDTO.error(error)]) } }
        }
    }
    private func cancelCommands() { commands.values.forEach { $0.cancel() }; commands.removeAll() }
    func perform(_ method: String, arguments: [String: Any]) async throws -> Any {
        // Updates must be able to cancel a slow utility without cancelling their own acknowledgement.
        guard ["features", "status", "retryPendingReports"].contains(method) else { return try await handle(method, arguments: arguments) }
        guard alive, controller.enabled, controller.foregroundActive else { throw KueError(code: .disabled) }
        let token = UUID()
        let task = Task { @MainActor [weak self] () throws -> Any in
            guard let self, self.alive else { throw CancellationError() }
            return try await self.handle(method, arguments: arguments)
        }
        commands[token] = task; defer { commands.removeValue(forKey: token) }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    func handle(_ method: String, arguments: [String: Any]) async throws -> Any {
        switch method {
        case "update":
            guard let values = arguments["config"] as? [String: Any] else { throw KueBridgeFailure("invalid_config") }
            // Explicit opt-out always takes precedence over all rejected configuration changes.
            if values["enabled"] as? Bool == false { cancelCommands(); if controller.enabled { controller.enabled = false } }
            if values["recording"] as? String == "off", controller.recording != .off { controller.recording = .off }
            let next = try KueBridgeConfiguration(values)
            guard next.fingerprint == configuration.fingerprint else { sendState(); throw KueBridgeFailure("configuration_changed") }
            try applyMutable(next); configuration = next; sendState()
        case "reportIssue":
            guard operationID == nil else { throw KueError(code: .busy) }
            guard let operation = arguments["operationId"] as? String, !operation.isEmpty, operation.utf8.count <= 128 else { throw KueBridgeFailure("invalid_config") }
            operationID = operation
            do { try controller.reportIssue(memo: arguments["memo"] as? String ?? "", context: KueBridgeDTO.context(arguments["context"] as? [String: Any])) }
            catch { if operationID == operation { operationID = nil }; throw error }
        case "openSavedFindings": controller.openSavedFindings()
        case "openOutbox": controller.openOutbox()
        case "beginRecording": if controller.recording == .off { throw KueError(code: .disabled) }; controller.beginRecording()
        case "stopRecording": controller.stopRecording()
        case "state": return try await state()
        case "features": return KueBridgeDTO.features(try await controller.refreshProjectFeatures())
        case "status":
            guard let receipt = arguments["receipt"] as? [String: Any], let reportID = receipt["clientReportId"] as? String,
                  let id = receipt["id"] as? String, let status = receipt["status"] as? String, let token = receipt["receiptToken"] as? String else { throw KueError(code: .invalidReport) }
            return KueBridgeDTO.status(try await controller.readReportStatus(KueReceipt(clientReportId: reportID, id: id, status: status, receiptToken: token)))
        case "pendingReports": return try await KueOutbox.shared.pending(config: cloud(), includeOtherDestinations: arguments["includeOtherDestinations"] as? Bool ?? false).map(KueBridgeDTO.pending)
        case "retryPendingReports":
            try await KueOutbox.shared.retryPending(config: cloud(), force: arguments["force"] as? Bool ?? false,
                active: { [weak self] in await MainActor.run { self?.alive == true && self?.controller.enabled == true && self?.controller.foregroundActive == true } },
                onReceipt: { [weak self] receipt in await MainActor.run { self?.event("receipt", ["receipt": KueBridgeDTO.receipt(receipt)]) } },
                onError: { [weak self] error in await MainActor.run { self?.event("error", ["error": KueBridgeDTO.error(error)]) } })
            sendState()
        case "discardPendingReport":
            guard let id = arguments["clientReportId"] as? String else { throw KueError(code: .invalidReport) }
            let includeOtherDestinations = arguments["includeOtherDestinations"] as? Bool ?? false
            let destination = try cloud()
            // Storage checks destination and in-flight ownership atomically.
            try await KueOutbox.shared.discard(id: id, config: includeOtherDestinations ? nil : destination); sendState()
        case "trigger":
            guard let id = arguments["subscriptionId"] as? String else { throw KueBridgeFailure("invalid_config") }; subscriptions[id]?()
        default: throw KueBridgeFailure("unsupported_operation")
        }
        return ["ok": true]
    }
}

@MainActor final class KueFlutterAnchor: UIView {
    let sessionID: String, owner = UUID()
    weak var plugin: KuePlugin?
    init(frame: CGRect, sessionID: String, plugin: KuePlugin) {
        self.sessionID = sessionID; self.plugin = plugin; super.init(frame: frame)
        isUserInteractionEnabled = false; accessibilityElementsHidden = true; backgroundColor = .clear
        plugin.bind(self)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func didMoveToWindow() { super.didMoveToWindow(); if window != nil { plugin?.bind(self) } }
}
@MainActor final class KueFlutterPlatformView: NSObject, FlutterPlatformView {
    private let anchor: KueFlutterAnchor
    private let cleanup: @MainActor () -> Void
    init(_ anchor: KueFlutterAnchor) {
        self.anchor = anchor
        let id = anchor.sessionID, owner = anchor.owner, plugin = anchor.plugin
        cleanup = { [weak plugin] in plugin?.anchorDisposed(id, owner: owner) }
    }
    func view() -> UIView { anchor }
    deinit { let cleanup = cleanup; Task { @MainActor in cleanup() } }
}
@MainActor final class KueFlutterAnchorFactory: NSObject, FlutterPlatformViewFactory {
    weak var plugin: KuePlugin?
    init(_ plugin: KuePlugin) { self.plugin = plugin }
    func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol { FlutterStandardMessageCodec.sharedInstance() }
    func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
        let id = (args as? [String: Any])?["sessionId"] as? String ?? ""
        guard let plugin else { return KueEmptyPlatformView() }
        return KueFlutterPlatformView(KueFlutterAnchor(frame: frame, sessionID: id, plugin: plugin))
    }
}
@MainActor private final class KueEmptyPlatformView: NSObject, FlutterPlatformView { func view() -> UIView { UIView(frame: .zero) } }

/// Recorder registration is scoped by the engine's messenger, independent of plugin order.
@MainActor public enum KueFlutterRecordingRegistry {
    private final class Entry {
        weak var messenger: AnyObject?
        weak var plugin: KuePlugin?
        var owner: String?
        var factory: (@MainActor () -> any KueRecordingProvider)?
        init(_ messenger: AnyObject) { self.messenger = messenger }
    }
    private static var entries: [ObjectIdentifier: Entry] = [:]
    private static func entry(_ messenger: AnyObject) -> Entry {
        entries = entries.filter { $0.value.messenger != nil }
        let key = ObjectIdentifier(messenger); if let value = entries[key] { return value }
        let value = Entry(messenger); entries[key] = value; return value
    }
    static func connect(messenger: AnyObject, plugin: KuePlugin) { let value = entry(messenger); value.plugin = plugin }
    static func disconnect(messenger: AnyObject, plugin: KuePlugin) { let value = entry(messenger); if value.plugin === plugin { value.plugin = nil } }
    static func provider(messenger: AnyObject) -> (any KueRecordingProvider)? { entry(messenger).factory?() }
    public static func install(messenger: AnyObject, owner: String, factory: @escaping @MainActor () -> any KueRecordingProvider) {
        let value = entry(messenger); value.owner = owner; value.factory = factory; value.plugin?.installProviderFactory(factory)
    }
    public static func remove(messenger: AnyObject, owner: String) {
        let value = entry(messenger); guard value.owner == owner else { return }
        value.owner = nil; value.factory = nil; value.plugin?.installProviderFactory(nil)
    }
}
