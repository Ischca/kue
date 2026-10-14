# KUE for iOS — 0.6.0

The archive root is a self-contained Swift package. In Xcode, choose Add Local
Package and select this directory. Add the Kue product to the application target;
add KueRecorder only for silent screen recording. SwiftUI and UIKit use the same
KueController. See the public source API comments for options and defaults.

For CocoaPods, add pod 'Kue', :path => './sdk/kue-ios' in the application target.
Optionally add pod 'KueRecorder', :path => './sdk/kue-ios', then run pod install.
No private repository checkout or account configuration is required for local
callbacks. The podspec source identifies the matching release archive.

Requires iOS 15+, Swift 5.9+. The public products are Kue and optional KueRecorder.
The generated manifest omits only the development test target; runtime sources
and mascot resources are copied unchanged. Do not install duplicate core copies
through both this package and a Flutter/RN artifact containing the native core.

KUE is disabled by default in Release. Recording requires a group destination,
Cloud entitlement, optional provider and device consent. Opening an editor or
adding a finding does not submit. No microphone/camera permission is needed.
Use the matching Git tag for Swift Package Manager or this archive with local CocoaPods :path. No CocoaPods Trunk installation is required.

## Minimal integration

A minimal SwiftUI integration retains one controller and displays local callback completion:

```swift
import SwiftUI
import Kue

@MainActor final class FeedbackSession: ObservableObject {
    @Published var lastMemo = ""
    lazy var kue = KueController(destination: .local(submitLabel: "Save") { [weak self] report in
        self?.lastMemo = report.memo
    })
}

@main struct FeedbackApp: App {
    var body: some Scene { WindowGroup { FeedbackScreen() } }
}

@MainActor struct FeedbackScreen: View {
    @StateObject private var session = FeedbackSession()
    var body: some View {
        VStack {
            Text(session.lastMemo)
            Button("Report") { try? session.kue.reportIssue(memo: "Check this screen") }
        }.background(KueHost(session.kue).frame(width: 0, height: 0))
    }
}
```

For UIKit, retain the controller in the screen or window owner and attach after its view enters a window:

```swift
import UIKit
import Kue

@MainActor final class FeedbackViewController: UIViewController {
    private let result = UILabel()
    private lazy var kue = KueController(destination: .local(submitLabel: "Save") { [weak self] report in
        self?.result.text = report.memo
    })
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        result.frame = CGRect(x: 24, y: 100, width: 280, height: 80)
        view.addSubview(result)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let window = view.window { kue.attach(to: window) }
    }
    func removeFeedbackIntegration() { kue.detach() }
}
```

Do not detach solely because an SDK presentation calls the host's `viewDidDisappear`. Detach when removing the integration or its window. Both examples use the default enabled state: enabled in Debug, disabled in Release. A production host that intentionally enables KUE must pass `enabled: true`. These callback results stay in memory; the host implements persistence if needed. Groups and recording require the separate configuration below.

## Capture and findings

1. Tap the floating control, or call `try kue.reportIssue(memo: "Inspect padding", context: .init(route: "/products/sample"))`.
2. The initial selection is the full screenshot. Drag the selected rectangle to move it; drag its four corners to resize it. Each normalized dimension has a 12% UI minimum; programmatically prepared reports retain the protocol's separate crop validation.
3. Enter a nonempty memo, then use the keyboard's **Done / 完了** action to commit input.
4. Use the destination action to submit a single finding. **Add finding / 指摘を追加** keeps it locally without submission.
5. With an editable saved draft, the main action adds the current finding and opens group review. A full or already prepared draft cannot accept another finding; the screen explicitly identifies a new capture as a separate report and provides access to the saved draft.
6. In group review, inspect previews, remove findings, enter a required title and explicitly confirm the complete submission.

A group contains 1–10 ordered image/video findings and at most 20 MiB of media. Images are at most 10 MiB each; videos are at most 20 MiB each. Titles are limited to 200 Unicode codepoints, with no CR/LF/NUL. Memos are trimmed nonempty UTF-8 text, at most 4 KiB, without NUL. Group manifests are limited to 48 KiB.

The hold menu includes saved findings when the draft is nonempty, recording when Cloud and a group destination are configured and recording is not off, and pending reports when the durable outbox is enabled. With no actions, holding and releasing captures normally. A menu uses labelled targets beside the button, including a fan layout when a column does not fit; release over a target selects it, while release at the trigger or outside cancels. VoiceOver and small surfaces use the same actions in a list. Movement and edge hiding remain accessibility actions; hiding is unavailable during recording, while movement remains available. An edge-hidden control reveals on the first tap and captures on the next. Built-in Cloud group labels follow the current locale even when the saved draft was created in another language. Explicit callback labels remain verbatim; changing the locale does not rewrite the draft title, media or destination.

