# KUE Documentation

KUE adds screen capture, cropping, and memo entry to Expo, native iOS/Android, Flutter, and React Native apps without Expo. Reports can be submitted to KUE Cloud for GitHub Issue creation or passed to an application-defined storage handler.

Target version: SDK and CLI **0.6.0** (release preparation). Installation commands for this version are unavailable until the packages, tag, and Release assets are published. Expo SDK and CLI 0.6.0 have been verified on npm. Cloud limits describe the current production service. Recording also requires a native build that includes the recorder and an active entitlement.

## Requirements

| Component | Supported environment |
| --- | --- |
| Expo SDK | Expo SDK 54–57 / iOS and Android. `@kue-qa/react-native` |
| Native iOS | UIKit/SwiftUI, iOS 15+, Swift 5.9+ |
| Native Android | Views/Compose, Android 8/API 26+, Kotlin/JVM 17 |
| Flutter | Flutter 3.32+ / Dart 3.8+, iOS 15+ / Android API 26+ |
| React Native without Expo | RN 0.86.2, React 19.2.3, New Architecture, iOS 15.1+ / Android API 26+ |
| OS | iOS and Android. Web screen capture is not supported |
| CLI | Node.js 22.13 or later. Automatic setup is for Expo apps only |
| License | SDK and CLI: MIT. Cloud: a separately provided hosted service |

When building an Expo SDK 57 app with Xcode 27 (the iOS 27 SDK), use `expo@57.0.23` or later, set `ios.enableSceneSupport` to `true` in `expo-build-properties`, and regenerate the iOS project. An app built with the iOS 27 SDK without scene support cannot launch on iOS 27.

Cloud integration requires a GitHub account and installation of the KUE QA GitHub App on the destination repository. The connecting user must own the personal repository or be an organization owner, and must also have administrator permission on the repository. Contact [support](mailto:kue@ischca.dev) if the App cannot be installed.

Custom storage through `onSubmit` does not require a Cloud account.

## Expo CLI setup

CLI discovery, dependency installation, JSX editing, and recorder inclusion management are for Expo only. Install native, Flutter, and React Native without Expo using their SDK-specific procedures.

### Procedure

Save application changes, then run the command from the Expo app package or the workspace root.

```sh
npx kue-qa@0.6.0 init
```

If the current package declares an `expo` dependency, the CLI uses it directly. Otherwise, it detects Expo apps from `packages` in `pnpm-workspace.yaml` or `workspaces` in `package.json`. When both exist, the pnpm definition takes precedence. One candidate is selected automatically. Multiple candidates are listed and setup stops without changes. To select an app explicitly:

```sh
npx kue-qa@0.6.0 init --app apps/mobile
```

Automatic discovery stays within the invocation directory. It skips hidden directories, symbolic links, `node_modules`, `vendor`, `build`, `dist`, `coverage`, `ios`, and `android`. If the search exceeds 2,000 directories or no workspace definition exists, use `--app` or run inside the app. `--app` must select a directory inside the invocation directory without symbolic links.

