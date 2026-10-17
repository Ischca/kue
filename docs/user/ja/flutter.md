# Flutter

Flutterのキャプチャアダプターとネイティブの編集画面を組み合わせて、フローティングボタン、指摘をまとめて確認する機能、任意の録画、追加のトリガー、Cloud送信、オフラインキュー（画像1枚のレポートのみ）を提供します。

## Flutterの要件

Flutter 3.32以降、Dart 3.8以降と、iOS 15以降またはAndroid API 26以降が必要です。動作を確認したFlutter環境は3.32.5 / Dart 3.8.1です。

Androidでは、compile SDK 36、JDK 17と、それに対応するGradle/AGP/Kotlinを使います。参考バージョンはGradle 8.13 / AGP 8.10.1 / Kotlin 2.1.20です。

iOSではCocoaPodsを使います。パッケージにはネイティブ実装が同梱されており、Flutterのplugin loaderで読み込まれます。

## Flutter coreの導入

```sh
flutter pub add kue_qa:0.6.0
```

coreプラグインは必須です。Flutterではpubの依存関係とネイティブビルドを使います。Expo用CLIのセットアップコマンドでは初期化しません。公開パッケージ: [kue_qa 0.6.0](https://pub.dev/packages/kue_qa/versions/0.6.0)、[kue_qa_recorder 0.6.0](https://pub.dev/packages/kue_qa_recorder/versions/0.6.0)。

## Flutterのネイティブビルド設定

iOSでは、Podfileのplatformと、Runnerのdeployment targetを15.0以降に設定します。Flutterからビルドして、プラグインの登録とPodsを更新します。

Flutterのembeddingがすでに UISceneを管理している場合は、その設定をそのまま使います。

Sceneが必須のSDKで、動作を確認したFlutter 3.32のembeddingを使う場合は、導入したcoreパッケージの`integration/ios/KueFlutterSceneDelegate.swift`をRunnerに追加します。`UIApplicationSceneManifest`に1つのapplication sceneを設定し、delegateを`$(PRODUCT_MODULE_NAME).KueFlutterSceneDelegate`にします。

AppDelegateはFlutterAppDelegateを継承したままにし、テンプレートにある`GeneratedPluginRegistrant.register(with: self)`を削除します。実際のcontrollerはSceneが1回だけ登録します。2つ目のengineは作成しないでください。

このFlutter 3.32の設定では、プラグインへのリンクを生成し、同梱のSceneファイルをコピーします。

```sh
flutter build ios --debug --config-only --no-codesign
(cd ios && pod install)
cp ios/.symlinks/plugins/kue_qa/integration/ios/KueFlutterSceneDelegate.swift ios/Runner/
```

Xcodeで、コピーしたSwiftファイルをRunner targetに追加し、RunnerのInfo.plistに次の設定を追加します。

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

Androidでは、appのminSdkを26、compileSdkを36に設定し、JDK 17と、上記の対応するGradle/AGP/Kotlinを使います。coreと任意のrecorderは、Flutterのplugin loaderがリンクします。

どちらのプラットフォームでも、同じネイティブのKue pod/projectを重複して追加しないでください。ネイティブの依存関係を変更したら再ビルドします。

## KueHostの利用

`MaterialApp.builder`で、root Navigatorの外側にKueHostを1つ配置します。参照が変わらないローカルのコールバックと空でない保存ラベルを指定するか、Cloud設定を指定します。

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

この例は最後のメモだけをメモリに保持します。外部への送信やIssue作成は行いません。

端末への保存と重複防止は、`clientReportId`を使ってコールバック側で実装します。コールバックは変更できない`imageBytes`、メモ、メタ情報を受け取ります。

コールバックが完了したことを、ローカル保存の完了として扱います。保存に失敗した場合はネイティブの編集画面がそのまま残り、同じIDと内容で再試行できます。

グループには、専用の`onSubmitGroup`またはCloudの送信先が必要です。指摘ごとに`onSubmit`を呼んで代わりに処理することはありません。

Cloud送信を使うには、プロジェクトの接続設定（URLとプロジェクトキー）を取得して、例の仮の値を置き換えます。両方を指定した場合は、ローカルの`onSubmit`が優先されます。

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

`enabled`のデフォルト値は`kDebugMode`です。Profile/Releaseでは、明示的に有効にしない限り無効です。

`reportIssue`は、送信・キューへの保存・指摘の追加・キャンセルの後に`Future<KueReportOutcome>`を返します。実行できない場合はbusy/disabledを返します。キャプチャに失敗した場合は型付きのエラーになります。

デフォルトのキャプチャではFlutterのRepaintBoundaryを長辺2048ピクセルまでのPNGにします。

ネイティブのダイアログ、PlatformView、外部texture、保護された表示のキャプチャは保証しません。ネイティブウィンドウのキャプチャに切り替えて補うこともありません。必要に応じて、独自のPNGキャプチャアダプターを指定します。

## Flutterの任意録画モジュール

```sh
flutter pub add kue_qa_recorder:0.6.0
```

Dartでのrecorderのimportや初期化は不要です。両方のプラットフォームを再ビルドします。

録画するには、まとめ送信の送信先を設定し、OSの許可を得る必要があります。また、Cloudで録画が使えるプランであり、受け付けられる状態であることも必要です。ローカルのグループ用コールバックで保存する場合も同じです。録画は音声なしのH.264 MP4で、60秒/20 MiB以下です。

ユーザーが動画を確認して必須のメモを入力し、グループを確定します。動画が自動で送信されることはありません。グループと動画はオフラインキューに入りません。

`recording: off`にすると実行時に録画は止まりますが、コンパイル済みのモジュールとAndroidのサービスの権限は残ります。

## Flutter KUEの無効化・削除

`enabled: false`でKueHostの連携を止めます。バイナリから録画を除外する場合は、依存関係を削除して再ビルドします。

```sh
flutter pub remove kue_qa_recorder
flutter pub get
# On macOS for iOS:
cd ios && pod install
```

KUE自体を削除する場合は、KueHostとcoreの依存関係を削除します。KueHostを外しても、端末に保存した送信待ちの画像は削除されません。削除が必要な場合は、SDKを削除する前に対象を破棄します。

オフラインキュー（画像1枚のレポートのみ）はデフォルトで無効です。キューに入れたレポートは、保存したときの送信先にだけ送られます。キューに入った状態は端末に保存されたことを表します。HTTP 202はCloudが受け付けたことを表し、Issueの作成が完了したことは意味しません。

## APIリファレンス

[Flutter APIリファレンス](https://github.com/Ischca/kue/blob/v0.6.0/packages/flutter/API.md)