The first group submission freezes its ID, title, order, media and metadata. Retry sends exactly that prepared payload; it never sends individual findings as a fallback. Removing/editing a prepared group is disabled, and discarding an unknown-result group requires confirmation. Drafts are session-local owned data, not restored after process termination. Abandoned SDK MP4 preview/recording cache files are removed once when the next process creates its first controller. They are distinct from the durable single-report outbox.

A custom destination is `.local(submitLabel: "Save", onSubmit: { report in ... })`. It receives immutable PNG/JPEG bytes and metadata; success means only that the callback completed. `onSubmitGroup` and a nonempty `groupSubmitLabel` provide a separate whole-group callback. Groups never invoke `onSubmit` once per finding. A local single callback takes precedence over `cloud`; that optional configuration still serves recording entitlement checks when a group callback is present. Cloud-only singles and a custom group callback can also be combined. Existing local draft callbacks remain captured for that draft.

An untyped local callback failure becomes retryable `local_save_failed`, with a localized local-save message and the prepared report/group retained. It does not imply a network or Cloud failure. Explicit `KueError` values keep their code, status and retry policy; cancellation remains cancellation. Callback error messages are not included in the SDK error.

## Recording

Recording requires a group destination, a Cloud connection and a fresh `GET /v1/project/features` entitlement check, including when the group goes to a local handler. The UI distinguishes Cloud required, checking, verification failed, Indie upgrade, Cloud/device unavailable, missing native module/rebuild, ready and runtime off. Free remains an upgrade state, not a missing-module state. Verification failure never grants recording.

Start recording from the hold menu or `beginRecording()`. The existing floating control becomes a red square; tap it to stop. The optional ReplayKit provider writes silent, single-video-track H.264 MP4, ignores application/microphone audio and disables camera/microphone capture. It limits output to 60 seconds and 20 MiB, stopping earlier for size, orientation/dimension change or platform interruption. Temporary inactivity pauses capture triggers/uploads without cancelling an owned native start/recording. Actual background stops/finalizes the recording and retains a valid clip/context in memory for review on activation; it does not present or upload from background. Disable/detach/configuration changes cancel and release owned recording media. It does not cancel another controller's recording.

A full or locked draft, or a draft bound to another Cloud destination, opens saved-findings review before any recording starts. Restore that draft's destination or explicitly discard it before recording another finding. After an explicit stop, the control says **Stopping recording / 録画を停止中** and disables repeated stop taps until finalization completes. Completion, disable and detach clear that owned stop state.

After stopping, preview the clip and enter a required memo. Saving joins the same explicit-confirmation group flow; recording never uploads automatically and never becomes a single-image report or outbox item. SDK-owned temporary recordings/previews are released on save/discard. No Photos, microphone or camera access is requested by the screenshot/core integration. ReplayKit can display its system recording consent UI.

The Free-plan recording alert offers **View plans / プランを見る**. This explicit action opens `/app` at the validated Cloud origin and never includes the project key. Failure to open the browser displays a localized message. Missing native support, environmental unavailability and verification failure remain separate recording states.

Memo fields provide a native **Done / 完了** keyboard accessory that commits composition before dismissing. The editor observes actual keyboard-frame changes and adds scroll space to keep the whole field above the keyboard, including third-party layouts. While editing, the native text view owns its text, composition and selection; binding updates do not replace the in-progress input. Recording playback keeps one player across memo/focus updates; closing its review pauses and releases that player.

## Durable outbox

`offlineQueue` defaults to `false` and engages only for Cloud single-image submissions. It writes the immutable report before uploading, with limits of **10 reports / 50 MiB of image bytes / 7 days**. Storage is inside app Application Support with backup exclusion requested. The SDK does not encrypt stored memo/media; the host's file-protection and backup policy also apply. Retry state is atomically replaced separately from the immutable report. Partial initial writes are never uploaded. Invalid or linked storage is rejected rather than read/retargeted.

Retryable failures leave `pending` entries; terminal failures leave `blocked` entries. Automatic foreground/idle retries use 30-second exponential backoff capped at one hour and respect the longer `Retry-After`. The controller checks on activation and every 60 seconds while active/idle. There is no background service or automatic group/video conversion. A manual retry from the outbox uses `force: true`, bypassing blocked/backoff/Retry-After state for the current destination only.

Entries are bound to the origin and project key by a local digest. Rotation or switching does not retarget old reports. The outbox lists other destinations for explicit discard only. Expired entries are removed during listing/submission/retry. A known accepted receipt commits cleanup even if cancellation arrives late; notifications can still be suppressed. Cleanup failures retain the same idempotency key for safe recovery.

Standalone APIs are `KueOutbox.shared.pending(config:includeOtherDestinations:)`, `submit(_:config:)`, `retryPending(config:force:active:onReceipt:onError:)` and `discard(id:config:)`. Standalone callers must supply their own foreground policy through `active`; the mounted controller enforces its window's lifecycle automatically.

