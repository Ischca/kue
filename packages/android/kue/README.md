# KUE Android SDK

Native Kotlin SDK for screenshot reports, grouped findings, optional recording and a durable screenshot outbox. It has no Expo or React Native dependency. Version 0.6.0 uses a Maven repository ZIP from the [GitHub Release](https://github.com/Ischca/kue/releases/tag/v0.6.0); these coordinates are not on Maven Central. [日本語の導入手順](./README.ja.md)

SDK editors, confirmation panels and alerts use their own light theme and keep the host application's theme unchanged. They can be installed in a dark-themed Views/Compose application without inheriting light text on the SDK's paper background.

Requirements: Android 8/API 26+, foreground Activity, Kotlin/JVM 17. The café uses compile/target SDK 36, AGP 8.13.2, Kotlin 2.1.20 and Gradle 8.13. Native Views provide the editor; integrating apps may use Compose or Views. API 26 is the native SDK's explicit floor because Activity-window PixelCopy requires it; no API 24 fallback is claimed.

## Install

Run these commands from the application's root directory. Download the Maven ZIP and checksum, verify the bytes, and extract the repository:

```sh
curl --fail --location --output kue-android-maven-0.6.0.zip \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip
curl --fail --location --output kue-android-maven-0.6.0.zip.sha256 \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip.sha256
shasum -a 256 -c kue-android-maven-0.6.0.zip.sha256
unzip kue-android-maven-0.6.0.zip -d vendor/kue
```

The ZIP contains compiled AARs, dependency metadata, source JARs and the MIT license. Keep the complete `vendor/kue/android-maven` directory; individual AAR files do not carry transitive dependency metadata. No SDK source checkout or publisher credentials are required. Add this repository to `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        maven {
            url = uri("vendor/kue/android-maven")
            content { includeGroup("dev.kue.qa") }
        }
        google()
        mavenCentral()
    }
}
```

Add to the application module:

```kotlin
dependencies {
    implementation("dev.kue.qa:kue-android:0.6.0")
    // Add only when screen recording must be included in the binary.
    implementation("dev.kue.qa:kue-android-recorder:0.6.0")
}
```

Sync Gradle and rebuild the application. The POM resolves OkHttp and Kotlin dependencies from the standard repositories. The optional recorder resolves the matching core artifact transitively and carries its own manifest and consumer R8 rules. The core declares Internet and Android 14 screen-capture detection permissions; it does not request photo-library or microphone access. Removing the recorder dependency and rebuilding excludes its projection service, permissions and provider. [Independent Views/Compose consumers](../../examples/android/integration/README.md) exercise this installation route.

KUE is disabled by default in non-debuggable applications. Set `enabled = true` explicitly when it should be available in a Release build. Including the recorder does not automatically start recording or grant Cloud entitlement.

For source development, the alternative below includes the workspace modules. Use one installation method per application.

Include `packages/android` as the `:kue` Gradle library and add `implementation(project(":kue"))`. Include `packages/android-recorder` as `:kue-recorder` only when recording is required. The recorder depends on the base SDK and adds its own non-exported consent Activity, foreground service and media-projection permissions. Excluding that artifact removes those classes, service declarations and permissions. Runtime `recording = OFF` disables recording in an included binary and does not remove native pieces.

```sh
cd examples/android
./gradlew :kue:testDebugUnitTest :app:assembleDebug :app:assembleRelease
# Core-only binary; a rebuild is required.
./gradlew -PkueRecorder=off :app:assembleDebug :app:assembleRelease
```

Use JDK 17+ and Android SDK platform 36 through `JAVA_HOME` and `ANDROID_HOME`. Set `GRADLE_USER_HOME` to a local build-cache directory when isolating development caches.

Maintainers can generate the local repository with the following explicit file destination. No remote repository or implicit `~/.m2` target is configured:

```sh
cd examples/android
./gradlew -PkueLocalRepository=/absolute/path/android-maven \
  :kue:publishReleasePublicationToKueLocalRepository \
  :kue-recorder:publishReleasePublicationToKueLocalRepository
cp ../../packages/android/LICENSE /absolute/path/android-maven/LICENSE
node ../../scripts/pack-android-maven.mjs \
  --repository /absolute/path/android-maven \
  --destination /absolute/path/kue-android-maven-0.6.0.zip --version 0.6.0
```

The path must be absolute and local. A repository ZIP must retain the generated AARs, POMs, Gradle metadata and source JARs together, plus the MIT license. Local artifact generation is separate from GitHub Release publication and verification.

To upgrade, extract the matching release repository and update both dependency versions together. To remove KUE, detach the controller and remove its dependencies before rebuilding. Remove the vendored repository only after no application dependency refers to it. Do not install a duplicate source-module and AAR copy of the core.

## Attach and capture

Install one controller per Activity on the main thread, after `setContent` or `setContentView`. The SDK detaches on Activity destruction. Local handlers take priority over Cloud for their respective destinations; Cloud may still provide recording entitlement checks.

```kotlin
val controller = Kue.install(activity, KueConfig(
    locale = KueLocale.JA,
    submitLabel = "Save",
    onSubmit = { report, complete ->
        // Persist report.screenshotBytes and fields using application-owned storage.
        complete(Result.success(Unit))
    },
    onSubmitGroup = { group, complete ->
        // One explicit group submission, never one callback per finding.
        complete(Result.success(Unit))
    },
))
controller.reportIssue(memo = "Check this flow")
```

Choose Cloud or a local `onSubmit`; custom handlers require `submitLabel`. `onSubmitGroup` may coexist with either single-report destination and wins for confirmed groups. Local handlers run on the main thread and must complete once; move blocking persistence to an application worker before completing. Exceptions shown by the SDK are sanitized and observer exceptions cannot turn an accepted upload into a retry.

`reportIssue(memo, context)` captures before opening the crop/memo editor and returns `false` when disabled, unavailable, already open or busy. PixelCopy captures the attached Activity window and excludes the KUE controls after two UI frames. Separate dialog windows and other applications are outside screenshot scope; `FLAG_SECURE` windows are rejected. `capture` optionally supplies an app adapter after the same two-frame wait and transfers ownership of its returned Bitmap to KUE; it cannot bypass the secure-window guard. Pending capture is cancelled when the Activity stops, and stale adapter completions cannot open an editor.

Default enablement follows the host's `FLAG_DEBUGGABLE`. Explicit `enabled = true` is required elsewhere. Locale defaults to the first Japanese/English entry in the device preferences, with English fallback. `setLocale` changes the trigger and the next editor. `setSubmitLabel` changes application-owned action text; `setContext` updates defaults for future captures without changing saved findings. `setButtonDesign`, `setFloatingButtonVisible`, `setShakeTriggerEnabled` and `setSystemScreenshotTriggerEnabled` control the corresponding UI/source. `uninstall` cancels network/recording work, removes controls, unsubscribes triggers and discards session findings.

The 54 dp floating button supports classic and transparent mascot designs and shows a saved-finding count badge. A recording uses a white button with a red square and border; while stopping, it is disabled. Dragging past 6 dp moves the button; dropping within 8 dp of an edge leaves an 18 dp handle. The first tap on that handle reveals it without capturing. A second pointer or cancelled gesture cannot capture or select a menu action. Movement and menu changes use no animation, including when reduced motion is enabled.

The 500 ms hold menu contains only saved findings (when nonempty), recording (Cloud plus a group destination and `AUTO`), and pending reports (Cloud-only single submission plus `offlineQueue`). An empty local setup has no hold menu: releasing a stationary hold captures as a normal tap. With actions available, slide to an icon or its label and release to select; release at the button or outside the targets cancels. Labels use a column or fan within the current safe bounds; an arrangement that cannot fit uses a list. Touch exploration and the accessibility “Show actions menu” action also use that list. Accessibility movement uses 32 dp steps and can hide at the nearest edge; hiding is unavailable while recording. Crop corners expose separate adjustable accessibility nodes with expand/shrink actions. Spoken TalkBack behavior across OS versions requires separate device verification.

## Findings and confirmation

The screenshot editor starts with the full image selected and offers normalized movable/resizable selection, a 12% minimum width/height, full-screen selection and a required memo. Its primary action submits a single screenshot when no editable saved findings exist. With saved findings it adds the current screenshot and opens title confirmation for the complete group. “Add finding” saves locally without sending. Saved findings can be reviewed, removed or explicitly discarded. A locked/full draft remains available for review; a new standalone screenshot can still be sent separately.

After a single-report failure, “Retry same report” preserves its prepared ID, media, memo and metadata. “Edit report” returns the same source image to editable crop/memo controls and clears the preparation/retry deadline; the next submission receives a new ID. An earlier request may already have been accepted. Any independent blocked outbox entry is retained until its own explicit discard, successful retry or expiry. Prepared groups remain locked.

`openSavedFindings` shows ordered image/video previews and a required title. The group freezes on its first submission attempt. Retry reuses its identifier, title, memos, metadata and media; there is no per-finding fallback. Locked findings cannot be edited or removed; explicit discard releases the session. Groups remain session-local and do not survive controller destruction/process restart.

During a group submission, confirmation, title, removal, back and discard controls are disabled. After a failed attempt, back/discard become available while the prepared title/findings remain locked; retry is enabled only for retryable failures.

Limits: 1–10 findings; JPEG/PNG images up to 10 MiB each; MP4 videos up to 20 MiB; all group media up to 20 MiB; group manifest up to 48 KiB. A title contains 1–200 Unicode code points after trimming and cannot contain CR, LF or NUL. Every finding needs a memo of 1–4096 UTF-8 bytes without NUL. Screenshot capture rejects sources above 16 million pixels; prepared JPEG output uses quality 90 and maximum dimension 2048 pixels. Crop metadata aligns with the selected integer pixel rectangle. Automatic context contains platform, OS/model, app version/build and logical screen dimensions in dp. Precedence is automatic values, installation `context`, per-call `context`; Android platform remains fixed. No user-assigned device name, persistent device ID, account or location is collected.

Public `KueReport`, `KueVideoFinding` and `KueReportGroup` constructors support application-owned capture data and low-level group submission. They validate IDs, memos, timestamps, dimensions, duration, per-finding metadata up to 16 KiB and media byte limits, and defensively copy media. `KueVideoFinding` declares silent H.264/MP4 media; the Cloud parser validates the actual container/track data on admission. A structurally valid model alone does not prove the supplied media is admissible.

Automatic logical screen dimensions use the display bounds and density independently of a custom capture adapter's image size; `sourceSize` and `outputSize` always describe capture pixels.

`captureImage` is an alternative to `capture`: return `KueCapturedImage(bitmap, capturedAt, context)` inside `Result`, with an owned Bitmap, ISO-8601 timestamp and optional capture-derived context. Context precedence is automatic device values < capture-derived values < installed defaults < per-report overrides; logical screen dimensions remain independent of bitmap pixels. Only one capture adapter may be configured, both transfer bitmap ownership to KUE, and neither bypasses a protected Activity window. Adapters must complete; integrations should cancel or time out their own external work.

`onReportOutcome(outcome, error)` observes the end of one accepted screenshot flow: `SUBMITTED`, `QUEUED`, `FINDING_ADDED`, `CANCELLED`, or `FAILED` with a capture error. A recoverable submit failure retains the editor and does not end that flow. Group confirmations and unrelated outbox receipts do not complete a screenshot flow. `onStateChanged` and `controller.state` provide lightweight enabled/foreground/editor/capture/recording/busy flags, saved-finding count, group lock/full and recording availability; they contain no media or receipt capability. Observer exceptions do not change submission state.

`groupSubmitLabel` names a local group callback independently of a single callback; it defaults to `submitLabel`. A local single handler requires `submitLabel`, and a local group handler requires either label. `setGroupSubmitLabel` changes this display text without changing a prepared group's content or destination.

`setRecordingMode(OFF)` cancels consent/start or active recording, releases an unfinished recording review, hides recording actions and ignores late recorder callbacks. It does not submit media or delete already-added group findings. Returning to `AUTO` rechecks project features before another recording; it cannot enable a provider excluded from the binary.

## Cloud

```kotlin
val controller = Kue.install(activity, KueConfig(
    cloud = KueCloudConfig("https://YOUR-KUE-HOST", "pk_REPLACE_WITH_PROJECT_KEY"),
    offlineQueue = true,
    onReceipt = { receipt -> /* Show receipt.status; never log receipt.receiptToken. */ },
    onQueued = { clientReportId -> /* Persisted locally, not accepted by Cloud. */ },
))
```

The base URL must be an HTTPS origin without credentials, path, query or fragment. Keys match `pk_` followed by 8–128 URL-safe characters. Timeout defaults to 15,000 ms and accepts 1–120,000 ms. Development HTTP additionally requires a debuggable host and explicit `allowDevelopmentLocalhostHttp = true`, limited to localhost, loopback and emulator host alias `10.0.2.2`. The application's network-security policy must separately permit that development host; the SDK does not weaken its policy.

- Single screenshot: `POST /v1/reports` with screenshot, memo and schema-version-1 metadata.
- Confirmed group: `POST /v1/report-groups` with schema-version-1 manifest and ordered `capture_0…` media. Video metadata uses schema version 2, MP4/H.264 duration and output dimensions, without screenshot crop/source-size fields.
- Entitlements: `GET /v1/project/features` with project key; availability and entitlement are separate booleans.
- Status: `GET /v1/reports/{id}` with the receipt capability, never the ingest key. States are received, queued, creating_issue, completed and failed; an optional validated GitHub issue or error code is returned.

HTTP 202/received-or-queued confirms admission, not GitHub Issue creation. The isolated OkHttp client rejects redirects, excludes host cookies/authenticators and automatic connection retries, limits response bodies to 64 KiB and applies a total call deadline. Status polling is explicit through `readReportStatus` and does not run automatically. `KueCloudClient` exposes blocking low-level methods for application workers; controller feature/status methods are asynchronous and lifecycle-cancelled.

## Recording

Include the recorder artifact, keep runtime mode AUTO, configure Cloud, and supply a valid group destination. `recordScreen` opens saved-finding review for a full or locked draft; otherwise it verifies current features before requesting fresh Android MediaProjection consent. Free/upgrade, Cloud-unavailable, verification-error and missing-artifact/rebuild states are distinct; a failed entitlement check never starts recording. Cloud still rechecks admission. Recording does not submit a report by itself.

The optional recorder uses a user-consented foreground media-projection service and a silent H.264/MP4 surface encoder, with no microphone permission or audio track. It captures the default display, including system bars; Android 14+ requests whole-display consent to keep the existing host Activity instead of relaunching it through an app picker. The host needs no special launch mode or result hook. Capture ends before 60 seconds or 20 MiB; the service uses conservative 59.5-second/18-MiB stop limits and verifies the finished container dimensions/duration. The floating trigger becomes a red square stop control; system Stop and foreground interruption also stop capture. Review offers playback, required memo, save-to-findings or discard. Videos only submit through explicitly confirmed groups and never fall back to screenshot or single-report endpoints. Each session requests a new consent token and creates one virtual display.

Recording failures reach `onError` once when supplied; otherwise, a localized recording-specific dialog appears while foreground. A failed stop leaves the active stop control available for another attempt. Provider cancellation exceptions do not prevent runtime off or controller removal from clearing SDK UI/lifecycle state, and late completions cannot reopen it. A custom provider remains responsible for releasing its external recording resources.

## Durable screenshot outbox

`offlineQueue` is opt-in and applies only to single Cloud screenshot submissions without a local `onSubmit`. Images, immutable metadata and report IDs are persisted before upload in app-private non-backup storage. The store holds at most 10 reports/50 MiB for seven days and rejects overflow without evicting existing reports. Groups/videos are not in this outbox.

Retryable failures remain pending and call `onQueued`; non-retryable failures become blocked. Backoff starts at 30 seconds, doubles to at most one hour and honors a larger Retry-After. Automatic flush occurs only while foreground/idle, on resume and at 60-second intervals. Explicit `retryPendingReports(force = true)` bypasses blocked/backoff waiting for the current destination. Uploads cancel when the Activity stops; there is no background worker, job, service upload or connectivity-permission prompt.

Destination binding is a hash of normalized endpoint and project key; those secrets are not stored. Changed destinations cannot retarget old reports. `pendingReports(true)` lists other-destination entries for discard; `discardPendingReport` cannot discard an in-flight report. Each upload atomically rechecks and claims the current stored entry, preventing stale list entries or concurrent controllers from submitting discarded content. Committed snapshots survive interrupted retry-state writes; incomplete initial saves are cleaned, corrupt committed data is retained and rejected. File operations reject links and cleanup never traverses child links. A successful admission is reported even if subsequent local cleanup fails; any later replay retains the same idempotency key.

`KueOutboxClient(context, cloud)` provides blocking `pendingReports`, `discardPendingReport` and `retryPendingReports` without an installed controller, using the same non-backup store. Run these methods on an application worker. Retry requires an `active` foreground guard and creates no scheduler. Its optional `KueCancellation` cancels the actual HTTP request, including requests started after cancellation; pass the same token through one logical operation. `KueCloudClient` methods also accept that token. Receipt/error observers are isolated, and accepted admission takes precedence over cleanup or observer failures.

Caller-created `KueReport` and `KueVideoFinding` contexts accept optional OS version, model, application/build version, logical screen dimensions and route. `KueContext()` defaults only `platform` to `android`; a caller may explicitly set `ios` for imported reports. Supplied fields are validated and preserved, and absent fields are omitted from metadata without automatic filling. Native host capture still collects its Android context and applies capture/install/per-call overrides; those overrides cannot change the platform.

## Triggers and control

Normal tap captures. When actions are available, holding for 500 ms opens an adjacent labelled menu; releasing over an item selects it, and releasing outside cancels. TalkBack/tiny windows use an accessible action list. Drags and multi-touch cancellation do not capture. Movement, peeks and menus stay inside system-bar/cutout safe bounds and reflow when those bounds change. Near an edge, the button docks with an 18-dp peek; first tap reveals it. Accessible move/dock/reveal/hide actions are available. Recording keeps its stop control visible and revealed.

Optional `shakeTrigger`/`KueShakeTrigger` uses two strong accelerometer movements with debounce. Optional `systemScreenshotTrigger`/`KueSystemScreenshotTrigger` uses Android 14's event-only screen-capture callback and normal `DETECT_SCREEN_CAPTURE` permission; it does not read a saved screenshot or request photo-library access. Earlier Android versions cannot subscribe to this source; enabled unsupported subscriptions report a sanitized setup failure. Custom `KueTriggerSource` subscriptions return cleanup and run only while the mounted controller is enabled, foreground and idle. They are removed on stop, busy UI and uninstall.

`asyncTriggers` accepts `KueAsyncTriggerSource` for asynchronous setup. `subscribe(open, complete)` may finish on any thread and completes with `Result.success(cleanup)` or failure. KUE serializes lifecycle handling on the main thread, releases cleanup returned after stop/uninstall, and suppresses stale opens and stale setup failures. Current setup failures reach `onError` as sanitized `trigger_setup_failed` errors. Cleanup failures are ignored without disrupting other subscriptions or notifying a newer/detached session. The same cleanup is not released twice if a source repeats its completion. Sources should complete once and stop their own external work in cleanup.
