#if canImport(UIKit)
import UIKit
import SwiftUI

public enum KueLocale: String, CaseIterable { case ja, en
    public static var preferred: KueLocale {
        for language in Locale.preferredLanguages {
            if language.hasPrefix("ja") { return .ja }; if language.hasPrefix("en") { return .en }
        }
        return .en
    }
}
public enum KueButtonDesign: String, CaseIterable { case classic, mascot }
public enum KueDestination {
    case local(submitLabel: String, onSubmit: (KueReport) async throws -> Void)
    case cloud(KueCloudConfiguration)
}

/// Retain one controller per host window. All presentation/capture APIs run on the main actor.
@MainActor public final class KueController: ObservableObject {
    public var locale: KueLocale { didSet { refreshButton() } }
    public var buttonDesign: KueButtonDesign = .classic { didSet { refreshButton() } }
    public var enabled: Bool { didSet { activeConfigurationChanged() } }
    public var floatingButton = true { didSet { refreshButton() } }
    public var route: String?
    public var context = KueContextOverrides()
    public var recording: KueRecordingMode = .auto { didSet { activeConfigurationChanged() } }
    public var offlineQueue = false { didSet { activeConfigurationChanged() } }
    public var shakeTrigger = false { didSet { updateTriggers() } }
    public var screenshotTrigger = false { didSet { updateTriggers() } }
    public var triggers: [KueTriggerSource] = [] { didSet { updateTriggers() } }
    public var capture: KueCaptureAdapter?
    /// Custom transports must preserve HTTPS, redirect rejection and credential/cookie isolation.
    public var transport: any KueHTTPTransport = KueURLSessionTransport() { didSet { activeConfigurationChanged() } }
    var openBrowser: (URL, @escaping (Bool) -> Void) -> Void = { url, completion in
        UIApplication.shared.open(url, options: [:], completionHandler: completion)
    }
    var captureGeneration = 0, triggerGeneration = 0
    var captureInFlight = false, menuPresented = false
    var captureTask: Task<Void, Never>?
    var captureOperation: Task<Void, Error>?
    let customTriggers = KueTriggerManager()
    weak var ownedMenu: KueOwnedMenu?
    var pendingMenuAction: (() -> Void)?
    public var cloud: KueCloudConfiguration? { didSet { activeConfigurationChanged() } }
    public var onSubmitGroup: ((KueReportGroup) async throws -> Void)?
    public var groupSubmitLabel: String?
    public var onQueued: ((String) -> Void)?
    /// Capture completion is distinct from submission; a non-nil error aborts this capture.
    public var onCaptureFinished: ((KueError?) -> Void)?
    /// One screenshot flow only. Independent group/outbox receipts never emit this callback.
    public var onReportOutcome: ((KueReportOutcome) -> Void)?
    let reportFlow = KueReportFlow()
    @Published public internal(set) var savedFindings: [KueFinding] = []
    @Published public internal(set) var projectFeatures: KueProjectFeatures?
    @Published public internal(set) var recordingAvailability: KueRecordingAvailability = .cloudRequired
    @Published public internal(set) var groupSubmitting = false
    var draft = KueGroupDraft()
    var groupDestination: KueGroupDestination?
    var groupRetryAt: Date?
    var groupSendTask: Task<Void, Error>?
    var uploadTask: Task<Void, Never>?
    var manualOutboxTask: Task<Void, Never>?
    var featureGeneration = 0
    var featureTask: Task<Void, Never>?
    var recordingChecking = false
    @Published var recordTask: Task<Void, Never>?
    var recordingStopRequested = false
    var recordStartTask: Task<Void, Never>?
    var recordGeneration = 0, outboxGeneration = 0
    var recordedVideo: KueCapturedVideo?
    var pendingRecordingError: KueError?
    var recordingContext: KueReportContext?
    var recordDestination: KueGroupDestination?
    let recorder = KueNativeRecorder()
    var foregroundTimer: Timer?
    var triggerSubscription: KueNativeTriggers?
    var lifecycleObservers: [NSObjectProtocol] = []
    public var onReceipt: ((KueReceipt) -> Void)?
    public var onError: ((KueError) -> Void)?
    private var updatingSubmitLabel = false
    public var destination: KueDestination { didSet { if !updatingSubmitLabel { activeConfigurationChanged() } } }
    weak var window: UIWindow?
    fileprivate var swiftUIAttachmentID: UUID?
    var overlay: KueFloatingOverlay?
    var editor: KueEditorModel?
    weak var presentation: UIViewController?
    private var backgroundObserver: NSObjectProtocol?

