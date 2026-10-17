# Flutter

Combines Flutter capture with native editors, floating controls, finding-group confirmation, optional recording, additional triggers, Cloud delivery and a durable single-image outbox.

## Flutter requirements

Flutter 3.32+ / Dart 3.8+, iOS 15+ or Android API 26+ are required. The checked Flutter toolchain is 3.32.5 / Dart 3.8.1. Android requires compile SDK 36, JDK 17 and compatible Gradle/AGP/Kotlin versions; the reference versions are Gradle 8.13 / AGP 8.10.1 / Kotlin 2.1.20. iOS uses CocoaPods. The packages include their native runtime and use Flutter's plugin loader.

## Install Flutter core

```sh
flutter pub add kue_qa:0.6.0
```

The core plugin is required. Flutter uses pub dependencies and native builds; the Expo CLI setup command does not initialize a Flutter app. Published packages: [kue_qa 0.6.0](https://pub.dev/packages/kue_qa/versions/0.6.0) and [kue_qa_recorder 0.6.0](https://pub.dev/packages/kue_qa_recorder/versions/0.6.0).

## Configure Flutter native builds

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

## Use KueHost

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

## Add optional Flutter recording

```sh
flutter pub add kue_qa_recorder:0.6.0
```

No Dart recorder import or initialization is required. Rebuild both native applications. Recording additionally needs a group destination, Cloud feature entitlement/admission and OS consent, even when a local group callback saves the result. It produces silent H.264 MP4, up to 60 seconds / 20 MiB. The user reviews a clip, adds a required memo and explicitly confirms its group. There is no automatic video upload or durable group/video outbox. `recording: off` disables recording at runtime but retains the compiled module and Android service permissions.

## Disable or remove Flutter KUE

Set `enabled: false` to cancel the host integration. To exclude recording from the binary, remove its dependency and rebuild:

```sh
flutter pub remove kue_qa_recorder
flutter pub get
# On macOS for iOS:
cd ios && pod install
```

Remove KueHost and the core dependency to remove KUE. Removing a host does not delete durable pending screenshots; discard owned entries explicitly before removing the SDK when deletion is required. The optional Cloud screenshot outbox defaults to false and is bound to its original destination. Queueing is local storage; HTTP 202 is acceptance, not completed Issue creation.

## API reference

[Flutter API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/flutter/API.md)
