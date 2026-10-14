# KUE Flutter

Version 0.6.0. Native report editing, grouped findings, triggers and Cloud delivery for Flutter iOS/Android applications. The optional recorder is a separate dependency.

### Flutter requirements

Flutter 3.32+ / Dart 3.8+, iOS 15+ or Android 26+ are required. The checked Flutter toolchain is 3.32.5 / Dart 3.8.1. Android requires compile SDK 36, JDK 17 and compatible Gradle/AGP/Kotlin versions; the reference versions are Gradle 8.13 / AGP 8.10.1 / Kotlin 2.1.20. iOS uses CocoaPods. The packages include their native runtime and use Flutter's plugin loader.

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

## API reference

The installed package contains API.md with capture adapters, callbacks, context, Cloud utilities, errors, retry and queue limits.

## 日本語

バージョン0.6.0。FlutterのiOS/Androidアプリでネイティブの編集・指摘まとめ・トリガー・Cloud送信を利用します。録画は独立した任意依存です。

### Flutterの要件

Flutter 3.32以降、Dart 3.8以降、iOS 15以降またはAndroid 26以降が必要です。確認済みのFlutter環境は3.32.5 / Dart 3.8.1です。Androidはcompile SDK 36、JDK 17と互換性のあるGradle/AGP/Kotlinを使用し、参照バージョンはGradle 8.13 / AGP 8.10.1 / Kotlin 2.1.20です。iOSはCocoaPodsを使用します。パッケージにネイティブ実装を同梱し、Flutterのplugin loaderを使います。

### Flutter coreの導入

```sh
flutter pub add kue_qa:0.6.0
```

coreプラグインは必須です。Flutterはpub依存とネイティブビルドを使用し、Expo用CLIのセットアップコマンドでは初期化しません。

### Flutterのネイティブビルド設定

iOSはPodfileのplatformとRunnerのdeployment targetを15.0以降に設定します。Flutterからビルドし、プラグイン登録とPodsを更新します。embeddingが既にUISceneを管理している場合は、その設定を維持します。Sceneが必須のSDKで確認済みFlutter 3.32 embeddingを使う場合は、導入したcoreパッケージの`integration/ios/KueFlutterSceneDelegate.swift`をRunnerに追加します。`UIApplicationSceneManifest`に1つのapplication sceneを設定し、delegateを`$(PRODUCT_MODULE_NAME).KueFlutterSceneDelegate`にします。AppDelegateはFlutterAppDelegateを継承し、テンプレートの`GeneratedPluginRegistrant.register(with: self)`を削除します。Sceneが実際のcontrollerに1回だけ登録し、2つ目のengineは作成しません。

このFlutter 3.32設定では、プラグインへのリンクを生成して同梱Sceneファイルをコピーします。

```sh
flutter build ios --debug --config-only --no-codesign
(cd ios && pod install)
cp ios/.symlinks/plugins/kue_qa/integration/ios/KueFlutterSceneDelegate.swift ios/Runner/
```

XcodeでコピーしたSwiftファイルをRunner targetに追加し、RunnerのInfo.plistに次を追加します。

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

AndroidはappのminSdkを26、compileSdkを36に設定し、JDK 17と上記の互換Gradle/AGP/Kotlinを使用します。Flutterのplugin loaderがcoreと任意のrecorderをリンクします。どちらのプラットフォームも、同じネイティブKue pod/projectを重複追加しないでください。ネイティブ依存を変更したら再ビルドします。

### KueHostの利用

`MaterialApp.builder`でroot Navigatorの外側に1つのhostを配置します。安定したローカルコールバックと空でない保存ラベル、またはCloud設定を指定します。

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

この例は最後のメモだけをメモリ内に保持し、外部送信やIssue作成を行いません。永続保存と重複防止は`clientReportId`を使用してコールバック側で実装します。変更不可の`imageBytes`、メモ、metadataを受け取り、コールバック完了をローカル保存完了とします。保存失敗時はネイティブ編集画面に残り、同じIDと内容で明示的に再試行できます。グループには独立した`onSubmitGroup`またはCloud送信先が必要で、指摘ごとに`onSubmit`を呼ぶ代替処理はありません。

Cloud送信にはプロジェクトの接続設定からorigin/keyを取得し、偽の値を置き換えます。両方指定した場合はローカル`onSubmit`を優先します。

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

`enabled`の既定値は`kDebugMode`で、Profile/Releaseでは明示的に有効化しない限り無効です。`reportIssue`は送信・キュー保存・指摘追加・キャンセル後に`Future<KueReportOutcome>`を返し、実行できない場合はbusy/disabledを返します。撮影失敗は型付きエラーになります。既定の撮影はFlutterのRepaintBoundaryを長辺2048ピクセルまでのPNGにします。ネイティブダイアログ、PlatformView、外部texture、保護された表示は保証せず、ネイティブウィンドウ撮影への代替は行いません。必要に応じて独自PNG撮影アダプターを指定します。

### Flutterの任意録画モジュール

```sh
flutter pub add kue_qa_recorder:0.6.0
```

Dartでのrecorder importや初期化は不要です。両プラットフォームを再ビルドします。ローカルのグループコールバックで保存する場合も、グループ送信先、Cloud機能の権限・受付可否、OSの許可が必要です。音声なしH.264 MP4、60秒/20 MiB以下を使用します。ユーザーが動画を確認して必須メモを入力し、グループを明示的に確定します。動画の自動送信や、グループ/動画の永続outboxはありません。`recording: off`は実行時に停止しますが、コンパイル済みモジュールとAndroidのservice権限は残ります。

### Flutter KUEの無効化・削除

`enabled: false`でhostの連携を中断します。バイナリから録画を除く場合は依存を削除し、再ビルドします。

```sh
flutter pub remove kue_qa_recorder
flutter pub get
# On macOS for iOS:
cd ios && pod install
```

KUE自体を除く場合はKueHostとcore依存を削除します。hostを外しても永続保存した送信待ち画像は削除しないため、削除が必要ならSDKを除く前に対象を明示的に破棄します。任意のCloud単体画像outboxは既定falseで、元の送信先に固定します。queueはローカル保存、HTTP 202は受付を示し、Issue作成完了を意味しません。

導入したパッケージのAPI.mdに、撮影アダプター・コールバック・context・Cloud API・エラー・再試行・送信待ちの制限を記載しています。