1. The CLI detects the root component and GitHub repository.
2. On first setup or explicit reconnection, sign in with GitHub in the browser, verify the destination, and press **Connect**. Authorize access to the target repository on GitHub only if required.
3. The CLI installs the SDK and dependencies, then adds KUE to the root component.
4. Review the diff and start Expo. Rebuild the development client if native dependencies were added.
5. Submit a report and verify its delivery status and Issue in the [dashboard](https://kue.ischca.dev/en/app).

Setup approval links expire after 15 minutes. Approve only setups initiated from your own terminal. Running `init` does not create an Issue.

After connection completes, the URL changes to the regular dashboard (`/en/app`). Opening an expired connection link also displays the dashboard after sign-in. Projects already set up do not need to reconnect. Run `init` again only if CLI setup is incomplete.

The destination repository's GitHub owner determines the workspace. The first connecting user becomes its KUE workspace owner. When a workspace already exists, another GitHub organization owner does not automatically receive KUE management access.

The connection page displays the CLI's fixed destination. Press **Connect** to connect immediately if access is already granted. Otherwise, the same tab opens GitHub. Choose the personal account or organization, then use **Only select repositories** to grant access only to the target repository. On return to KUE, access to the original destination is checked again and the connection completes. No second press of **Connect** is required.

After saving access on GitHub, use your browser's **Back** button to return to the original connection page if you are not redirected to KUE. The connection also resumes when you return this way.

The initial action is bound to the browser, signed-in account, and destination, and resumes once within its validity period. Canceling on GitHub, granting a different repository, or awaiting organization approval does not complete the connection. After approval, press **Reload**, then **Connect**. If an incomplete setup has expired, restart the CLI's `init` command. GitHub authorization cannot be skipped.

### Idempotent init

Ordinary `init` exits without browser approval, package-manager execution, or file writes when the managed connection, integration, and installed dependencies are unchanged. File modification times and the lockfile are preserved. With `recording: auto`, it still reads the current Cloud plan; `off` skips that read. Local-state and plan checks do not guarantee that submission is available.

| State or option | Behavior |
| --- | --- |
| SDK upgrade | Update to the CLI's SDK version. Preserve the connection and compatible existing native dependencies. An older CLI does not downgrade a newer SDK |
| Missing dependency | Add only undeclared SDK or required native dependencies. Native version ranges come from the installed Expo package |
| Inconsistent dependencies | Stop if a declared package is not installed or versions are inconsistent. Restore dependencies from the lockfile or review an explicit dependency update first |
| `--reconnect` | Explicitly request browser approval and retrieve configuration again. Combine with `--repository OWNER/REPO` to change destinations or `--server URL` to change servers |
| `--config project.json` | Apply the explicitly supplied configuration without rewriting identical values. Cannot be combined with `--reconnect`, `--repository`, or `--server` |
| `--skip-install` | Skip dependency checks and additions. This does not indicate that dependencies are correctly installed |
| `--sdk sdk.tgz` | Compare the local tarball's content hash and installation state. Identical inputs do not reinstall it. Continue supplying this option when using the local tarball |
| Inconsistent managed files | Never execute JavaScript configuration or silently reset invalid configuration, integration, or customized type declarations; stop instead |

After browser approval, `.kue/setup.json` stores the destination and configuration hash. For a local tarball it stores the content hash and SDK version. It contains no authentication tokens or absolute paths and may be committed. If the destination is not recorded, as with older configurations, supplying `--repository` requires explicit `--reconnect`. Ordinary reruns never change the destination based on changes to the Git remote.

When an installation is necessary, the package manager may update related lockfile entries. Review the diff. Explicit `--reconnect` requests approval on every run.

### Options

| Option | Behavior |
| --- | --- |
| `--dry-run` | Display detection results without network requests or file changes |
| `--app apps/mobile` | Select the Expo package. Relative paths use the command's invocation directory |
| `--repository OWNER/REPO` | Specify the destination GitHub repository |
| `--reconnect` | Explicitly retrieve connection configuration again; also required to change an existing destination or server |
| `--root app/_layout.tsx` | Specify the root file to modify |
| `--no-open` | Print the approval link without opening a browser |
| `--config project.json` | Use public configuration JSON from the dashboard instead of browser approval |
| `--skip-install` | Skip dependency installation; install required packages separately |
| `--skip-integration` | Keep a manually mounted component without reading or editing JSX. Cannot be combined with `--root` |
| `--recording auto\|off` | Include the recorder according to the plan or explicitly exclude it. Default: `auto` |
| `--server https://YOUR-KUE-HOST` | Override the Cloud server. Default: `https://kue.ischca.dev` |
| `--sdk /path/to/sdk.tgz` | Use a local SDK tarball for testing |

Relative `--root` paths use the selected app directory. Relative `--config` and `--sdk` paths use the command's invocation directory. Dependencies and `.kue` are added inside the selected app. Package-manager detection checks `packageManager` and lockfiles from the app up through its parent directories.

With `--config`, the server URL comes from the JSON file. If the root component structure is unsupported by the CLI, integrate the SDK manually.

### Generated files

| File | Contents and handling |
| --- | --- |
| `.kue/config.js` / `.kue/config.d.ts` | Connection configuration and types, including the public project key. May be committed |
| `.kue/backup-*.txt` | Original application source. Keep local and exclude from commits |

The CLI does not store GitHub user tokens or billing credentials in the application.

### Setup for manually mounted components

In CLI 0.6.0, use `--skip-integration` for applications that already mount `Kue` through a custom wrapper. It manages connection configuration, dependencies and recording build settings without reading or editing JSX. It cannot be combined with `--root`.

```sh
kue-qa init --skip-integration
kue-qa init --skip-integration --reconnect
```

Once, pass `kueCloudConfig` from `.kue/config.js` and `kueRecordingMode` from `.kue/recording.js` to the existing `Kue` component. The CLI does not verify the manual integration. Subsequent runs reuse the connection and leave files unchanged when configuration and dependencies match. Auto mode still performs a read-only plan request. Use `--reconnect` to retrieve the key again or change the destination.

After a newer CLI updates the SDK, review the diff and use the application's existing build and distribution workflow. Changes to native recording inclusion require a native rebuild. The CLI does not start builds or distribute to TestFlight or Google Play.

## Manual Expo SDK installation

### Dependencies

Install SDK 0.6.0 with the application's existing package manager and maintain one lockfile format.

```sh
npm install @kue-qa/react-native@0.6.0
npx expo install expo-application expo-constants expo-device expo-file-system expo-image-manipulator react-native-view-shot react-native-safe-area-context
```

### Cloud connection and mounting

Add the public configuration obtained from the dashboard to `.env.local`. Replace the example key with the project key of the target project. Do not use GitHub tokens or private keys.

```dotenv
EXPO_PUBLIC_KUE_API_BASE_URL=https://kue.ischca.dev
EXPO_PUBLIC_KUE_PROJECT_KEY=pk_REPLACE_WITH_PROJECT_KEY
```

Mount one `Kue` component at the application root. The following example uses Expo Router's `app/_layout.tsx`.

```tsx
import { Stack } from 'expo-router';
import { Kue } from '@kue-qa/react-native';

export default function RootLayout() {
  return (
    <>
      <Stack />
      <Kue cloud={{
        apiBaseUrl: process.env.EXPO_PUBLIC_KUE_API_BASE_URL!,
        projectKey: process.env.EXPO_PUBLIC_KUE_PROJECT_KEY!,
      }} />
    </>
  );
}
```

Replace `Stack` with `Slot` when required by the router configuration. Without Expo Router, mount KUE in the application's root component. Environment variables are read by application code; the SDK does not read them automatically.

### Custom storage

`onSubmit` receives a `KueLocalReport` and returns `void` or `Promise<void>`. In the example, `saveReportAndCopyImage` is a storage function implemented by the application. `submitLabel` names the action on the submit button.

```tsx
<Kue
  onSubmit={async (report) => {
    await saveReportAndCopyImage(report);
  }}
  submitLabel="Save report"
/>
```

Configure either `cloud` or `onSubmit`; omitting both is a type error. When both are configured, `onSubmit` takes precedence. Cloud submission and the offline queue are bypassed. To choose a destination at runtime, select one `KueDestination` value and spread it into `Kue`.

With `onSubmit` or `onSubmitGroup`, `submitLabel` is required; omitting it is a type error. The finding screen, the long-press menu and the confirmation screen use this text, and the SDK appends the count (N). With `cloud` only, the button reads Create Issue and `submitLabel` is not accepted. With `cloud` and `onSubmitGroup`, a submission without saved findings goes to Cloud and reads Create Issue. If `submitLabel` is omitted without type checking, the button reads Send and a warning is logged once.

The image URI references a temporary file. Copy or upload the image before the callback's Promise resolves if it must remain available afterward.

| `KueLocalReport` field | Contents |
| --- | --- |
| `clientReportId` | Identifier retained when retrying the same prepared payload |
| `memo` | Entered memo |
| `crop` | Normalized crop coordinates: `x`, `y`, `width`, and `height` |
| `screenshot` | Cropped image URI, width, height, and MIME type |
| `sourceSize` | Original image width and height |
| `context` | Device and application metadata |
| `capturedAt` | Capture timestamp |

## Native iOS

Provides screenshot editing, saved-finding group confirmation, optional recording, Cloud submission, a durable single-image outbox, and additional triggers. Configure a local destination or Cloud.

### Install native iOS

Requires iOS 15+, Swift 5.9+, and a UIKit or SwiftUI app. Retain one `KueController` per application window. There are no third-party SDK dependencies. The default is enabled in Debug and disabled in Release. The following examples explicitly set `enabled: true` for use in both builds.

In Xcode, choose **File → Add Package Dependencies**, enter `https://github.com/Ischca/kue.git`, and select **Exact Version** `0.6.0`. Add `Kue` to the application target. For a Swift package consumer, use these dependencies:

```swift
dependencies: [
    .package(url: "https://github.com/Ischca/kue.git", exact: "0.6.0")
],
targets: [
    .target(name: "YourApp", dependencies: [.product(name: "Kue", package: "kue")])
]
```

For CocoaPods, download `kue-ios-0.6.0.zip` and its published SHA-256 from the GitHub Release, verify the archive, and unpack it into the app repository's `vendor` directory. Confirm that `vendor/kue-ios` contains `Package.swift`, `Sources`, and both podspecs. For a Podfile next to `vendor`:

```ruby
platform :ios, '15.0'

target 'YourApp' do
  pod 'Kue', :path => './vendor/kue-ios'
  # Optional native recording:
  # pod 'KueRecorder', :path => './vendor/kue-ios'
end
```

Run `pod install` and open the generated `.xcworkspace`. Retain the source directory at that path. This procedure does not use CocoaPods Trunk. Do not link duplicate native cores from both the Swift package and Flutter/RN packages containing the core. Git URL installation requires the `v0.6.0` tag, and archive installation requires the corresponding published Release asset.

### Integrate with SwiftUI

Retain the controller through a `@StateObject` owner and add `KueHost` to the screen. This minimal app displays the memo after explicit local saving. Local results stay in memory; the app implements persistence when needed.

```swift
import SwiftUI
import Kue

@MainActor final class FeedbackSession: ObservableObject {
    @Published var lastMemo = ""
    lazy var kue = KueController(
        destination: .local(submitLabel: "Save", onSubmit: { [weak self] report in
            self?.lastMemo = report.memo
        }),
        enabled: true
    )
}

@main struct FeedbackApp: App {
    var body: some Scene { WindowGroup { FeedbackScreen() } }
}

@MainActor struct FeedbackScreen: View {
    @StateObject private var session = FeedbackSession()
    var body: some View {
        VStack {
            Text(session.lastMemo)
            Button("Report") {
                try? session.kue.reportIssue(memo: "Check this screen")
            }
        }.background(KueHost(session.kue).frame(width: 0, height: 0))
    }
}
```

### Integrate with UIKit

Retain the controller in the screen or window owner and call `attach(to:)` after the view enters a window. Do not detach merely because an SDK editor is presented; detach when removing the integration or its window.

```swift
import UIKit
import Kue

@MainActor final class FeedbackViewController: UIViewController {
    private let result = UILabel()
    private lazy var kue = KueController(
        destination: .local(submitLabel: "Save", onSubmit: { [weak self] report in
            self?.result.text = report.memo
        }),
        enabled: true
    )
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

### Native iOS capture and recording

Tap the floating control or call `try kue.reportIssue(memo: "Check this screen")` to start screenshot editing. This call does not await submission completion. Review the crop and required memo before saving or submitting. `onCaptureFinished` reports capture completion; `onReportOutcome` reports submission, queueing, finding addition or cancellation from that editor. The app implements the destination for local callbacks; Cloud configuration uses an HTTPS origin and project key. Do not log keys, media, memos or receipt tokens.

A build linking only `Kue` includes no ReplayKit recording implementation. To record, also add the `KueRecorder` product or pod and supply its provider. The URL and key below are placeholders.

```swift
import Kue
import KueRecorder

let config = try KueCloudConfiguration(
    apiBaseURL: "https://kue.example.test",
    projectKey: "pk_example_project_key"
)
let kue = KueController(
    destination: .cloud(config),
    enabled: true,
    recorder: KueReplayKitRecorder()
)
```

Recording requires Cloud plan verification, a group destination, the native provider, device availability and system consent. After stopping, review the preview and required memo before adding the finding. Output is silent H.264 MP4, limited to 60 seconds and 20 MiB. Mixed image/video groups allow at most 10 findings and 20 MiB total and submit only after explicit confirmation. `recording = .off` disables recording at runtime; removing the module requires removing its product/pod and rebuilding.

`offlineQueue` defaults to disabled. The Cloud single-image queue is limited to 10 reports, 50 MiB and 7 days and retries only while foreground/idle. Groups and videos do not enter the durable queue. An HTTP 202 receipt means accepted, not completed Issue creation. Use `readReportStatus(_:)` to read status explicitly with the receipt token. `detach()` releases SDK operations/UI and session findings; discard durable queue entries separately when required.

### API reference

No photo-library or microphone permission is requested. Recording starts through OS consent. Additional shake/OS screenshot triggers are explicitly enabled and do not read saved photos. To remove the integration, call `detach()`, remove its product or pod, and rebuild. Submit or discard required pending reports before removal.

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/ios/README.md)

## Native Android

Provides screenshot editing, saved-finding group confirmation, optional recording, Cloud submission, a durable single-image outbox, and additional triggers. The corresponding local callback takes precedence over Cloud submission.

### Native Android installation

Requirements: Android 8/API 26 or later, a foreground Activity and Kotlin/JVM 17. The reference consumers use compile/target SDK 36, AGP 8.13.2 and Kotlin 2.1.20. Views and Compose use the same native controller. Android artifacts are distributed as a GitHub Release Maven ZIP; these coordinates are not on Maven Central.

Run from the application's root. Download the release and its SHA-256 file, verify the archive, and extract it:

```sh
curl --fail --location --output kue-android-maven-0.6.0.zip \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip
curl --fail --location --output kue-android-maven-0.6.0.zip.sha256 \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip.sha256
shasum -a 256 -c kue-android-maven-0.6.0.zip.sha256
unzip kue-android-maven-0.6.0.zip -d vendor/kue
```

Keep the complete `vendor/kue/android-maven` directory, including AARs, POMs, Gradle metadata, sources and MIT license. It does not require an SDK source checkout or publisher credentials. Add the local repository to `settings.gradle.kts`:

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

Add dependencies to the application module and sync Gradle:

```kotlin
dependencies {
    implementation("dev.kue.qa:kue-android:0.6.0")
    // Optional: omit this dependency to exclude native screen recording.
    implementation("dev.kue.qa:kue-android-recorder:0.6.0")
}
```

The POM resolves Kotlin and OkHttp from standard repositories. The recorder resolves the matching core transitively, includes its resources, non-exported consent Activity/media-projection service, foreground-service permissions and R8 rules. The core adds Internet and screen-capture detection permissions. Neither artifact requests photo-library or microphone access. Remove the recorder dependency and rebuild to exclude its native pieces; runtime recording OFF alone does not remove them.

### Attach to Views

Install on the main thread after `setContentView`. Replace the fake key with the project's ingest key. KUE owns its floating control and detaches when the Activity is destroyed:

```kotlin
import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import dev.ischca.kue.Kue
import dev.ischca.kue.KueCloudConfig
import dev.ischca.kue.KueConfig

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Example" })
        Kue.install(this, KueConfig(
            enabled = true,
            cloud = KueCloudConfig("https://kue.ischca.dev", "pk_REPLACE_WITH_PROJECT_KEY"),
        ))
    }
}
```

### Attach to Compose

Install once in the Activity after `setContent`, rather than on each recomposition:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import dev.ischca.kue.Kue
import dev.ischca.kue.KueCloudConfig
import dev.ischca.kue.KueConfig

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("Example") }
        Kue.install(this, KueConfig(
            enabled = true,
            cloud = KueCloudConfig("https://kue.ischca.dev", "pk_REPLACE_WITH_PROJECT_KEY"),
        ))
    }
}
```