## Controls, context and triggers

`enabled` defaults to Debug-only; Release requires explicit `enabled: true`. `floatingButton` defaults to true; the stop control remains available during an owned recording. `buttonDesign` is classic or mascot, with the same artwork as Expo. `locale` is Japanese/English with device-language fallback.

Drag the control to move it. Releasing within eight points of an edge docks it with an 18-point visible handle. The first docked tap reveals it; a second tap captures. A 500 ms hold opens labelled actions beside the control: release on an item/name to select, or outside to cancel. Screen readers and surfaces that cannot fit the menu use an accessible action list. Accessibility actions move, hide and open operations.

Automatic context includes iOS, OS version, hardware model, bundle version/build and window dimensions in points; capture/output sizes use pixels. Merge precedence is automatic values, adapter context, `kue.context`, then per-call overrides. `route` remains a convenience override. No personal device name, identifier, account or location is collected automatically.

Optional `shakeTrigger` uses an SDK-owned motion instance and two strong movements; `screenshotTrigger` listens to the OS notification and captures the current app window without reading Photos. Both default off. Custom `triggers: [KueTriggerSource]` subscribe only while enabled/foreground/idle. Each async subscription returns its teardown; even a late result after cancellation is immediately unsubscribed and cannot open a stale editor.

A custom `capture: KueCaptureAdapter` returns `KueCapturedImage(image:capturedAt:context:)`. The default adapter captures the attached UIKit window with KUE hidden. Adapter output is normalized upright for crop coordinates. Use `reportIssueAsync(memo:context:)` to await a custom adapter and handle its error; the compatible synchronous `reportIssue` starts it and reports asynchronous failures through `onError`. Capture generations prevent stale results after background, detach or configuration changes. `onCaptureFinished` reports capture completion separately from the editor result; a non-nil error aborts that capture. `onReportOutcome` resolves one screenshot flow as submitted, queued, finding added or cancelled. Independent group/outbox receipts do not emit this outcome. Late completions from an old editor cannot resolve a new flow.

Embedding adapters can use `updateLocalSubmitLabel(_:)` to change future local editor labels while retaining already prepared destinations, and `installRecordingProvider(_:)` to register an optional native provider. `recordingActive`, `capturingImage`, `foregroundActive` and `recorderIncluded` expose metadata-only state. `stopRecording()` stops only the controller's owned recording. Asynchronous recording completion publishes the updated `recordingActive` state, including stop/error paths, so embedding observers do not need to poll. The local CocoaPods specs consume these same core/recorder sources; the documented installation uses the source archive with `:path`.

## Cloud protocol and receipts

Cloud uses `POST /v1/reports` for a single screenshot and `POST /v1/report-groups` for a confirmed group. Headers are Bearer project authorization and `Idempotency-Key`; group fields are `manifest` plus `capture_0…`. Image metadata is schema 1; video metadata is schema 2. Prepared bytes/IDs stay immutable on retry. Requests use an ephemeral session without cookies, credential storage or cache and reject redirects.

`apiBaseURL` must be an HTTPS origin with no credentials, path except `/`, query or fragment. The key matches `pk_` plus 8–128 ASCII letters/digits/underscore/hyphen. Timeout defaults to 15 seconds and accepts a finite value greater than zero up to 120 seconds. Debug plus explicit `allowLocalhostHTTP: true` permits loopback HTTP fixtures only; Release rejects HTTP even with that flag. Host ATS policy is separate.

A valid HTTP 202 receipt means accepted/queued, **not completed Issue creation**. `projectFeatures()` reads typed schema-1 capabilities. `reportStatus(_:)` or `kue.readReportStatus(_:)` performs one status read using the receipt's secret capability rather than the project key. There is no automatic polling. Status parsing requires an explicit null/object `githubIssue` and validates status/Issue URL/error shapes. `receiptToken` must never be logged or attached to an Issue.

`KueError` exposes `code`, optional HTTP `status`, sanitized `serverCode`, `retryable` and `retryAfter` seconds. The SDK does not log captures, memos, keys or receipt tokens. Long `Retry-After` values display a safe “more than one day” countdown while the full deadline still prevents early automatic/inline retry. Screenshots/memos may contain sensitive visible content; review before submitting. No automatic redaction is provided.

`KueCloudClient(configuration:transport:)` and `kue.transport` accept a `Sendable` custom `KueHTTPTransport`. The default remains `KueURLSessionTransport`. A custom transport must reject redirects, avoid cookies/credential forwarding and cooperate with cancellation; it does not relax configuration or response validation. Controller-owned single/group/manual-outbox/capture operations are cancelled when their window leaves the foreground, is disabled or is detached. A validated acceptance still commits its cleanup if cancellation arrives late.

