# KUE Flutter recorder

Version 0.6.0. Optional silent native screen recording for kue_qa.

## Install

```sh
flutter pub add kue_qa:0.6.0
flutter pub add kue_qa_recorder:0.6.0
```

Requires Flutter 3.32+ / Dart 3.8+, iOS 15+ with CocoaPods or Android 26+ / compile SDK 36 / JDK 17. Rebuild the native application after adding this dependency. No Dart import or initialization is required. The package includes ReplayKit/MediaProjection implementation; do not add another native KueRecorder copy.

## Use recording

Configure KueHost with an onSubmitGroup callback and label or a Cloud group destination. Cloud feature entitlement/admission and OS consent are required even for local callbacks. Recording produces silent H.264 MP4, at most 60 seconds / 20 MiB. The user previews it, enters a required memo, adds it to the group and explicitly confirms saving/submission. Nothing uploads automatically; no microphone/camera permission is used. The core distinguishes off, Cloud required, checking/check failed, upgrade, unavailable, rebuild and ready. Full or locked drafts must be reviewed before another recording.

## Remove

```sh
flutter pub remove kue_qa_recorder
flutter pub get
# On macOS for iOS:
cd ios && pod install
```

Rebuild to remove the compiled module and Android foreground-service permissions. Setting recording: off only stops runtime recording. KueHost is disabled by default in Profile/Release unless explicitly enabled. See the kue_qa API reference for session cancellation, grouped findings and Cloud errors.

## 日本語

バージョン0.6.0。kue_qa用の任意録画モジュールです。上記のpub依存を追加し、ネイティブアプリを再ビルドします。Flutter 3.32/Dart 3.8以降、iOS 15/CocoaPodsまたはAndroid 26/compile SDK 36/JDK 17が必要です。Dartのimportや初期化、別のKueRecorder実装の追加は不要です。

KueHostにラベル付きonSubmitGroupまたはCloudのグループ送信先を指定します。ローカル保存でもCloud機能確認・受付可否・OS許可が必要です。音声なしH.264 MP4、60秒/20 MiB以下で、確認・必須メモ・グループ追加後に明示的に確定します。自動送信やマイク/カメラ権限はありません。無効・Cloud未設定・確認中/確認失敗・アップグレード・利用不可・再ビルド・利用可能を区別し、満杯/固定済みdraftは次の録画前に確認します。

録画を除く場合は上記の依存削除・pub get・iOSのpod install後に再ビルドします。recording: offではコードやAndroid foreground service権限を除去しません。Profile/ReleaseのKueHostは明示的に有効化するまで既定無効です。連携の中断・グループ・CloudエラーはcoreのAPI説明を参照してください。