When `enabled` is omitted, KUE defaults to enabled only in debuggable applications. The examples explicitly enable it, including Release. Recording still requires the optional recorder, AUTO mode, Cloud Indie entitlement, service availability, a group destination and fresh OS consent. Recording is silent H.264/MP4, up to 60 seconds/20 MiB; videos only send through explicitly confirmed groups. Including the dependency never starts a recording or sends a report automatically.

### Upgrade and remove

Extract the matching release repository and update core/recorder versions together. Do not install a duplicate source-module and AAR copy. To remove KUE, uninstall the controller, remove the dependencies and rebuild; remove the vendor directory only after it is no longer referenced. No Maven publisher credentials or additional host Activity result/launch-mode integration are required.

### API reference

For local storage, configure `KueConfig.onSubmit(report, complete)` and a separate `onSubmitGroup(group, complete)` with an action label. Complete application-owned saving before calling `complete(Result.success(Unit))` once. Groups never fall back to separate single callbacks. Additional shake/OS screenshot triggers are explicitly enabled and do not read the photo library. `controller.reportIssue(memo, context)` returns `true` when a capture can start and `false` when disabled, unavailable or busy; it does not await submission. Review the required memo, crop and destination before explicit submission. See the API reference for `openSavedFindings()`, `recordScreen()`, `openOutbox()` and state notifications.

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/android/README.md)

## Flutter

Combines Flutter capture with native editors, floating controls, finding-group confirmation, optional recording, additional triggers, Cloud delivery and a durable single-image outbox.

### Flutter requirements

Flutter 3.32+ / Dart 3.8+, iOS 15+ or Android API 26+ are required. The checked Flutter toolchain is 3.32.5 / Dart 3.8.1. Android requires compile SDK 36, JDK 17 and compatible Gradle/AGP/Kotlin versions; the reference versions are Gradle 8.13 / AGP 8.10.1 / Kotlin 2.1.20. iOS uses CocoaPods. The packages include their native runtime and use Flutter's plugin loader.

### Install Flutter core

```sh
flutter pub add kue_qa:0.6.0
```

The core plugin is required. Flutter uses pub dependencies and native builds; the Expo CLI setup command does not initialize a Flutter app.

### Configure Flutter native builds

For iOS, set the Podfile platform and Runner deployment target to 15.0 or later. Build with Flutter so it regenerates native plugin registration and Pods. If the embedding already manages UIScene, keep that setup. For the tested Flutter 3.32 embedding on an SDK requiring scenes, add the installed core package's `integration/ios/KueFlutterSceneDelegate.swift` to Runner. Configure one application scene in `UIApplicationSceneManifest` with delegate `$(PRODUCT_MODULE_NAME).KueFlutterSceneDelegate`. Keep AppDelegate as FlutterAppDelegate and remove its template `GeneratedPluginRegistrant.register(with: self)`; the scene registers the actual controller once. Do not create a second engine.

For that Flutter 3.32 setup, generate the plugin links and copy the provided scene file:

```sh
flutter build ios --debug --config-only --no-codesign
(cd ios && pod install)
cp ios/.symlinks/plugins/kue_qa/integration/ios/KueFlutterSceneDelegate.swift ios/Runner/
```

In Xcode, add the copied Swift file to the Runner target. Add this entry to Runner's Info.plist:

```xml
<key>UIApplicationSceneManifest</key>
<dict>
  <key>UIApplicationSupportsMultipleScenes</key>
  <false/>
  <key>UISceneConfigurations</key>
  <dict>
    <key>UIWindowSceneSessionRoleApplication</key>
    <array>
      <dict>
        <key>UISceneConfigurationName</key>
        <string>Default Configuration</string>
        <key>UISceneDelegateClassName</key>
        <string>$(PRODUCT_MODULE_NAME).KueFlutterSceneDelegate</string>
      </dict>
    </array>
  </dict>
</dict>
```

