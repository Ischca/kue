## Local capture and save

Place one host outside the root Navigator using `MaterialApp.builder`. A host requires `cloud` or an explicit `onSubmit`; a local callback takes precedence if both are specified. Groups require their own `onSubmitGroup` or Cloud destination and never fall back to calling `onSubmit` per finding. Local callbacks require a nonempty submission label.

```dart
final kue = KueController();

Future<void> saveReport(KueLocalReport report) async {
  // Persist immutable imageBytes, memo, metadata and clientReportId here.
}
Future<void> saveGroup(KueReportGroup group) async {
  // Save the whole ordered group atomically; findings may include video.
}

MaterialApp(
  builder: (context, child) => KueHost(
    controller: kue,
    onSubmit: saveReport,
    onSubmitGroup: saveGroup,
    submitLabel: 'Save locally',
    child: child!,
  ),
  home: const ProductScreen(),
);
final outcome = await kue.reportIssue(memo: 'Inspect the cart padding');
```

Success means the callback completed, not that an Issue was created. The native editor remains open after a failed save and permits explicit retry. Retries use the same immutable content and `clientReportId`; callbacks must implement idempotency if repeating a save could create duplicates. Editing a failed report creates new content/ID. Callback timeout defaults to 30 seconds and accepts whole milliseconds from 1 to 120000. Callback media is copied and bounded to 20 MiB total before crossing the channel. Exceptions are sanitized; receipt/error observer failures cannot change accepted submission state. Cancellation cannot roll back a callback's external effects.

Default capture waits for Flutter painting and encodes the host's `RepaintBoundary` as PNG with longest edge at most 2048 pixels. Logical host dimensions become `context.screenWidth/Height`; capture dimensions use image pixels. Only Flutter content inside the host is captured. OS bars, native dialogs, PlatformViews, maps/WebViews, external textures, protected content and other native surfaces are not guaranteed. Verify actual screenshots for those surfaces or provide `capture: Future<KueCapturedImage> Function()` returning PNG and UTC timestamp. Adapter images are validated before native editing (10 MiB / 16 million pixels maximum). No native-window fallback is attempted. An invisible iOS platform-view anchor outside the captured subtree binds the native controller to the correct Flutter engine/window.

## Native interface and recording

The floating classic/mascot button supports tap, safe-area drag, edge docking/reveal and a 500 ms hold menu when saved findings, configured recording or a Cloud outbox provide actions. An empty local host has no menu: releasing a hold captures normally. Native accessible actions expose screenshot, saved findings, recording and pending reports. `shakeTrigger` and `systemScreenshotTrigger` default to false; OS screenshot triggering depends on native platform/version support. Custom `triggers` receive an `open` function and return a synchronous or asynchronous cleanup function. Late setup after unsubscribe/timeout/unmount releases its cleanup once; stale `open` calls are ignored.

The editor requires a rectangle and nonempty memo. Add findings without sending, review/remove them, and explicitly confirm the whole group. Group drafts are in-memory; they are not automatically restored after process termination. A full or locked group still permits a separate single screenshot. `KueRuntimeState` is metadata-only and never repeatedly sends media across the channel.

`recording` defaults to `auto`. Recording needs Cloud feature checks even when a custom local group callback will save the result. Availability order is off → Cloud required → checking/check failed → upgrade (not Indie) → unavailable (server admission disabled) → rebuild (recorder absent) → ready. Features are rechecked before starting. OS recording consent is required. Recording is silent H.264 MP4, capped below 60 seconds/20 MiB, stops on background or size/orientation limits, and adds a video finding after explicit memo confirmation. A video is submitted only inside an explicitly confirmed group. There is no single-video endpoint or automatic video upload. Simulator support is determined by the actual recorder; physical-device validation remains a separate gate.

## Cloud and durable screenshot outbox

```dart
KueHost(
  controller: kue,
  cloud: const KueCloudConfig(
    apiBaseUrl: 'https://cloud.example.test',
    projectKey: 'pk_example_project',
  ),
  offlineQueue: true,
  onReceipt: (receipt) { /* Never log receiptToken. */ },
  onQueued: (clientReportId) { /* Saved locally; not accepted yet. */ },
  child: child!,
);
```

The fake values above are placeholders. `apiBaseUrl` must be an HTTPS origin without credentials/path/query/fragment; the public create-only key is `pk_` plus 8–128 URL-safe characters. Explicit `allowDevelopmentLocalhostHttp: true` permits HTTP only in debug mode for localhost, 127.0.0.1 and ::1; app ATS/network-security policy is separate. For Android local QA, use an explicitly scoped adb reverse mapping and the localhost origin. The Flutter preflight does not accept the emulator host alias 10.0.2.2. Cloud timeout defaults to 15 seconds, whole milliseconds 1–120000. Redirects are disabled and the timeout includes response body reading.

Native delivery uses `POST /v1/reports` (screenshot/memo/metadata) or `POST /v1/report-groups` (manifest/ordered files), Bearer project key and stable idempotency key. HTTP 202 `received`/`queued` is acceptance, not completed Issue creation. Receipt tokens are secret read capabilities. `features()` checks project entitlement/admission; `status(receipt)` reads delivery using only the receipt token, with no automatic polling. `KueCloudClient` also offers standalone Dart submit, group submit, feature/status queries; `prepareKueReport`/`prepareKueReportGroup` preserve exact multipart bytes for explicit retries. Native controllers own host submission/queueing and do not invoke the Dart client.