    nonisolated public static var defaultEnabled: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
    public init(destination: KueDestination, enabled: Bool = KueController.defaultEnabled, locale: KueLocale = .preferred,
                recorder: (any KueRecordingProvider)? = nil) {
        self.destination = destination; self.enabled = enabled; self.locale = locale
        KueSessionMedia.cleanOnce()
        self.recorder.provider = recorder
        reportFlow.onCaptureFinished = { [weak self] error in self?.onCaptureFinished?(error) }
        reportFlow.onOutcome = { [weak self] outcome in self?.onReportOutcome?(outcome) }
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.backgrounded() }
            }
    }
    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        lifecycleObservers.forEach { NotificationCenter.default.removeObserver($0) }; foregroundTimer?.invalidate()
        captureTask?.cancel()
        captureOperation?.cancel()
        groupSendTask?.cancel()
        manualOutboxTask?.cancel()
    }

    /// UIKit integration. Attach after the host's view has entered its window (for example viewDidAppear).
    public func attach(to window: UIWindow) {
        swiftUIAttachmentID = nil
        if self.window !== window { detach(); self.window = window }
        installLifecycle(); activeConfigurationChanged()
    }
    fileprivate func attach(to window: UIWindow, hostID: UUID) {
        attach(to: window)
        swiftUIAttachmentID = hostID
    }
    /// Removes the floating control. The host should call this when removing its integration.
    public func detach() {
        swiftUIAttachmentID = nil
        reportFlow.cancel()
        editor?.cancelUpload(); editor = nil
        interrupted(); triggerSubscription?.stop(); triggerSubscription = nil
        lifecycleObservers.forEach { NotificationCenter.default.removeObserver($0) }; lifecycleObservers = []
        draft = KueGroupDraft(); savedFindings = []; groupDestination = nil
        presentation?.dismiss(animated: false); presentation = nil
        overlay?.removeFromSuperview(); overlay = nil; window = nil
    }
    /// Changes only the label of future local editors; existing prepared destinations remain frozen.
    public func updateLocalSubmitLabel(_ label: String) throws {
        guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              case .local(_, let callback) = destination else { throw KueError(code: .invalidConfig) }
        updatingSubmitLabel = true; defer { updatingSubmitLabel = false }
        destination = .local(submitLabel: label, onSubmit: callback)
    }
    /// Optional integrations register their provider independently of the core product.
    public func installRecordingProvider(_ provider: (any KueRecordingProvider)?) {
        if recorder.provider === provider { return }
        invalidateRecording(closeReview: true); recorder.provider = provider; activeConfigurationChanged()
    }

    /// Captures the host window, then opens selection/memo UI. Does not submit by itself.
    public func reportIssue(memo: String = "", route: String? = nil, context overrides: KueContextOverrides = .init()) throws {
        guard enabled else { throw KueError(code: .disabled) }
        guard idle else { throw KueError(code: .busy) }
        if case .local(let label, _) = destination, label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw KueError(code: .invalidConfig)
        }
        guard let window, isForeground,
              let root = window.rootViewController, window.bounds.width > 0, window.bounds.height > 0 else {
            throw KueError(code: .captureFailed)
        }
        if let capture {
            let metadata = currentContext().merging(overrides).merging(route.map { .init(route: $0) } ?? .init())
            let operation = startCapture(capture, memo: memo, context: metadata,
                explicit: self.context.merging(overrides).merging(route.map { .init(route: $0) } ?? .init()))
            let generation = captureGeneration
            captureTask = Task { [weak self] in
                guard let self else { return }
                do { try await operation.value }
                catch { if generation == self.captureGeneration && !(error is CancellationError) { self.onError?(error as? KueError ?? KueError(code: .captureFailed)) } }
            }
            return
        }
        let token = reportFlow.begin()
        overlay?.isHidden = true
        let format = UIGraphicsImageRendererFormat(); format.scale = window.screen.scale; format.opaque = true
        var captured = false
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            captured = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard captured, image.cgImage != nil else {
            reportFlow.captured(token, error: KueError(code: .captureFailed))
            overlay?.isHidden = false; throw KueError(code: .captureFailed)
        }
        var context = KueReportContext(osVersion: UIDevice.current.systemVersion, deviceModel: Self.deviceModel(),
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            buildNumber: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
            screenWidth: Double(window.bounds.width), screenHeight: Double(window.bounds.height), route: self.route)
            .merging(self.context).merging(overrides)
        if let route { context = context.merging(.init(route: route)) }
        let model = KueEditorModel(image: image, memo: memo, context: context, destination: destination,
                                  locale: locale, onReceipt: onReceipt, onError: onError, reportToken: token)
        editor = model
        model.controller = self
        let presentation = UIHostingController(rootView: KueEditor(model: model, controller: self) { [weak self] in self?.closeEditor() })
        self.presentation = presentation
        presentation.modalPresentationStyle = .fullScreen
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        presenter.present(presentation, animated: true)
        reportFlow.captured(token)
        updateTriggers()
    }
    public func reportIssueAsync(memo: String = "", context overrides: KueContextOverrides = .init()) async throws {
        try Task.checkCancellation()
        guard enabled else { throw KueError(code: .disabled) }
        guard idle else { throw KueError(code: .busy) }
        guard let capture else { try reportIssue(memo: memo, context: overrides); return }
        if case .local(let label, _) = destination, label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw KueError(code: .invalidConfig)
        }
        guard let window, isForeground, window.bounds.width > 0, window.bounds.height > 0 else {
            throw KueError(code: .captureFailed)
        }
        let operation = startCapture(capture, memo: memo, context: currentContext().merging(overrides), explicit: self.context.merging(overrides))
        try await withTaskCancellationHandler(operation: { try await operation.value }, onCancel: { operation.cancel() })
    }
    private func startCapture(_ capture: @escaping KueCaptureAdapter, memo: String, context: KueReportContext,
                              explicit: KueContextOverrides) -> Task<Void, Error> {
        let token = reportFlow.begin()
        captureInFlight = true; captureGeneration += 1; let generation = captureGeneration
        updateTriggers(); overlay?.isHidden = true
        let operation = Task { [weak self] in
            guard let self else { throw CancellationError() }
            try await self.performCapture(capture, memo: memo, context: context, explicit: explicit, generation: generation, token: token)
        }
        captureOperation = operation
        return operation
    }
    private func performCapture(_ capture: KueCaptureAdapter, memo: String, context: KueReportContext,
                                explicit: KueContextOverrides, generation: Int, token: UUID) async throws {
        defer {
            if captureGeneration == generation { captureInFlight = false; captureTask = nil; captureOperation = nil; refreshButton(); updateTriggers() }
        }
        let captured: KueCapturedImage
        do { captured = try await capture(); try Task.checkCancellation() }
        catch {
            if error is CancellationError { reportFlow.finish(token, outcome: .cancelled) }
            else { reportFlow.captured(token, error: error as? KueError ?? KueError(code: .captureFailed)) }
            throw error
        }
        guard captureGeneration == generation, isForeground, let root = window?.rootViewController, presentation == nil else {
            reportFlow.finish(token, outcome: .cancelled); throw CancellationError()
        }
        guard let source = captured.image.cgImage, captured.capturedAt.timeIntervalSince1970.isFinite else {
            reportFlow.captured(token, error: KueError(code: .captureFailed)); throw KueError(code: .captureFailed)
        }
        let image: UIImage
        if captured.image.imageOrientation == .up { image = captured.image }
        else {
            let quarter = [.left, .leftMirrored, .right, .rightMirrored].contains(captured.image.imageOrientation)
            let size = CGSize(width: CGFloat(quarter ? source.height : source.width)/captured.image.scale,
                              height: CGFloat(quarter ? source.width : source.height)/captured.image.scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = captured.image.scale
            image = UIGraphicsImageRenderer(size: size, format: format).image { _ in captured.image.draw(in: CGRect(origin: .zero, size: size)) }
        }
        let model = KueEditorModel(image: image, memo: memo, context: context.merging(captured.context).merging(explicit), destination: destination,
            locale: locale, onReceipt: onReceipt, onError: onError, capturedAt: captured.capturedAt, reportToken: token)
        model.controller = self; editor = model
        let host = UIHostingController(rootView: KueEditor(model: model, controller: self) { [weak self] in self?.closeEditor() })
        host.modalPresentationStyle = .fullScreen; presentation = host
        var presenter = root; while let next = presenter.presentedViewController { presenter = next }; presenter.present(host, animated: true)
        reportFlow.captured(token)
    }
    func finishReport(_ token: UUID?, outcome: KueReportOutcome) { if let token { reportFlow.finish(token, outcome: outcome) } }
    func closeEditor() {
        finishReport(editor?.reportToken, outcome: .cancelled)
        guard let presentation else { editor = nil; overlay?.isHidden = false; return }
        presentation.dismiss(animated: true) { [weak self, weak presentation] in
            guard let self, self.presentation === presentation else { return }
            self.editor = nil; self.presentation = nil; self.overlay?.isHidden = false
            self.updateTriggers(); self.flushOutbox()
        }
    }
    func refreshButton() {
        guard let window else { return }
        if !enabled || (!floatingButton && recordTask == nil) { overlay?.removeFromSuperview(); overlay = nil; return }
        if overlay == nil {
            let view = KueFloatingOverlay(frame: window.bounds)
            view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.open = { [weak self] in
                guard let self else { return }
                if self.recordTask != nil { self.stopRecording(); return }
                do { try self.reportIssue() } catch { self.onError?(error as? KueError ?? KueError(code: .captureFailed)) }
            }
            view.openMenu = { [weak self] in self?.openActions() }
            view.actions = { [weak self] in self?.floatingActions() ?? [] }
            view.menuVisibilityChanged = { [weak self] in self?.updateTriggers() }
            window.addSubview(view); overlay = view
        }
        overlay?.setRecording(recordTask != nil, stopping: recordingStopRequested)
        overlay?.update(design: buttonDesign, locale: locale)
        overlay?.setCount(savedFindings.count)
        overlay?.isHidden = presentation != nil || captureInFlight || menuPresented || !isForeground
    }
    static func deviceModel() -> String {
        var system = utsname(); uname(&system)
        let capacity = MemoryLayout.size(ofValue: system.machine)
        return withUnsafePointer(to: &system.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: capacity) { String(cString: $0) }
        }
    }
}