For Android, set app minSdk to 26 and compileSdk to 36. Select JDK 17 and the compatible Gradle/AGP/Kotlin versions above. Flutter's plugin loader links the core and optional recorder. Do not add duplicate native Kue pods/projects to either platform. Rebuild after changing native dependencies.

### Use KueHost

Place one host outside the root Navigator with `MaterialApp.builder`. Use a stable local callback and a nonempty submission label, or a Cloud configuration.

```dart
import 'package:flutter/material.dart';
import 'package:kue_qa/kue_qa.dart';

final kue = KueController();
final lastMemo = ValueNotifier<String>('No report saved');

Future<void> saveLocal(KueLocalReport report) async {
  lastMemo.value = report.memo;
}

void main() => runApp(MaterialApp(
  builder: (context, child) => KueHost(
    controller: kue,
    onSubmit: saveLocal,
    submitLabel: 'Save locally',
    child: child!,
  ),
  home: Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextButton(
            onPressed: () async {
              await kue.reportIssue(memo: 'Inspect this screen');
            },
            child: const Text('Report issue'),
          ),
          ValueListenableBuilder<String>(
            valueListenable: lastMemo,
            builder: (context, value, child) => Text(value),
          ),
        ],
      ),
    ),
  ),
));
```

This example keeps only the last memo in memory. It does not upload or create an Issue. The callback owns durable storage and idempotency using `clientReportId`; it receives immutable `imageBytes`, memo and metadata. A completed callback means local save completion. Failed saves remain in the native editor for explicit retry with the same ID and content. Groups require their own `onSubmitGroup` or Cloud destination; they do not invoke `onSubmit` once per finding.

For Cloud delivery, obtain the origin/key from the project's connection settings and replace the fake placeholders. A local `onSubmit` takes precedence when both are configured.

```dart
KueHost(
  controller: kue,
  cloud: const KueCloudConfig(
    apiBaseUrl: 'https://cloud.example.test',
    projectKey: 'pk_example_project',
  ),
  child: child!,
);
```

`enabled` defaults to `kDebugMode`: Profile and Release are disabled unless explicitly enabled. `reportIssue` returns `Future<KueReportOutcome>` after submission, queueing, finding addition or cancellation, with busy/disabled outcomes when appropriate; capture failures complete with a typed error. Default capture uses Flutter's RepaintBoundary as PNG, with a longest edge of 2048 pixels. Native dialogs, PlatformViews, external textures and protected content are not guaranteed; there is no native-window fallback. Use a custom PNG capture adapter when needed.

### Add optional Flutter recording

```sh
flutter pub add kue_qa_recorder:0.6.0
```

No Dart recorder import or initialization is required. Rebuild both native applications. Recording additionally needs a group destination, Cloud feature entitlement/admission and OS consent, even when a local group callback saves the result. It produces silent H.264 MP4, up to 60 seconds / 20 MiB. The user reviews a clip, adds a required memo and explicitly confirms its group. There is no automatic video upload or durable group/video outbox. `recording: off` disables recording at runtime but retains the compiled module and Android service permissions.

### Disable or remove Flutter KUE

Set `enabled: false` to cancel the host integration. To exclude recording from the binary, remove its dependency and rebuild:

```sh
flutter pub remove kue_qa_recorder
flutter pub get
# On macOS for iOS:
cd ios && pod install
```

Remove KueHost and the core dependency to remove KUE. Removing a host does not delete durable pending screenshots; discard owned entries explicitly before removing the SDK when deletion is required. The optional Cloud screenshot outbox defaults to false and is bound to its original destination. Queueing is local storage; HTTP 202 is acceptance, not completed Issue creation.

### API reference

[Flutter API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/flutter/README.md)

## React Native without Expo

Uses native floating controls, crop/memo editing, image/video group confirmation, additional triggers, Cloud submission and a durable single-image outbox. This installation is separate from the Expo package.

### React Native without Expo requirements

The supported baseline is React Native 0.86.2 / React 19.2.3 with New Architecture, iOS 15.1+ or Android API 26+, JDK 17 and compile SDK 36. Other React Native versions, the old architecture, web, macOS and Windows are not supported. The package includes its native core; no Expo dependency, separate Kue pod/Gradle project or private source checkout is required.

### Install the React Native core

```sh
npm install @kue-qa/react-native-bare@0.6.0
cd ios
bundle exec pod install
```

Run the pod commands on macOS for iOS, then rebuild with the application's usual Xcode/Gradle or React Native CLI command. Autolinking and Codegen register the modules. Do not use the Expo setup CLI for this package. Debug normally uses Metro; Release contains an embedded JavaScript bundle. An independently launchable Debug application needs an embedded bundle and the corresponding app delegate configuration.

### Mount Kue and capture

Mount one Kue near the application root. Replace the fake origin and key with the project's connection settings. This example explicitly enables the SDK in Release as well.

```tsx
import { Kue } from "@kue-qa/react-native-bare";

export function Feedback() {
  return (
    <Kue
      enabled={true}
      locale="en"
      cloud={{
        apiBaseUrl: "https://feedback.example.com",
        projectKey: "pk_REPLACE_WITH_PROJECT_KEY",
      }}
    />
  );
}
```

After the host is mounted, an application action can open the native screenshot editor:

```tsx
import { reportIssue } from "@kue-qa/react-native-bare";

await reportIssue({
  memo: "Check this flow",
  context: { route: "/products/yirgacheffe" },
});
```

Opening the editor does not submit a report. reportIssue returns `Promise<void>` after capture and presentation; later submission, queueing, cancellation and finding addition are reported by onOutcome. Capture/background cancellation rejects the promise. The default capture uses the native window; secure content and native video/surface views may be unavailable.

For local saving, supply a stable onSubmit callback and a nonempty submitLabel instead of a Cloud destination. onSubmit takes precedence if both are supplied. A group requires its own onSubmitGroup callback or Cloud destination; individual callbacks are not a fallback. Callback media URIs remain valid only while the returned promise is pending. Upload or await copyKueMediaFile before resolving; retained copies are application-owned. See the package API reference for copy removal, custom capture adapters and typed outcomes.

enabled defaults to __DEV__, recording to auto and the floating button to true. Shake, system screenshot triggers and offlineQueue default to false. Locale follows native preferred languages unless set to ja/en. Callback timeout defaults to 30000 ms. Cloud, handler identities, capture, custom triggers and queue settings are fixed while mounted; use stable callbacks and remount with a new React key to change them.

### Optional React Native recording

```sh
npm install @kue-qa/react-native-bare-recorder@0.6.0
cd ios
bundle exec pod install
```

Rebuild both native applications. No recorder import or JavaScript initialization is required. Recording requires a group destination, Cloud entitlement/admission and OS consent, including local saving. Output is silent H.264 MP4, at most 60 seconds / 20 MiB; the user previews it, enters a required memo and explicitly confirms the group. No microphone/camera permission or automatic video upload is used.

### Disable or remove React Native KUE

enabled={false} cancels the current session. To remove recording code and Android service permissions, remove the optional package, reinstall pods and rebuild:

```sh
npm uninstall @kue-qa/react-native-bare-recorder
cd ios
bundle exec pod install
```

recording="off" only disables recording at runtime. Remove Kue and the core dependency to remove the SDK. Persisted pending screenshots survive unmounting, so explicitly discard them before removal if required. The optional Cloud screenshot outbox is destination-bound; groups and videos are not queued. HTTP 202 means acceptance, not completed Issue creation.

### API reference

[React Native API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/react-native-bare/README.md)

## Expo capture and Issue creation

### Procedure

1. Tap the KUE button.

   ![App screen with the KUE button in the lower-right corner](images/kue-button.en.webp)

2. Drag the corners of the frame to select an area, then enter a memo.

   ![Finding screen with the crop frame, the memo field, and the Add finding and Create Issue buttons](images/finding-screen.en.webp)