| Payload | Limit |
| --- | --- |
| Required memo | 4 KiB UTF-8, trimmed nonempty, no NUL |
| Screenshot | JPEG/PNG, 10 MiB; metadata 16 KiB |
| Group | 1–10 findings, 20 MiB total media; manifest 48 KiB |
| Group title | 200 Unicode codepoints, trimmed nonempty, no CR/LF/NUL |
| Video finding | 20 MiB, at most 60000 ms; silent, self-contained non-fragmented H.264 `avc1` MP4 |
| Video dimensions | Each edge ≤4096, area ≤8388608 pixels |
| Context strings | OS/app/build 128 UTF-8 bytes, model 256, route 2048 |

Cloud independently inspects admission, payload/media, quota and delivery. Retry keeps the same ID/title/order/bytes and never partially falls back. Automatic retries respect backoff and `Retry-After`; permanent rejections block retry. Editing creates a new report. The standalone Dart client rejects nonfinite or longer-than-30-day numeric `Retry-After` with `unexpected_response`; native clients bound excessive delays without automatically retrying sooner.

Native channel errors preserve whole-millisecond retry delays from 0 through
9007199254740991. A negative, malformed or larger delay preserves the original
error code/HTTP status/server code but becomes nonretryable with no Dart delay,
preventing Duration overflow or an earlier inferred retry. This boundary does
not shorten the native outbox deadline; explicit force retry remains explicit.
Callback timeouts preserve `request_timeout` whichever Dart/native deadline wins.
Unknown local callback errors use `local_save_failed`; capture adapter failures
use `capture_failed`. Native error DTOs omit private callback exception messages.
Pending-report timestamps crossing the native channel are display-only epoch
milliseconds clamped to Dart DateTime's inclusive range
−8640000000000000 through 8640000000000000. This does not change the stored native
deadline, TTL, backoff or eligibility for retry.

`offlineQueue` defaults to false and applies only to Cloud singles without `onSubmit`. Groups, videos and custom local saves never enter it. The native app-private outbox stores immutable screenshot content before first send, with global bounds of 10 items / 50 MiB / 7 days. There is no SDK encryption; app backup policy applies. The destination is bound without persisting the project key; changed keys/origins cannot retarget old entries. Those entries can be inspected/discarded. Valid acceptance removes the owned entry. `onQueued` denotes local durable storage; `onReceipt` denotes server acceptance.

Automatic flush is serial, enabled+foreground+idle only, at startup/resume and periodic checks; there are no background upload tasks. Retryable failures defer with exponential backoff (30 seconds up to 1 hour, or longer server delay), permanent failures become blocked. **Explicit manual `retryPendingReports(force: true)` bypasses blocked/backoff/server delay**, matching the native/reference API; it still cannot change destination or send an in-flight entry twice. Discard cannot remove an in-flight report. Expired/corrupt entries are pruned on access, while active entries are protected.

## API and configuration lifecycle

| API/default | Behavior |
| --- | --- |
| `reportIssue({memo, context})` | Completes after native screenshot flow: submitted, queued, findingAdded, cancelled; disabled when absent/disabled/not foreground, busy for overlap. Capture failures throw `KueCloudError`. |
| `openSavedFindings`, `openOutbox` | Open native review/management UI. |
| `beginRecording`, `stopRecording` | Open native recording consent/stop/preview flow. |
| `features`, `status(receipt)` | Typed feature and delivery state queries. |
| `pendingReports({includeOtherDestinations:false})`, `retryPendingReports({force:false})`, `discardPendingReport(id,{includeOtherDestinations:false})` | Destination-bound native queue management. Explicit inclusion can list/discard old-destination entries; retry never retargets them. |
| `controller.state`, `onState` | Deduplicated attached/enabled/count/locked/full/recording metadata. |
| `enabled` | Defaults to `kDebugMode`; profile/release require explicit opt-in. |
| `floatingButton`, `buttonDesign` | true; classic or mascot. |
| `locale` | First supported device language ja/en, otherwise en. |
| `context` | Optional overrides; per-call values override host values, which override captured/native defaults. No identifying device ID/contact collection. |

One controller attaches to one mounted host. Locale/design/context/labels, floating/built-in triggers, enabled and recording mode update without remounting. Setting enabled false or recording off always stops the relevant integration, even if another simultaneous configuration change is rejected. Android disable clears the in-memory native draft; re-enable recreates a controller with the original frozen destination. Durable outbox entries remain.

Queue list/discard defaults to the current destination. Set
`includeOtherDestinations: true` explicitly to inspect or discard old entries;
this does not permit retrying them under a different key/origin. In-flight
discard protection remains enforced by native storage.

Cloud destination, local handler identity/presence, offlineQueue, custom trigger sources, capture adapter, callback timeout, controller and platform implementation are fixed per mount. Use stable function/method references. An attempted change invokes `onError` with `configuration_changed` and keeps frozen callbacks/destination. Restoring true/auto with an otherwise invalid configuration waits for a subsequent valid update; it cannot change destination. To change an immutable option, explicitly discard an in-memory draft and remount with a new key (and controller when required). Durable reports remain bound to their original destination. Native operations/callbacks carry session IDs; unmount/disable reject late acknowledgements. Cancelling a request cannot recall an already accepted report.