/// SwiftUI integration: place this zero-sized view in the host's background and retain its controller.
public struct KueHost: UIViewRepresentable {
    private let controller: KueController
    public init(_ controller: KueController) { self.controller = controller }
    public func makeUIView(context: Context) -> UIView { KueAttachView(controller: controller) }
    public func updateUIView(_ uiView: UIView, context: Context) {
        guard let host = uiView as? KueAttachView, host.controller !== controller else { return }
        host.bind(to: controller)
    }
    public static func dismantleUIView(_ uiView: UIView, coordinator: ()) {
        (uiView as? KueAttachView)?.removeIntegration()
    }
}
private final class KueAttachView: UIView {
    weak var controller: KueController?
    private weak var attachedController: KueController?
    private weak var attachedWindow: UIWindow?
    private var synchronization: Task<Void, Never>?
    private var removed = false
    private let attachmentID = UUID()
    init(controller: KueController) { self.controller = controller; super.init(frame: .zero); isUserInteractionEnabled = false }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Full-screen SDK presentation temporarily removes the presenting view
        // from its window. Only representable dismantling ends its integration.
        if window != nil { synchronizeLater() }
    }
    func bind(to controller: KueController) {
        self.controller = controller
        synchronizeLater()
    }
    private func synchronizeLater() {
        synchronization?.cancel()
        // Attachment updates observable SDK state. Run after SwiftUI has finished
        // installing/updating this representable, and re-check its actual window.
        synchronization = Task { @MainActor [weak self] in
            guard let self, !Task.isCancelled, !self.removed else { return }
            self.synchronization = nil
            let next = self.controller, window = self.window
            if let previous = self.attachedController,
               previous !== next || (window != nil && self.attachedWindow !== window) {
                if previous.swiftUIAttachmentID == self.attachmentID { previous.detach() }
                self.attachedController = nil; self.attachedWindow = nil
            }
            guard let next, let window else { return }
            guard self.attachedController !== next || self.attachedWindow !== window || next.swiftUIAttachmentID != self.attachmentID else { return }
            next.attach(to: window, hostID: self.attachmentID)
            self.attachedController = next; self.attachedWindow = window
        }
    }
    func removeIntegration() {
        removed = true; synchronization?.cancel(); synchronization = nil
        let previous = attachedController, attachmentID = self.attachmentID
        attachedController = nil; attachedWindow = nil; controller = nil
        Task { @MainActor [weak previous] in
            // A replacement host can already own this controller in the same window.
            guard let previous, previous.swiftUIAttachmentID == attachmentID else { return }
            previous.detach()
        }
    }
}