3. Check that the report contains no secrets or personal information, then select Create Issue. To send it together with other findings, select Add finding instead; see Grouped findings.
4. For Cloud submissions, check delivery status and the created Issue in the dashboard.

### Floating button

The default is a viewfinder button. Set `buttonDesign="mascot"` to display the character. Both designs share the same gestures and touch target. The image is bundled with the SDK; no additional download or native dependency is required.

```tsx
<Kue cloud={cloud} buttonDesign="mascot" />
```

![The default viewfinder KUE button (left) and the character KUE button (right)](images/button-designs.webp)

| Action | Result |
| --- | --- |
| Tap | Start a capture |
| Drag | Move the button without capturing |
| Release at a screen edge | Dock the button as a small handle |
| Tap the handle | Restore the button |
| Hold for about 0.5 seconds and release over an item | Select an action from the menu; without menu items, a hold starts a capture like a tap |

Position is not retained across application restarts.

### Display language

KUE screens are available in Japanese and English. KUE uses Japanese when Japanese comes before English in the device's preferred languages, and English otherwise. iOS reads the device language settings, including per-app languages; Android uses the language applied to the app.

To fix the display language, set `locale` to `"ja"` or `"en"`.

```tsx
<Kue cloud={cloud} locale="en" />
```

The text given in `submitLabel` is shown as written in either language. Descriptions of errors from KUE Cloud submissions are in English in either language.

### Issue contents

Issues contain the cropped image, memo, and device/application metadata. The default label is `kue`. KUE creates the label when missing and leaves existing label settings unchanged. Custom label names are not supported.

### Grouped findings

Multiple images or videos can be submitted in one Issue. Production Cloud supports grouped submissions.

1. On the first finding, select Add finding. The finding is saved to the on-device draft without being sent. The KUE button displays the number of saved findings.
2. Continue using the application and tap KUE to record the next finding.
3. On the last finding, select Create Issue (N). N is the number of saved findings plus the current one. The confirmation screen opens after the finding screen closes.
4. Review the images and memos and remove unwanted findings. The title defaults to the first line of the first finding's memo. Edit the title if needed, then select Create Issue (N).

   ![Confirmation screen with the title field and two findings](images/confirmation-screen.en.webp)

Without saved findings, Create Issue sends only the current finding and does not open the confirmation screen. Add finding appears when `cloud` is set without `onSubmit`, or when `onSubmitGroup` is set.

To create an Issue from saved findings only, hold the KUE button for about 0.5 seconds and release over Create Issue (N) in the menu that opens. The confirmation screen opens without a new capture. This item appears only while findings are saved.

![Long-press menu with Create Issue (1) selected](images/long-press-menu.en.webp)

The long-press menu shows only actions that a tap cannot perform.

| Item | Shown when |
| --- | --- |
| Create Issue (N) | Findings are saved |
| Screen recording | `cloud` is set and `recording` is not `off`; with `onSubmit`, `onSubmitGroup` is also required. On Free, the item is locked and explains Indie access when selected |
| Pending reports | The offline queue is enabled |

The items appear next to the KUE button, each named beside its button. Names are placed where the screen edge and other items cannot cover them; when they do not fit, the menu opens as a list. Release over a button or its name to choose that action; release over the KUE button or away from the items to cancel. Moving before the menu opens drags the button. Rotation, backgrounding and multitouch cancel selection. TalkBack/VoiceOver users can choose from a list through the Show actions menu accessibility action. Without menu items, a hold starts a capture like a tap.

With 10 saved findings, or while the send result of the saved findings is unconfirmed, a KUE tap, a trigger and `reportIssue()` still start a capture. The current finding cannot join the draft, so the finding screen shows Saved findings instead of Add finding, with the reason. Create Issue sends only the current finding.

Saved findings opens the confirmation screen and keeps the current finding. Sending, resending or discarding the saved findings there, or selecting Back, returns to the finding screen. The crop and memo are kept. If the current finding can then join the draft, Add finding is shown.

While the draft cannot take a finding, selecting Screen recording from the long-press menu opens the confirmation screen without recording.

Free and Indie allow 1–10 findings, up to 10 MiB per image and 20 MiB in total. Usage counts findings, not Issues: a group of three consumes three captures. Acceptance is atomic; a quota or storage failure cannot accept only part of the group.

Drafts last for the application session; images are copied to SDK-owned temporary storage. Drafts are not restored after application termination, moved into the offline outbox, or sent automatically. Changing the project key or server never moves an existing draft to another destination. Draft copies left behind by an application termination or reload are deleted the next time the application starts with KUE enabled.

After the first submission attempt, content is frozen and retries reuse the same identifier and payload. An uncertain receipt does not trigger a new identifier. Discarding the local draft does not cancel an Issue already accepted by Cloud.

If the plan check fails before any plan is confirmed, Screen recording is not shown with the Free lock; selecting it asks the tester to check the connection and retry. Once a plan is confirmed, a failed re-check keeps showing that plan.

### Screen recording

A recording-capable native build, `cloud` and active Indie entitlement are required; with `onSubmit`, `onSubmitGroup` is also required. Production Cloud supports video admission.

1. Select Screen recording from the KUE long-press menu and review the OS recording consent prompt.
2. During recording, the KUE button becomes a red-square stop control at the same position. Tap it to stop. It remains draggable, but edge hiding and the long-press menu are disabled. Android also allows stopping from the recording notification.
3. After stopping, select Play video to review it, enter a memo, then select Add to draft and review. Nothing is uploaded yet. Select Discard recording and return to delete it instead.
4. Confirm the Issue title and findings, then send. You can also go back to add images or videos.

Recordings are silent H.264 MP4, limited to 60 seconds and 20 MiB. App audio and microphone input are not captured. Recording stops automatically with a margin before time or size limits. Backgrounding, screen lock and OS termination also stop recording. On iOS, a change to captured frame dimensions stops recording. Protected screens may not be recordable.

Each video counts as one finding. Images and videos can be mixed within the shared limit of 10 findings and 20 MiB. Videos use session-local temporary storage and do not enter the offline outbox. If the workspace returns to Free before submission, the entire group containing video is rejected; no partial submission occurs. Entitlement is checked at recording start and admission. Replaying identical accepted content does not consume additional quota.

The Issue contains a link to open the video. Anyone with its URL can view it; do not record confidential information. Videos use the same storage quota, retention and deletion rules as images. Video cropping and editing are not supported.

### Recording build configuration

CLI 0.6.0 manages native recorder inclusion.

Set `kue.recording` in the selected application's `package.json`. The default is `auto`. `init` checks the connected workspace entitlement and configures the native recorder for exclusion on Free or inclusion on Indie. `off` excludes it regardless of plan. Screenshot dependencies are not excluded.

```sh
kue-qa init
kue-qa init --recording off
kue-qa init --recording auto
kue-qa check
```

1. Run `init` for initial setup. In `auto` mode, it makes a read-only Cloud check whether or not browser approval is needed. Use `--recording off` to opt out. An explicit setting persists on subsequent runs.
2. After changing the plan or recording setting, run `init` again and review the diff. Repeating it with unchanged plan, settings and dependencies preserves file bytes and modification times. Network, authentication and response-validation failures are not interpreted as Free; existing settings are preserved and setup exits with an error.
3. Rebuild using the application's existing build workflow when native inclusion changes. The CLI does not start builds or distribution automatically. Expo Go cannot load a custom native recorder.
4. Use `check` with managed configuration to detect mismatches between the plan, configuration and native inclusion. Mismatches fail without repairing settings. `--config` and `--env` verify Cloud admission only, not the application's recording build configuration.

Ordinary native builds use the saved inclusion settings without Cloud plan lookups or configuration changes. Commit changes to `package.json`, `.kue/recording.js` and `.d.ts`, `.kue/setup.json`, and the app root. Do not edit generated files directly. `--dry-run` performs no requests or writes and therefore does not verify the current plan. `--skip-install` skips dependency installation only; `auto` still checks the plan and updates configuration.

