#if canImport(UIKit)
import UIKit
import SwiftUI

@MainActor final class KueGroupDestination {
    let cloud: KueCloudConfiguration?, handler: ((KueReportGroup) async throws -> Void)?, label: String
    init(cloud: KueCloudConfiguration?, handler: ((KueReportGroup) async throws -> Void)?, label: String) {
        self.cloud = cloud; self.handler = handler; self.label = label
    }
    var identity: String? { cloud.map { KueOutbox.destination($0) } }
}
extension KueController {
    var isForeground: Bool {
        guard enabled, let window else { return false }
        if let scene = window.windowScene { return scene.activationState == .foregroundActive }
        // Legacy UIApplicationDelegate windows do not have a UIWindowScene.
        // Never use application-global state for a scene-owned window.
        return !window.isHidden && UIApplication.shared.applicationState == .active
    }
    var idle: Bool { isForeground && editor == nil && presentation == nil && recordTask == nil && recordedVideo == nil && pendingRecordingError == nil && !recordingChecking && !captureInFlight && !menuPresented && overlay?.menuIsVisible != true }
    var effectiveCloud: KueCloudConfiguration? { if case .cloud(let config) = destination { return config }; return cloud }
    var durable: Bool { offlineQueue && { if case .cloud = destination { return true }; return false }() }
    public var groupLocked: Bool { draft.locked }
    public var groupFull: Bool { draft.full }
    var preparedGroupTitle: String? { draft.prepared?.title }
    public var groupAvailable: Bool { makeGroupDestination() != nil }
    public var groupDestinationValid: Bool {
        guard let saved = groupDestination else { return true }
        return saved.handler != nil || saved.identity == makeGroupDestination()?.identity
    }
    var groupLabel: String {
        let saved = groupDestination ?? makeGroupDestination()
        // Destination ownership is frozen with the finding, but a built-in
        // Cloud action's presentation follows the current UI locale.
        if saved?.cloud != nil, saved?.handler == nil { return text("Issueを作る", "Create Issue") }
        return saved?.label ?? text("送信", "Submit")
    }
    func text(_ ja: String, _ en: String) -> String { locale == .ja ? ja : en }
    func makeGroupDestination() -> KueGroupDestination? {
        if let handler = onSubmitGroup {
            let label = groupSubmitLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? {
                if case .local(let label, _) = destination { return label }; return ""
            }()
            guard !label.isEmpty else { return nil }
            return KueGroupDestination(cloud: effectiveCloud, handler: handler, label: label)
        }
        if case .cloud(let config) = destination {
            return KueGroupDestination(cloud: config, handler: nil, label: text("Issueを作る", "Create Issue"))
        }
        return nil
    }
    func installLifecycle() {
        guard lifecycleObservers.isEmpty, let window else { return }
        guard let scene = window.windowScene else {
            for name in [UIApplication.didBecomeActiveNotification, UIApplication.willResignActiveNotification] {
                lifecycleObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                    Task { @MainActor in
                        guard let self, let window = self.window, window.windowScene == nil else { return }
                        if notification.name == UIApplication.didBecomeActiveNotification { self.activeConfigurationChanged() }
                        else { self.pauseForInactivity() }
                    }
                })
            }
            return
        }
        for name in [UIScene.didActivateNotification, UIScene.willDeactivateNotification, UIScene.didEnterBackgroundNotification] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(forName: name, object: scene, queue: .main) { [weak self] notification in
                Task { @MainActor in
                    guard let self else { return }
                    if notification.name == UIScene.didActivateNotification { self.activeConfigurationChanged() }
                    else if notification.name == UIScene.didEnterBackgroundNotification { self.backgrounded() }
                    else { self.pauseForInactivity() }
                }
            })
        }
    }
    func pauseForInactivity() {
        recorder.transition(.inactive)
        if captureInFlight { reportFlow.cancel() }
        editor?.cancelUpload(); outboxGeneration += 1; uploadTask?.cancel(); uploadTask = nil
        groupSendTask?.cancel()
        manualOutboxTask?.cancel()
        captureGeneration += 1; captureTask?.cancel(); captureTask = nil; captureOperation?.cancel(); captureOperation = nil; captureInFlight = false
        triggerGeneration += 1; customTriggers.stop()
        pendingMenuAction = nil; ownedMenu?.dismiss(animated: false); ownedMenu = nil; menuPresented = false
        overlay?.closeMenu()
        foregroundTimer?.invalidate(); foregroundTimer = nil; triggerSubscription?.stop()
        overlay?.isHidden = true
    }
    /// OS consent/temporary inactive state must not destroy an owned ReplayKit startup.
    func backgrounded() {
        pauseForInactivity()
        featureGeneration += 1; featureTask?.cancel(); featureTask = nil
        recordStartTask?.cancel(); recordStartTask = nil; recordingChecking = false
        // Finalize while the process is allowed to run; never upload or present from background.
        // The generation stays valid so the completed clip can be reviewed on activation.
        if recordTask != nil { stopRecording() }
    }
    func interrupted() {
        pauseForInactivity()
        featureGeneration += 1; featureTask?.cancel(); featureTask = nil; recordingChecking = false
        invalidateRecording(closeReview: false)
    }
    func invalidateRecording(closeReview: Bool) {
        recordGeneration += 1; recordStartTask?.cancel(); recordStartTask = nil
        recordTask?.cancel(); recorder.transition(.invalidated); recordTask = nil
        recordingStopRequested = false
        let hadVideo = recordedVideo != nil
        recorder.release(recordedVideo); recordedVideo = nil; pendingRecordingError = nil
        recordingContext = nil; recordDestination = nil
        if closeReview && hadVideo { closeEditor() }
    }
    func presentPendingRecording() {
        guard isForeground, presentation == nil, !menuPresented else { return }
        if let video = recordedVideo {
            presentSDK(KueRecordingReview(controller: self, video: video) { [weak self] in self?.discardRecording() })
        } else if let failure = pendingRecordingError {
            pendingRecordingError = nil; showError(failure)
        }
    }
    func activeConfigurationChanged() {
        if !enabled { interrupted(); if presentation != nil { closeEditor() }; refreshButton(); return }
        refreshButton(); updateTriggers()
        if recording == .off || (recordDestination != nil && recordDestination?.identity != effectiveCloud.map({ KueOutbox.destination($0) })) {
            invalidateRecording(closeReview: true); recordingChecking = false
            refreshButton()
        }
        if captureInFlight { captureGeneration += 1; captureTask?.cancel(); captureTask = nil; captureOperation?.cancel(); captureOperation = nil; captureInFlight = false }
        featureGeneration += 1; featureTask?.cancel(); projectFeatures = nil
        updateRecordingAvailability(failed: false)
        guard isForeground else { return }
        presentPendingRecording()
        if effectiveCloud != nil && recording != .off {
            featureTask = Task { [weak self] in _ = try? await self?.refreshProjectFeatures() }
        }
        foregroundTimer?.invalidate()
        if durable {
            foregroundTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.flushOutbox() }
            }
            flushOutbox()
        }
    }
    func updateRecordingAvailability(failed: Bool) {
        recordingAvailability = .resolve(mode: recording, hasCloud: effectiveCloud != nil,
            features: projectFeatures, failed: failed, nativeAvailable: recorder.included)
        if recordingAvailability == .ready && !recorder.available { recordingAvailability = .unavailable }
    }
    @discardableResult public func refreshProjectFeatures() async throws -> KueProjectFeatures {
        guard let config = effectiveCloud else { updateRecordingAvailability(failed: false); throw KueError(code: .recordingNeedsCloud) }
        let generation = featureGeneration; let destination = KueOutbox.destination(config)
        do {
            let features = try await KueCloudClient(configuration: config, transport: transport).projectFeatures(); try Task.checkCancellation()
            guard isForeground, generation == featureGeneration, effectiveCloud.map({ KueOutbox.destination($0) }) == destination else { throw CancellationError() }
            projectFeatures = features; updateRecordingAvailability(failed: false); return features
        } catch {
            if generation == featureGeneration && !(error is CancellationError) { projectFeatures = nil; updateRecordingAvailability(failed: true) }
            throw error
        }
    }
    public func readReportStatus(_ receipt: KueReceipt) async throws -> KueReportStatus {
        guard let config = effectiveCloud else { throw KueError(code: .invalidConfig) }
        return try await KueCloudClient(configuration: config, transport: transport).reportStatus(receipt)
    }
    func updateTriggers() {
        triggerSubscription?.stop()
        triggerGeneration += 1; let generation = triggerGeneration
        customTriggers.stop()
        guard idle else { return }
        let open: @MainActor () -> Void = { [weak self] in
            guard let self, self.idle, generation == self.triggerGeneration else { return }
            do { try self.reportIssue() } catch { self.onError?(error as? KueError ?? KueError(code: .captureFailed)) }
        }
        if shakeTrigger || screenshotTrigger {
            if triggerSubscription == nil { triggerSubscription = KueNativeTriggers() }
            triggerSubscription?.start(shake: shakeTrigger, screenshot: screenshotTrigger, open: open)
        }
        customTriggers.start(triggers, open: open, error: { [weak self] error in self?.onError?(error as? KueError ?? KueError(code: .captureFailed)) })
    }
    func flushOutbox(force: Bool = false) {
        guard durable, let config = effectiveCloud, idle, uploadTask == nil else { return }
        outboxGeneration += 1; let generation = outboxGeneration
        uploadTask = Task { [weak self] in
            guard let self else { return }; defer { if self.outboxGeneration == generation { self.uploadTask = nil } }
            do {
                try await KueOutbox.shared.retryPending(config: config, force: force,
                    active: { await self.idle },
                    send: { [client = KueCloudClient(configuration: config, transport: self.transport)] report in try await client.submit(report) },
                    onReceipt: { receipt in await self.forwardOutboxReceipt(receipt) },
                    onError: { error in await self.forwardOutboxError(error) })
            } catch { if !Task.isCancelled { self.onError?(error as? KueError ?? KueError(code: .storageUnreadable)) } }
        }
    }
    private func forwardOutboxReceipt(_ receipt: KueReceipt) { if isForeground { onReceipt?(receipt) } }
    private func forwardOutboxError(_ error: KueError) { if isForeground { onError?(error) } }
    func deliverSingle(_ report: KueReport, destination: KueDestination) async throws -> Bool {
        switch destination {
        case .local(_, let callback):
            do { try await callback(report); return false }
            catch { throw KueError.localCallbackFailure(error) }
        case .cloud(let config):
            if durable {
                let result = try await KueOutbox.shared.submit(report, config: config,
                    send: { [client = KueCloudClient(configuration: config, transport: transport)] report in try await client.submit(report) })
                switch result { case .accepted(let receipt): if !Task.isCancelled { onReceipt?(receipt) }; return false
                case .queued(let id): if !Task.isCancelled { onQueued?(id) }; return true }
            }
            let receipt = try await KueCloudClient(configuration: config, transport: transport).submit(report); if !Task.isCancelled { onReceipt?(receipt) }; return false
        }
    }
    func addFinding(_ finding: KueFinding) throws {
        guard let destination = groupDestination ?? makeGroupDestination(), groupDestinationValid else { throw KueError(code: .destinationChanged) }
        try draft.add(finding); groupDestination = destination; savedFindings = draft.findings; refreshButton()
    }
    public func removeSavedFinding(_ id: String) throws { try draft.remove(id); savedFindings = draft.findings; if savedFindings.isEmpty { groupDestination = nil }; refreshButton() }
    public func discardSavedFindings() throws {
        guard !groupSubmitting else { throw KueError(code: .busy) }
        draft = KueGroupDraft(); savedFindings = []; groupDestination = nil; groupRetryAt = nil; refreshButton()
    }
    public func submitSavedFindings(title: String) async throws {
        try Task.checkCancellation()
        guard isForeground else { throw KueError(code: .disabled) }
        guard !groupSubmitting, let destination = groupDestination, groupDestinationValid else { throw KueError(code: .destinationChanged) }
        guard groupRetryAt == nil || groupRetryAt! <= Date() else { throw KueError(code: .busy) }
        let group = try draft.prepare(title: title); groupSubmitting = true; defer { groupSubmitting = false }
        let client = destination.cloud.map { KueCloudClient(configuration: $0, transport: transport) }
        let operation = Task<Void, Error> {
            try Task.checkCancellation()
            if let callback = destination.handler {
                do { try await callback(group) }
                catch { throw KueError.localCallbackFailure(error) }
            }
            else if let client {
                let receipt = try await client.submit(group); if !Task.isCancelled && self.isForeground { self.onReceipt?(receipt) }
            } else { throw KueError(code: .invalidConfig) }
            // Acceptance is authoritative even if cancellation arrived after a validated receipt.
            if self.draft.prepared?.clientReportId == group.clientReportId {
                self.draft = KueGroupDraft(); self.savedFindings = []; self.groupDestination = nil; self.groupRetryAt = nil; self.refreshButton()
            }
        }
        groupSendTask = operation; defer { groupSendTask = nil }
        do {
            try await withTaskCancellationHandler(operation: { try await operation.value }, onCancel: { operation.cancel() })
        } catch is CancellationError { throw CancellationError()
        } catch {
            let failure = error as? KueError ?? KueError(code: .networkError, retryable: true)
            groupRetryAt = failure.retryAfter.map { Date().addingTimeInterval($0) }; if isForeground && !operation.isCancelled { onError?(failure) }; throw failure
        }
    }
    func presentSDK<V: View>(_ view: V) {
        guard let root = window?.rootViewController, presentation == nil else { return }
        let controller = UIHostingController(rootView: view); controller.modalPresentationStyle = .fullScreen
        presentation = controller; var presenter = root; while let next = presenter.presentedViewController { presenter = next }
        presenter.present(controller, animated: true); refreshButton(); updateTriggers()
    }
    public func openSavedFindings() {
        guard idle, !savedFindings.isEmpty else { return }
        presentSDK(KueGroupReview(controller: self) { [weak self] in self?.closeEditor() })
    }
    public func openOutbox() {
        guard idle, durable, let config = effectiveCloud else { return }
        presentSDK(KueOutboxView(controller: self, config: config) { [weak self] in self?.closeEditor() })
    }
    public var recordingActive: Bool { recordTask != nil }
    public var capturingImage: Bool { captureInFlight }
    public var foregroundActive: Bool { isForeground }
    public var recorderIncluded: Bool { recorder.included }
    /// Owned KUE presentation only, never an unrelated host view controller.
    public var reporterOpen: Bool {
        enabled && isForeground && (editor != nil || presentation != nil || menuPresented || overlay?.menuIsVisible == true)
    }
    /// Interaction state for embedding adapters; background/disabled hosts are not interactive.
    public var busy: Bool { enabled && isForeground && !idle }
    public func stopRecording() {
        guard recordTask != nil, !recordingStopRequested else { return }
        recordingStopRequested = true; refreshButton(); recorder.stop()
    }
    public func beginRecording() {
        guard idle, recording != .off, let config = effectiveCloud, groupAvailable else { showError(KueError(code: .recordingNeedsCloud)); return }
        if groupLocked || groupFull || !groupDestinationValid { openSavedFindings(); return }
        recordingChecking = true; updateTriggers()
        let snapshot = KueOutbox.destination(config)
        recordGeneration += 1; let generation = recordGeneration
        recordStartTask = Task { [weak self] in
            guard let self else { return }; defer { if self.recordGeneration == generation { self.recordingChecking = false; self.recordStartTask = nil; self.updateTriggers() } }
            do {
                let features = try await self.refreshProjectFeatures()
                guard features.recording.entitled else { throw KueError(code: .recordingNeedsIndie) }
                guard features.recording.available else { throw KueError(code: .recordingUnavailable) }
                guard self.recorder.included else { throw KueError(code: .recorderMissing) }
                guard self.recorder.available else { throw KueError(code: .recordingUnavailable) }
                guard self.isForeground, self.recordGeneration == generation, self.presentation == nil, self.effectiveCloud.map({ KueOutbox.destination($0) }) == snapshot else { return }
                self.recordDestination = self.makeGroupDestination(); self.recordingContext = self.currentContext()
                self.recordTask = Task { [weak self] in
                    guard let self else { return }
                    do {
                        let video = try await self.recorder.record()
                        guard !Task.isCancelled, self.enabled, self.window != nil, self.recordGeneration == generation else { self.recorder.release(video); throw CancellationError() }
                        self.recordedVideo = video; self.recordTask = nil; self.recordingStopRequested = false
                        self.presentPendingRecording()
                    } catch {
                        if self.recordGeneration == generation { self.recordTask = nil; self.recordingStopRequested = false }
                        if !Task.isCancelled && self.recordGeneration == generation {
                            self.pendingRecordingError = error as? KueError ?? KueError(code: .recordingFailed)
                            self.presentPendingRecording()
                        }
                    }
                    self.refreshButton(); self.updateTriggers()
                }
                self.refreshButton()
            } catch {
                if self.isForeground && self.recordGeneration == generation { self.showError(error as? KueError ?? KueError(code: .recordingVerificationFailed)) }
            }
        }
    }
    func currentContext() -> KueReportContext {
        KueReportContext(osVersion: UIDevice.current.systemVersion, deviceModel: Self.deviceModel(),
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            buildNumber: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
            screenWidth: window.map { Double($0.bounds.width) }, screenHeight: window.map { Double($0.bounds.height) }, route: route).merging(context)
    }
    func saveRecording(memo: String) throws {
        guard let video = recordedVideo, let context = recordingContext, let destination = recordDestination,
              destination.identity == effectiveCloud.map({ KueOutbox.destination($0) }), groupDestinationValid else { throw KueError(code: .destinationChanged) }
        let report = try KueVideoReport(memo: memo, videoData: Data(contentsOf: video.file), durationMs: video.durationMs,
            outputSize: KueImageSize(width: video.width, height: video.height), context: context, capturedAt: video.capturedAt)
        try addFinding(.video(report)); recorder.release(video); recordedVideo = nil; recordingContext = nil; recordDestination = nil
        closeEditor()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.openSavedFindings() }
    }
    func discardRecording() { invalidateRecording(closeReview: false); closeEditor() }
    func showError(_ error: KueError) {
        onError?(error)
        let message: String
        switch error.code {
        case .recordingNeedsCloud: message = text("録画にはCloud接続とまとめ送信の設定が必要です。", "Recording requires Cloud and a group destination.")
        case .recordingNeedsIndie: message = text("録画には有効なIndieプランが必要です。", "Recording requires an active Indie plan.")
        case .recorderMissing: message = text("録画モジュールを追加してアプリを再ビルドしてください。", "Add the recording module and rebuild the app.")
        case .recordingUnavailable: message = text("この環境では録画を利用できません。", "Recording is unavailable in this environment.")
        default: message = text("処理を完了できません。接続と設定を確認してください。", "Could not finish. Check the connection and configuration.")
        }
        presentMessage(message, plansURL: error.code == .recordingNeedsIndie ? effectiveCloud?.plansURL : nil)
    }
    private func presentMessage(_ message: String, plansURL: URL? = nil) {
        guard isForeground, let root = window?.rootViewController else { return }
        let alert = KueOwnedMenu(title: "KUE", message: message, preferredStyle: .alert)
        ownedMenu = alert; menuPresented = true; refreshButton(); updateTriggers()
        alert.didClose = { [weak self, weak alert] in
            guard let self, self.ownedMenu === alert else { return }
            self.ownedMenu = nil; self.menuPresented = false; self.refreshButton(); self.updateTriggers()
            self.dispatchMenuAction()
        }
        if let plansURL {
            alert.addAction(UIAlertAction(title: text("プランを見る", "View plans"), style: .default) { [weak self] _ in
                self?.pendingMenuAction = { [weak self] in
                    guard let self else { return }
                    KuePlansBrowser.open(plansURL, using: self.openBrowser) {
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.presentMessage(self.text("ブラウザを開けませんでした。", "Could not open the browser."))
                        }
                    }
                }
                self?.dispatchMenuAction()
            })
        }
        alert.addAction(UIAlertAction(title: text("閉じる", "Close"), style: .cancel))
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        presenter.present(alert, animated: true)
    }
    func openActions() {
        let actions = floatingActions()
        guard idle, !actions.isEmpty else { return }
        let menu = KueOwnedMenu(title: "KUE", message: nil, preferredStyle: .actionSheet)
        ownedMenu = menu; menuPresented = true; refreshButton(); updateTriggers()
        func add(_ title: String, action: @escaping () -> Void) {
            menu.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in
                self?.pendingMenuAction = action; self?.dispatchMenuAction()
            })
        }
        for action in actions { add(action.title, action: action.select) }
        menu.addAction(UIAlertAction(title: text("閉じる", "Close"), style: .cancel))
        menu.didClose = { [weak self] in
            guard let self else { return }; self.menuPresented = false; self.ownedMenu = nil
            self.refreshButton(); self.updateTriggers()
            self.dispatchMenuAction()
        }
        if let popover = menu.popoverPresentationController { popover.sourceView = overlay?.button; popover.sourceRect = overlay?.button.bounds ?? .zero }
        var presenter = window?.rootViewController
        while let next = presenter?.presentedViewController { presenter = next }
        presenter?.present(menu, animated: true)
    }
    func dispatchMenuAction() {
        guard !menuPresented, let action = pendingMenuAction else { return }
        pendingMenuAction = nil
        DispatchQueue.main.async { [weak self] in guard let self, self.idle else { return }; action() }
    }
    func floatingActions() -> [KueFloatingAction] {
        var actions: [KueFloatingAction] = []
        if !savedFindings.isEmpty { actions.append(KueFloatingAction(id: "issue", title: groupLabel + " (\(savedFindings.count))", locked: false, select: { [weak self] in self?.openSavedFindings() })) }
        if recording != .off && effectiveCloud != nil && groupAvailable {
            actions.append(KueFloatingAction(id: "recording", title: recordingAvailability == .upgrade ? text("画面録画 · Indie", "Screen recording · Indie") : text("画面録画", "Screen recording"), locked: recordingAvailability == .upgrade, select: { [weak self] in self?.beginRecording() }))
        }
        if durable { actions.append(KueFloatingAction(id: "outbox", title: text("送信待ち", "Pending reports"), locked: false, select: { [weak self] in self?.openOutbox() })) }
        return actions
    }
}
#endif