struct KueFloatingAction {
    let id: String, title: String, locked: Bool, select: () -> Void
}
private final class KueTriggerButton: UIButton {
    var hitMargin: CGFloat = 6
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.insetBy(dx: -hitMargin, dy: -hitMargin).contains(point)
    }
}
final class KueFloatingOverlay: UIView {
    private let triggerButton = KueTriggerButton(type: .custom)
    var button: UIButton { triggerButton }
    var open: (() -> Void)?, openMenu: (() -> Void)?
    var actions: (() -> [KueFloatingAction])?
    var menuVisibilityChanged: (() -> Void)?
    var menuIsVisible: Bool { !menuControls.isEmpty }
    private var placed = false, recording = false, stopping = false, locale = KueLocale.en
    private var dock: String?
    private let badge = UILabel()
    private var hold: UILongPressGestureRecognizer!, pan: UIPanGestureRecognizer!
    private var touchActive = false, touchCancelled = false, dragged = false
    private var touchStart = CGPoint.zero, buttonStart = CGPoint.zero
    private var touchDock: String?
    private var menuLayout: KueMenuLayout?, shade: UIView?
    private var lastSafe = CGRect.zero
    private var menuControls: [UIControl] = [], menuActions: [KueFloatingAction] = []
    private var selected: Int?
    override init(frame: CGRect) {
        super.init(frame: frame); backgroundColor = .clear
        button.frame = CGRect(x: 0, y: 0, width: 54, height: 54); button.layer.cornerRadius = 27
        button.setTitleColor(.white, for: .normal); button.titleLabel?.font = .boldSystemFont(ofSize: 15)
        button.layer.shadowColor = UIColor(red: 2/255, green: 6/255, blue: 23/255, alpha: 1).cgColor
        button.accessibilityIdentifier = "kue-trigger"
        button.addTarget(self, action: #selector(touched(_:event:)), for: .touchDown)
        button.addTarget(self, action: #selector(moved(_:event:)), for: [.touchDragInside, .touchDragOutside])
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        button.addTarget(self, action: #selector(touchFinished), for: [.touchUpOutside, .touchCancel])
        hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:))); hold.minimumPressDuration = 0.5; hold.allowableMovement = 6
        pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:))); pan.maximumNumberOfTouches = 1; pan.require(toFail: hold)
        button.addGestureRecognizer(hold); button.addGestureRecognizer(pan)
        badge.frame = CGRect(x: 34, y: 0, width: 20, height: 16); badge.backgroundColor = Self.pink
        badge.textColor = .white; badge.textAlignment = .center; badge.font = .boldSystemFont(ofSize: 12)
        badge.layer.cornerRadius = 10; badge.clipsToBounds = true; badge.isUserInteractionEnabled = false; badge.isHidden = true
        button.addSubview(badge); addSubview(button)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, alpha > 0, safe.contains(point) else { return nil }
        if (touchActive || menuIsVisible || pan.state == .changed || pan.state == .began),
           (event?.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled }.count ?? 0) > 1 { cancelTouch(); return self }
        if !menuControls.isEmpty { return super.hitTest(point, with: event) ?? self }
        let reach: CGFloat = dock == nil ? 6 : 26
        guard button.frame.insetBy(dx: -reach, dy: -reach).contains(point) else { return nil }
        return button
    }
    private var safe: CGRect { bounds.inset(by: safeAreaInsets) }
    override func layoutSubviews() {
        super.layoutSubviews()
        if safe != lastSafe && menuIsVisible { closeMenu() }; lastSafe = safe
        let clipping = CAShapeLayer(); clipping.path = UIBezierPath(rect: safe).cgPath; layer.mask = clipping
        if !placed { button.center = CGPoint(x: safe.maxX - 43, y: safe.maxY - 39); placed = true }
        fitButton()
    }
    func update(design: KueButtonDesign, locale: KueLocale) {
        self.locale = locale
        let hasMenu = !recording && !(actions?().isEmpty ?? true)
        hold.isEnabled = hasMenu
        refreshPositionLabel()
        button.backgroundColor = recording ? .white : design == .classic ? UIColor(red: 21/255, green: 27/255, blue: 51/255, alpha: 1) : .clear
        button.layer.borderColor = recording ? Self.red.cgColor : UIColor.white.withAlphaComponent(0.16).cgColor
        button.layer.borderWidth = recording ? 2 : design == .classic ? 1 : 0
        button.setImage(recording ? Self.stopSquare() : design == .mascot ? Self.mascot() : Self.viewfinder(), for: .normal)
        button.layer.shadowOpacity = !recording && design == .mascot ? 0.18 : 0.3
        button.layer.shadowRadius = !recording && design == .mascot ? 3 : 8
        button.layer.shadowOffset = CGSize(width: 0, height: !recording && design == .mascot ? 2 : 6)
        var accessibleActions = [
            UIAccessibilityCustomAction(name: locale == .ja ? "左へ移動" : "Move left", target: self, selector: #selector(moveLeft)),
            UIAccessibilityCustomAction(name: locale == .ja ? "右へ移動" : "Move right", target: self, selector: #selector(moveRight)),
            UIAccessibilityCustomAction(name: locale == .ja ? "上へ移動" : "Move up", target: self, selector: #selector(moveUp)),
            UIAccessibilityCustomAction(name: locale == .ja ? "下へ移動" : "Move down", target: self, selector: #selector(moveDown))]
        if !recording { accessibleActions.append(UIAccessibilityCustomAction(name: locale == .ja ? "端に隠す" : "Hide at edge", target: self, selector: #selector(hideAction))) }
        if hasMenu { accessibleActions.append(UIAccessibilityCustomAction(name: locale == .ja ? "操作を開く" : "Open actions", target: self, selector: #selector(menuAction))) }
        button.accessibilityCustomActions = accessibleActions
    }
    func setRecording(_ active: Bool, stopping: Bool = false) {
        recording = active; self.stopping = active && stopping
        button.isEnabled = !self.stopping; button.alpha = self.stopping ? 0.82 : 1
        if active { dock = nil; fitButton(); closeMenu() }
        refreshPositionLabel()
    }
    func setCount(_ count: Int) { badge.text = String(count); badge.isHidden = count == 0 || recording }
    @objc private func touched(_ sender: UIButton, event: UIEvent) {
        guard !stopping, let touch = event.allTouches?.first else { return }
        touchActive = true; touchCancelled = false; dragged = false
        touchStart = touch.location(in: self); buttonStart = button.center; touchDock = dock; button.alpha = 0.7
        if (event.allTouches?.count ?? 0) > 1 { cancelTouch() }
    }
    @objc private func moved(_ sender: UIButton, event: UIEvent) {
        guard !stopping, !touchCancelled, !menuIsVisible, let touch = event.allTouches?.first else { return }
        if (event.allTouches?.count ?? 0) > 1 { cancelTouch(); return }
        let point = touch.location(in: self), delta = CGPoint(x: point.x - touchStart.x, y: point.y - touchStart.y)
        dragged = dragged || hypot(delta.x, delta.y) > 6
        if dragged && pan.state == .possible { dock = nil; button.center = CGPoint(x: buttonStart.x + delta.x, y: buttonStart.y + delta.y); fitButton() }
    }
    @objc private func touchFinished() { touchActive = false; button.alpha = 1 }
    private func cancelTouch() {
        touchCancelled = true; button.alpha = 1; closeMenu(); button.center = buttonStart; dock = touchDock; fitButton()
        hold.isEnabled = false; pan.isEnabled = false
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }; self.pan.isEnabled = true
            self.hold.isEnabled = !self.recording && !(self.actions?().isEmpty ?? true)
        }
    }
    @objc private func tapped() {
        touchFinished(); guard !stopping, !touchCancelled else { return }
        if dragged { if !recording { settle() }; return }
        if dock != nil && !recording { reveal(); return }; open?()
    }
    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        guard !stopping else { return }
        if gesture.state == .cancelled || gesture.state == .failed { touchFinished(); return }
        guard !touchCancelled, gesture.numberOfTouches <= 1 else { cancelTouch(); return }
        dock = nil; let translation = gesture.translation(in: self); dragged = true
        button.center = CGPoint(x: buttonStart.x + translation.x, y: buttonStart.y + translation.y); fitButton()
        if gesture.state == .ended && !recording { settle() }
    }
    private func fitButton() {
        button.center.x = min(max(button.center.x, safe.minX + 27), safe.maxX - 27)
        button.center.y = min(max(button.center.y, safe.minY + 27), safe.maxY - 27)
        if dock == "left" { button.center.x = safe.minX - 9 }
        if dock == "right" { button.center.x = safe.maxX + 9 }
        if dock == "top" { button.center.y = safe.minY - 9 }
        if dock == "bottom" { button.center.y = safe.maxY + 9 }
        triggerButton.hitMargin = dock == nil ? 6 : 26
        refreshPositionLabel()
    }
    private func nearest() -> (String, CGFloat) {
        [("left", button.frame.minX-safe.minX), ("right", safe.maxX-button.frame.maxX),
         ("top", button.frame.minY-safe.minY), ("bottom", safe.maxY-button.frame.maxY)].min { $0.1 < $1.1 }!
    }
    private func settle() { let edge = nearest(); if edge.1 <= 8 { dock = edge.0; fitButton() } }
    private func reveal() {
        let edge = dock; dock = nil; fitButton()
        if edge == "left" { button.center.x = min(safe.maxX - 27, safe.minX + 39) }
        if edge == "right" { button.center.x = max(safe.minX + 27, safe.maxX - 39) }
        if edge == "top" { button.center.y = min(safe.maxY - 27, safe.minY + 39) }
        if edge == "bottom" { button.center.y = max(safe.minY + 27, safe.maxY - 39) }
        refreshPositionLabel()
    }
    private func refreshPositionLabel() {
        button.accessibilityLabel = recording ? (stopping ? (locale == .ja ? "録画を停止中" : "Stopping recording") : (locale == .ja ? "録画を停止" : "Stop recording")) : dock != nil ? (locale == .ja ? "KUEを表示" : "Reveal KUE") : (locale == .ja ? "KUEで指摘する" : "Report with KUE")
        if stopping { button.accessibilityHint = locale == .ja ? "録画の準備が完了するまでお待ちください" : "Wait until the recording is ready for review." }
        else if recording { button.accessibilityHint = locale == .ja ? "タップで録画を停止、ドラッグで移動。停止ボタンは画面内に表示されます" : "Tap to stop recording or drag to move. Stop remains on screen." }
        else if dock != nil { button.accessibilityHint = locale == .ja ? "タップでボタン全体を表示、ドラッグで移動" : "Tap once to show the full button; drag to move." }
        else { let hasMenu = !(actions?().isEmpty ?? true)
            button.accessibilityHint = locale == .ja ? "タップで撮影、ドラッグで移動。画面端で隠せます" + (hasMenu ? "。長押し中にメニューを表示。スライドで選択、離して決定" : "") : "Tap to capture, drag to move, or drop at an edge to hide." + (hasMenu ? " Hold to open the menu, slide to an item and release to choose it." : "") }
    }
    func dockNearest() { guard !recording else { return }; dock = nearest().0; fitButton() }
    @objc private func hideAction() -> Bool { dockNearest(); return true }
    @objc private func menuAction() -> Bool { openMenu?(); return true }
    private func move(_ dx: CGFloat, _ dy: CGFloat) -> Bool { dock = nil; button.center = CGPoint(x: button.center.x+dx, y: button.center.y+dy); fitButton(); if !recording { settle() }; return true }
    @objc private func moveLeft() -> Bool { move(-32, 0) }
    @objc private func moveRight() -> Bool { move(32, 0) }
    @objc private func moveUp() -> Bool { move(0, -32) }
    @objc private func moveDown() -> Bool { move(0, 32) }
    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        guard !recording, !touchCancelled, !dragged else { return }
        if gesture.numberOfTouches > 1 { cancelTouch(); return }
        if gesture.state == .began {
            button.alpha = 1; reveal()
            if UIAccessibility.isVoiceOverRunning || !showMenu() { openMenu?(); return }
        }
        if gesture.state == .changed || gesture.state == .ended {
            let point = gesture.location(in: self)
            selected = menuLayout.flatMap { KueFloatingLayout.selection($0, pointer: point) }
            updateMenuSelection()
        }
        if gesture.state == .ended {
            let action = selected.flatMap { menuActions.indices.contains($0) ? menuActions[$0].select : nil }
            closeMenu(); action?()
        } else if gesture.state == .cancelled || gesture.state == .failed { closeMenu() }
    }
    private func showMenu() -> Bool {
        menuActions = actions?() ?? []; guard !menuActions.isEmpty else { return false }
        guard let layout = KueFloatingLayout.menu(origin: CGPoint(x: button.center.x - safe.minX, y: button.center.y - safe.minY),
                                                  bounds: safe.size, names: menuActions.map(\.title)) else { menuActions = []; return false }
        menuLayout = layout.offsetBy(dx: safe.minX, dy: safe.minY)
        let shade = UIView(frame: safe); shade.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 0.22)
        shade.isUserInteractionEnabled = false; insertSubview(shade, at: 0); self.shade = shade
        for (index, action) in menuActions.enumerated() {
            let item = menuLayout!.items[index], rect = menuLayout!.labels[index]
            let circle = CGRect(x: item.x - 22, y: item.y - 22, width: 44, height: 44)
            let frame = circle.union(rect), control = UIControl(frame: frame)
            control.accessibilityElementsHidden = true; control.isAccessibilityElement = false
            control.accessibilityIdentifier = "kue-radial-\(action.id)"
            let icon = UIImageView(frame: circle.offsetBy(dx: -frame.minX, dy: -frame.minY)); icon.tag = 1
            icon.contentMode = .center; icon.layer.cornerRadius = 22
            let label = UILabel(frame: rect.offsetBy(dx: -frame.minX, dy: -frame.minY)); label.tag = 2
            label.text = action.title; label.textAlignment = .center
            label.font = .systemFont(ofSize: 14, weight: .semibold); label.textColor = .white
            label.adjustsFontSizeToFitWidth = true; label.minimumScaleFactor = 0.8; label.lineBreakMode = .byTruncatingTail
            label.layer.cornerRadius = 15
            control.addSubview(icon); control.addSubview(label); addSubview(control); menuControls.append(control)
        }
        updateMenuSelection()
        menuVisibilityChanged?(); return true
    }
    private func updateMenuSelection() {
        for (index, control) in menuControls.enumerated() {
            let active = selected == index
            for view in control.subviews {
                view.backgroundColor = active ? Self.pink : Self.navy
                view.layer.borderWidth = 1; view.layer.borderColor = UIColor.white.withAlphaComponent(active ? 1 : 0.16).cgColor
                view.layer.shadowColor = UIColor(red: 2/255, green: 6/255, blue: 23/255, alpha: 1).cgColor
                view.layer.shadowOpacity = 0.28; view.layer.shadowRadius = 6; view.layer.shadowOffset = CGSize(width: 0, height: 4)
                if let icon = view as? UIImageView { icon.image = Self.menuIcon(menuActions[index].id, active: active) }
            }
        }
    }
    func closeMenu() { let wasOpen = !menuControls.isEmpty; shade?.removeFromSuperview(); shade = nil; menuControls.forEach { $0.removeFromSuperview() }; menuControls = []; menuActions = []; menuLayout = nil; selected = nil; if wasOpen { menuVisibilityChanged?() } }
    private static let navy = UIColor(red: 21/255, green: 27/255, blue: 51/255, alpha: 1)
    private static let pink = UIColor(red: 219/255, green: 39/255, blue: 119/255, alpha: 1)
    private static let red = UIColor(red: 220/255, green: 38/255, blue: 38/255, alpha: 1)
    private static func menuIcon(_ id: String, active: Bool) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { _ in
            UIColor.white.setStroke()
            let path = UIBezierPath(); path.lineWidth = 2.5
            switch id {
            case "recording":
                let ring = UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 20, height: 20)); ring.lineWidth = 2.5; ring.stroke()
                (active ? UIColor.white : UIColor(red: 1, green: 91/255, blue: 152/255, alpha: 1)).setFill()
                UIBezierPath(ovalIn: CGRect(x: 8, y: 8, width: 8, height: 8)).fill()
            case "outbox":
                path.move(to: CGPoint(x: 5, y: 11)); path.addLine(to: CGPoint(x: 12, y: 4)); path.addLine(to: CGPoint(x: 19, y: 11))
                path.move(to: CGPoint(x: 12, y: 4)); path.addLine(to: CGPoint(x: 12, y: 21)); path.stroke()
            default:
                path.move(to: CGPoint(x: 5, y: 12)); path.addLine(to: CGPoint(x: 10, y: 17)); path.addLine(to: CGPoint(x: 20, y: 6)); path.stroke()
            }
        }
    }
    private static func mascot() -> UIImage? {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let owner = Bundle(for: KueController.self)
        let resources = owner.url(forResource: "KueResources", withExtension: "bundle")
            ?? Bundle.main.url(forResource: "KueResources", withExtension: "bundle")
        let bundle = resources.flatMap(Bundle.init(url:)) ?? owner
        #endif
        guard let artwork = UIImage(named: "kue-mascot", in: bundle, compatibleWith: nil) else { return nil }
        return UIGraphicsImageRenderer(size: CGSize(width: 54, height: 54)).image { _ in artwork.draw(in: CGRect(x: 0, y: 8.25, width: 54, height: 37.5)) }
    }
    private static func stopSquare() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { _ in red.setFill(); UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 22, height: 22), cornerRadius: 3).fill() }
    }
    private static func viewfinder() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
            context.cgContext.setStrokeColor(UIColor.white.cgColor); context.cgContext.setLineWidth(2.5)
            for (x, y, dx, dy) in [(1.25, 1.25, 1.0, 1.0), (22.75, 1.25, -1.0, 1.0), (1.25, 22.75, 1.0, -1.0), (22.75, 22.75, -1.0, -1.0)] {
                let path = UIBezierPath(); path.move(to: CGPoint(x: x+7*dx, y: y)); path.addLine(to: CGPoint(x: x, y: y)); path.addLine(to: CGPoint(x: x, y: y+7*dy)); path.lineWidth = 2.5; path.stroke()
            }
            UIColor(red: 1, green: 91/255, blue: 152/255, alpha: 1).setFill(); UIBezierPath(ovalIn: CGRect(x: 8.5, y: 8.5, width: 7, height: 7)).fill()
        }
    }
}
#endif