Updating configuration does not change an installed application. When a recording-capable build is needed, the UI gives rebuild instructions without repeating the plan status. Free locks, connection failures, explicit opt-out and Cloud unavailability are distinct states. Build configuration does not grant entitlement; recording start and submission require separate Cloud checks.

### Pre-build admission check

Before distributing a build, check whether the selected app can currently submit using its managed configuration.

```sh
npx kue-qa@0.6.0 check
```

Use `--app` to select the app. Alternatively, `--config project.json` reads dashboard JSON, or `--env` reads the already-resolved build variables `EXPO_PUBLIC_KUE_MODE`, `EXPO_PUBLIC_KUE_API_BASE_URL`, `EXPO_PUBLIC_KUE_PROJECT_KEY`, and optional `EXPO_PUBLIC_KUE_ENABLED`. These three configuration sources are mutually exclusive. Never put a key in a command argument. `--env` does not load dotenv; resolve the values used by Expo/EAS before invoking it.

`check` sends an authenticated GET to verify the current key, project admission, quota/storage and delivery configuration. It exits with code 0 on acceptance. Rejection, network or timeout failures, unsupported servers and invalid responses exit nonzero. The timeout is 10 seconds. The command does not change configuration or quota and does not create reports or Issues. Explicit local mode or `EXPO_PUBLIC_KUE_ENABLED=false` skips network access. Missing configuration is an error, not a successful skip.

With managed configuration, it also compares recorder inclusion with the current plan. `--config` and `--env` check Cloud admission only. A pass does not guarantee GitHub permissions, queue/storage availability, physical capture, or protection against later key revocation or quota changes. Test actual submission from the distribution build.

### Group and recording APIs

| API | Input, result and limitations |
| --- | --- |
| `onSubmitGroup` | Custom handler receiving a `KueReportGroup`. It does not call `onSubmit` once per finding. Copy or upload required images/videos before resolving. Requires `submitLabel` |
| `submitKueReportGroup(group, cloud)` | Submits `clientReportId`, `title` and ordered `findings` together and returns one `KueReceipt`. Never falls back to individual uploads on an unsupported server |
| `getKueProjectFeatures(cloud)` | Returns group support and recording entitlement/availability. Authentication and network failures throw. A client-supplied plan is not accepted |
| `KueProps.recording` | `"auto" \| "off"`, default `auto`. `off` disables recording at runtime and hides Screen recording from the long-press menu. Native exclusion is managed by CLI build configuration; this prop alone does not remove code from the binary |

`KueReportGroup.findings` is an array of `KueFinding` (`KueLocalReport | KueVideoReport`). `KueVideoReport` contains `clientReportId`, `memo`, `context`, `capturedAt` and `video`. The `video` contains `uri`, `width`, `height`, `durationMs`, `byteSize`, `mimeType: "video/mp4"` and `capturedAt`. Media URIs must remain valid until submission finishes. When using a custom `onSubmit`, provide `onSubmitGroup` separately to enable grouped submissions. Each draft retains the handler supplied at creation; a rerender supplying another function does not retarget the existing draft.

## Expo SDK configuration reference

### KueProps

Configure either `cloud` or `onSubmit`. Other props are optional. `KueProps` is a type alias; extend it with an intersection such as `type Props = KueProps & { … }`.

| Prop | Default | Behavior |
| --- | --- | --- |
| `enabled` | `__DEV__` | Enable or disable the SDK. Disabled by default in release builds |
| `cloud` | Not set | Configure Cloud submission with `KueCloudConfig`. Required unless `onSubmit` is set |
| `onSubmit` | Not set | Custom storage callback. Takes precedence over `cloud`; requires `submitLabel` |
| `onSubmitGroup` | Not set | Custom handler for grouped findings; requires `submitLabel` |
| `submitLabel` | Not set | Action name on the submit buttons of a custom handler. Required with `onSubmit` or `onSubmitGroup`; not accepted with `cloud` only |
| `context` | `{}` | Add to or override automatically collected metadata |
| `floatingButton` | `true` | Show the button. Other triggers remain available when `false` |
| `buttonDesign` | `"classic"` | `"classic"` uses the viewfinder button; `"mascot"` uses the character |
| `locale` | Device language | Display language of the KUE screens: `"ja"` or `"en"`. When omitted, follows the device's preferred languages |
| `triggers` | Not set | Array of additional trigger sources |
| `offlineQueue` | `false` | Persist pending Cloud submissions on the device |
| `onQueued` | Not set | Notify with `clientReportId` after local persistence when Cloud has not accepted the report |
| `onReceipt` | Not set | Notify with `KueReceipt` after Cloud acceptance |
| `onError` | Not set | Handle capture and submission errors. An alert is shown when omitted |
| `capture` | Built-in capture | Replace capture with a `KueCaptureAdapter` for tests or custom implementations |

For internal QA release builds, set `enabled` using an explicit application-owned condition. Avoid enabling it unconditionally in builds distributed to all end users.

### KueCloudConfig

| Property | Required / default | Description |
| --- | --- | --- |
| `apiBaseUrl` | Required | Cloud origin without credentials, path, query or fragment. Do not append `/v1/reports` |
| `projectKey` | Required | Public project key: `pk_` followed by 8–128 letters, digits, `_` or `-`. Used for submission and project-feature checks, not management or report viewing |
| `timeoutMs` | Default `15000` | HTTP request timeout in milliseconds; a whole number from 1 to 120000 |

### Metadata

KUE collects the OS, device model, application version/build number, and screen dimensions. Expo Updates information is included when available. Device identifiers, personal device names, and screen routes are not collected automatically.

Set application-specific metadata through `context`. This example supplies a route template from Expo Router.

```tsx
import { useSegments } from 'expo-router';
import { Kue, type KueCloudConfig } from '@kue-qa/react-native';

export function QaReporter({ cloud }: { cloud: KueCloudConfig }) {
  const segments = useSegments();
  return <Kue cloud={cloud} context={{ route: `/${segments.join('/')}` }} />;
}
```

Do not mount a second `Kue` when using this component. Metadata precedence is automatic values, then `context`, then `reportIssue({ context })`. Use anonymized route templates rather than URL query strings or user IDs.

## Expo trigger API and sources

### reportIssue

`reportIssue(options?): Promise<void>` opens a mounted, enabled KUE reporter. `options.memo` sets the initial memo; `options.context` supplies metadata for that report.

```ts
import { reportIssue } from '@kue-qa/react-native';
await reportIssue({ memo: 'Describe the issue' });
```

The call rejects with `KueUnavailableError` when no enabled KUE instance is mounted. This API does not submit a report or return a receipt.

### Shake and screenshot

Additional triggers are optional. Install the modules used by the application and rebuild the development client.

```sh
npx expo install expo-sensors expo-screen-capture
```

```tsx
import { shakeTrigger } from '@kue-qa/react-native/shake';
import { screenshotTrigger } from '@kue-qa/react-native/screenshot';

const triggers = [shakeTrigger, screenshotTrigger];
<Kue cloud={cloud} triggers={triggers} />
```

`cloud` is an existing `KueCloudConfig`. Keep the array reference stable, for example by defining it outside the component. Set `floatingButton={false}` to hide only the button.

| Trigger | Dependency | Support and behavior |
| --- | --- | --- |
| `shakeTrigger` | `expo-sensors` | Open the reporter when a shake is detected |
| `screenshotTrigger` | `expo-screen-capture` | iOS and Android 14+. Detect an OS screenshot and recapture the current application view |

Sources are subscribed while KUE is enabled, foregrounded, and idle. They do not read the photo library or submit automatically.

### Android permissions

KUE does not request additional permissions or modify shared sensor sampling intervals. Optional Expo modules may add `ACTIVITY_RECOGNITION`, `READ_EXTERNAL_STORAGE`, or `READ_MEDIA_IMAGES`. Exclude them with `android.blockedPermissions` only when no other application feature needs them. Keep `DETECT_SCREEN_CAPTURE` for screenshot detection on Android 14+.

## Expo offline queue

### Configuration

`offlineQueue` is a persistent queue for Cloud submissions. It is disabled by default and does not apply to custom storage through `onSubmit`.

```tsx
<Kue cloud={cloud} offlineQueue />
```

Reports are written to the application's `Documents/kue-outbox-v1` before uploading. No additional native dependency, permission, or application-owned database setup is required.

### Limits and retries

| Item | Value or behavior |
| --- | --- |
| Report count | 10 across all destinations |
| Total storage | 50 MiB |
| Individual image | Up to 10 MiB |
| Retention | 7 days. Expired entries are removed on the next queue access |
| Automatic retries | Run while foregrounded. Execution while closed or backgrounded is not guaranteed |
| Network failure | Retry after a delay |
| Invalid key or quota limit | Stop automatic retries and wait for manual action |

Changing the destination or key does not redirect existing entries to the new destination. `onQueued` is called for locally persisted reports not yet accepted by Cloud; `onReceipt` is called after Cloud acceptance.

### Management API

Import the following functions from `@kue-qa/react-native`. `cloud` is the destination configuration; `id` is the entry's `clientReportId`.

| API | Result |
| --- | --- |
| `pendingKueReports(cloud)` | Read pending report identifiers, save times, and states |
| `retryPendingKueReports(cloud, { force: true })` | Retry manually. Returns `Promise<void>` |
| `discardPendingKueReport(cloud, id)` | Discard the specified local entry |

There is no SDK-specific encryption. Backups follow the host application's policy. Discarding local data does not recall reports already accepted by Cloud.

## Workspace management and delivery status

### Workspaces and permissions

A workspace corresponds to one GitHub personal account or organization and owns its subscription, projects, and usage. Repositories belonging to a different GitHub owner require a separate workspace. Renaming a repository does not change its workspace. Transferring it to a different GitHub owner does not automatically change its KUE workspace.

Management requires signing in with your own GitHub account, KUE workspace membership, and current GitHub owner permissions. A project key does not grant management access. There are no per-tester or per-device charges, but one subscription cannot cover separate owners or separate clients' work. Member invitations are not supported.

### Dashboard

On first use, the [dashboard](https://kue.ischca.dev/en/app) shows repository setup without an empty workspace selector. The repository list loads automatically. If none are available, press **Connect** to authorize access on GitHub. When opening the dashboard without the CLI, no destination is specified: select a repository after returning, then press **Connect**. Use **Configure GitHub access** to add a repository that is not listed. A workspace is created automatically when you connect.

After connection, select a workspace to inspect its connection settings, plan, monthly submissions, image storage, and 20 most recent reports. Only the KUE workspace owner can manage billing, delete the workspace, or transfer ownership.

| Operation | Effect |
| --- | --- |
| Retrieve public configuration | Display SDK configuration for a connected project |
| Rotate a project key | Revoke the old key. Update all consuming apps. Existing Issues remain |
| Retry delivery | Reprocess a failed report. Check for an existing Issue when creation is uncertain |
| Select the active Free project | Choose the one project allowed to submit. Pausing is distinct from deletion |
| Delete a project | Stop submissions and schedule images and reports for deletion. GitHub Issues are not deleted |

### Purchase and cancellation

1. Confirm the target workspace in the dashboard. Review the limits, retention, cancellation, and refund conditions on the [pricing page](https://kue.ischca.dev/en/pricing) and in the [Terms of Service](https://kue.ischca.dev/en/terms). Use the Indie purchase action to open Stripe Checkout. Check the final amount, payment currency, and automatic monthly renewal, then agree to the terms before purchasing.
2. Verify the Indie plan and subscription expiry in the dashboard. Refresh billing status if the update is delayed. Returning from Checkout does not itself confirm that the plan has been applied.
3. Use billing management to open the Stripe Customer Portal for payment methods, invoices, and cancellation. Cancel before the next renewal to return to Free at the end of the paid period.

Subscriptions renew monthly. The billing cycle and monthly submission quota reset are separate. Free limits apply if payment fails and an active subscription cannot be confirmed. After correcting the payment method, refresh billing status. Deleting a project or uninstalling the SDK does not cancel a subscription.

Payments use Stripe Managed Payments. Checkout may display and charge a local currency, and Link sends receipts and invoices. In addition to KUE billing management, Link provides order, subscription, and payment-method management. Link's refund terms presented at purchase may take precedence; rights under applicable law are not limited. A data-deletion request to Link may end the subscription. Request deletion of KUE images and reports separately in KUE.

### Ownership transfer

Self-service transfer is limited to Free organization workspaces for which no Stripe billing account has been created. Personal workspaces and workspaces with a billing account created by starting Checkout are ineligible. Contact support for other ownership changes.

1. The recipient signs in to KUE with their own GitHub account. They must have GitHub organization owner permissions when accepting.
2. The current KUE owner enters the recipient's GitHub username and the organization name in the dashboard to request a transfer.
3. The recipient verifies the organization name in their dashboard and accepts within 24 hours. The sender can cancel; the recipient can decline.

Purchases are unavailable while a transfer is pending. Completion removes the previous owner's KUE management access but preserves projects, project keys, and usage. The new owner should rotate project keys if necessary. This operation does not change GitHub organization ownership itself.

### Workspace deletion and account removal

1. If a subscription exists, cancel it first and wait for it to end. Deletion is unavailable while Checkout or billing reconciliation is pending.
2. Delete the selected workspace by confirming its GitHub owner name. Submissions and KUE image access stop for all its projects.
3. After all owned workspaces have been fully deleted or transferred, expand **Delete account** and confirm your GitHub username to delete your account.

Images, reports, and workspace information are removed progressively after a 15-minute grace period for in-flight uploads. Completion takes at least 15 minutes and may take longer depending on processing and external services. Account removal also revokes sessions and memberships in other workspaces; it does not delete projects belonging to other owners.

GitHub Issues and Stripe invoices are not deleted. KUE cannot open the workspace's billing portal after the workspace is deleted, so retrieve any required invoices first. See data retention below for image-cache and current-month usage records.

### Delivery status

`getKueReportStatus(receipt, { apiBaseUrl }): Promise<KueReportStatus>` retrieves the report's state. `receipt` requires the `id` and `receiptToken` returned at acceptance. The SDK does not poll automatically.

| `status` | Meaning |
| --- | --- |
| `received` | Accepted |
| `queued` | Waiting in the delivery queue |
| `creating_issue` | Issue creation in progress |
| `completed` | Issue created. `githubIssue` contains its number and URL |
| `failed` | Delivery failed. Inspect `error.code` |

`receiptToken` is a secret capability for reading the report. Do not include it in source code, public Issues, or logs.

## Usage limits and data retention

### Plans and limits

| Item | Free | Indie |
| --- | --- | --- |
| Monthly price per workspace | US$0 | US$12, tax included |
| Active submission projects | 1 | Unlimited |
| Monthly submissions | 100 | 5,000 |
| Image storage | 100 MB | 10 GB |
| Image retention | 30 days after acceptance | 365 days after acceptance |

Submission counts and storage are shared across the workspace. One MB is 1,000,000 bytes; one GB is 1,000,000,000 bytes. Monthly quota resets at 00:00 UTC on the first day of each month. Base prices are in US dollars. Check the final amount and payment currency at Checkout. Currency conversion may include a fee, and your card provider or other payment provider may charge separate fees.

New submissions are rejected when monthly quota or storage capacity is reached. There are no automatic overage charges. Accepted reports count toward the monthly quota even if delivery fails; retrying or deleting a report does not restore quota.

Free allows multiple saved connections, but only the selected project can submit; the others are paused. The same restriction applies after returning from Indie to Free. If storage exceeds the Free limit, even the active project cannot submit new reports. Sales availability and conditions are listed on the [pricing page](https://kue.ischca.dev/en/pricing).

### Free destination switching

Multiple connections can be saved, but only the selected repository can accept new Free submissions. The first connection is the initial selection. Connecting another repository asks for confirmation showing the current and proposed destinations. Canceling preserves the connection without changing the destination or completing CLI setup. Switching existing destinations does not require key rotation or manual environment-variable updates.

The first accepted Free report for a new destination restricts switching to another repository for 24 hours, measured from server acceptance rather than the device capture time. Connecting, pre-build checks and failed uploads do not start this restriction. An accepted report still counts and retains the restriction if Issue creation later fails. The dashboard shows the deadline.

Expiry does not switch the destination automatically. Use **Use this project on Free** in the dashboard, or confirm the switch when connecting another app. New submissions from the previous project are immediately rejected. The first Free report accepted for the new repository starts another 24-hour period. Continued use of the same repository, retries of existing reports and key rotation do not extend the deadline. Reports accepted before switching can still be delivered.

The switching restriction follows the immutable GitHub repository ID. Renaming, project or workspace deletion/recreation, and switching between Free and Indie do not remove it. Active Indie subscriptions allow multiple projects to submit. Returning to Free restores the saved selection and any unexpired switching restriction; a deleted selection is not automatically replaced with another project. The 100 monthly reports and storage capacity are shared across projects and do not reset on switching. This restriction applies to repositories within a GitHub owner's workspace, not to the number of apps or devices using the same repository and key.

A valid key for an inactive project returns `project_plan_paused`; a switch during the restriction returns `free_project_locked`. These differ from an invalid or revoked key. Repository and billing details are shown only after GitHub sign-in, never disclosed through an invalid project key. The dashboard distinguishes payment issues confirmed by Stripe synchronization, an ended subscription and an unconfirmed paid period. Returning to Free does not itself cancel a subscription; payment retries may continue.

To prevent deletion/recreation from bypassing the switching restriction, KUE separately retains a secret-keyed hash of the GitHub owner's ID and type, the selected GitHub repository ID and the existing deadline after workspace deletion. This record contains no personal or repository names, project keys, submitted content or Stripe IDs. It is pseudonymized, not guaranteed anonymous. It is no longer used after expiry and is removed by scheduled cleanup. Deletion never extends the 24-hour deadline.

### Expiry and deletion

Image retention is determined by the plan at acceptance. Upgrading does not extend images previously accepted under Free. After an Indie subscription ends, Indie images expire within 30 days of the subscription end, without extending the original 365-day deadline. Each report's expiry is displayed in the dashboard.

After expiry, original images are deleted progressively and their links are replaced with an expiry notice. A delivery-disabled placeholder containing no original image may remain to prevent republication. GitHub Issue text and memos remain. Image expiry alone does not delete KUE report information; that information is removed through project or workspace deletion.

CDN, browser, and GitHub caches may delay the visible change. Immediate revocation of viewing access and deletion of copies saved by third parties are not guaranteed. Expired images cannot be restored.

Deleting and recreating a workspace does not reset the current month's quota. To prevent repeated quota resets, KUE retains the current month's usage count and pseudonymized information for matching the same GitHub owner. Expired records are removed by scheduled cleanup from the following month onward. This is not a guarantee of anonymization.

### Access and sensitive data

- Use HTTPS for Cloud communication. HTTP requests to APIs, authentication endpoints, and images are rejected with 403. Only GET/HEAD requests to standard pages without a query string, Authorization, or Cookie receive a 308 redirect to HTTPS. Redirecting or rejecting a request cannot protect data already sent over HTTP.
- Anyone with an image URL can view the image. Access is not tied to GitHub repository permissions, including for private repositories.
- The project key is public configuration suitable for embedding in the application. A third party who obtains it can also submit reports. Rotate the key if abused.
- After rotation, the old key cannot submit new reports. Rotation does not cancel delivery of previously accepted reports or revoke their image URLs.
- Do not log images, memos, or receipt tokens. Remove secrets and personal information before submission.

Related documents: [Terms of Service](https://kue.ischca.dev/en/terms) / [Privacy Policy](https://kue.ischca.dev/en/privacy).

## Upgrades and removal

### Expo SDK upgrades

The following commands target version 0.6.0, currently in release preparation. Verify publication before running them. For another release, verify the published version and release notes before replacing the version number.

```sh
npm install @kue-qa/react-native@0.6.0
```

To upgrade the SDK with the CLI, specify the target version. Existing connection configuration is reused. Add `--reconnect` only when retrieving configuration again.

```sh
npx kue-qa@0.6.0 init
```

The CLI uses the SDK at its own version. It refuses implicit downgrades of a newer SDK. When nothing has changed, `init` does not write any files. Review the diff when upgrading. No SDK updates occur without running an update command.

Rebuild the development client after changing native dependencies and verify capture and submission on a physical device. Manage dependency versions through the application's lockfile.

### Removal

1. Submit or discard locally queued reports.
2. Remove `Kue`, application-defined triggers, and connection configuration.
3. Uninstall the SDK. Remove shared Expo dependencies only after checking whether other features use them.

Uninstalling the SDK does not delete Cloud projects or GitHub Issues.

## Troubleshooting

### Expo connection configuration for builds and distribution

Verify the Cloud URL and project key in the build environment that embeds them in the app. Editing local `.env.local` does not update EAS environment variables or an already distributed app. Environment variables already set in the build environment take precedence over local files.

After rotating a key or recreating a project, update each build environment, rebuild the app, and distribute the new build. Do not substitute a key belonging to a different repository. Existing queued entries are not automatically migrated to the new key.

Completing CLI 0.6.0 `init` does not guarantee that submission is available. With `recording: auto`, it reads the plan but does not verify Issue delivery or future quota. Before distribution, use `kue-qa check` and the dashboard to inspect project admission, then test submission from the actual distribution build. Later key revocation or quota consumption can still prevent submissions after a build.

### Symptoms and checks

| Symptom | Checks and resolution |
| --- | --- |
| Button not visible | Check `enabled`, `floatingButton`, root mounting, and the docked handle. Release builds disable KUE by default |
| No Issue after local persistence | Check `onSubmit` precedence, `cloud` configuration, the queue, and delivery status |
| Repository not listed | Check personal or organization owner permissions, repository administrator permissions, App repository access, and Issues availability, then refresh the list |
| Workspace unavailable | Check the selected workspace, KUE membership, and current GitHub owner permissions. Other organization owners do not automatically receive access |
| Still Free after purchase | Verify the selected workspace and refresh billing status. Do not purchase again; contact support if unresolved |
| Workspace deletion unavailable | Confirm the subscription has ended, open Checkout sessions have expired, and billing reconciliation has completed. Scheduling cancellation is not sufficient |
| Account removal unavailable | Verify that every owned workspace has been transferred or physically deleted |
| CLI cannot detect a root | Run `--dry-run` in the application package and specify `--root`. Use manual integration for unsupported structures |
| Setup approval link expired | Use the dashboard if setup is complete. Run `init` again from your own terminal only if setup is incomplete. Do not share approval links |
| 401 or invalid project key | Use current dashboard configuration. Entries using an old key are not automatically migrated |
| Submission blocked with 403, 409, or 429 | Check workspace quota, storage, and the active project. Wait before retrying a short-term rate limit |
| Image unavailable | Check retention and deletion status. Wait after a viewing rate limit. Expired images cannot be restored |
| Capture or additional trigger unavailable | Check OS support, dependencies, and the development client rebuild. Test with the button when using a simulator |

### Expo SDK errors

Cloud communication errors are classified by `KueCloudError.code`. `status` is available when an HTTP response was received; `serverCode` is available when the server supplied an error code.

| `code` | Category |
| --- | --- |
| `invalid_config` | Invalid connection configuration |
| `invalid_report` | Invalid report payload |
| `network_error` | Network failure |
| `request_timeout` | Request timeout |
| `unexpected_response` | Unexpected response format |
| `upload_rejected` | Request rejected by the server |

### Support

When contacting [support](mailto:kue@ischca.dev), include SDK, CLI, framework, and OS versions; the timestamp; reproduction steps; the error code; and a requestId if available. Do not attach private keys, GitHub tokens, `receiptToken` values, image URLs, or screenshots containing personal information.
