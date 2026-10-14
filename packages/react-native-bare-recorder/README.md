# KUE React Native recorder

Version 0.6.0. Optional silent native recording for @kue-qa/react-native-bare.

Install @kue-qa/react-native-bare-recorder@0.6.0 alongside the matching core version, reinstall CocoaPods and rebuild. No recorder import or JavaScript initialization is required. Recording requires a group destination, Cloud entitlement/admission and OS consent, including local callbacks. Output is silent H.264 MP4, at most 60 seconds / 20 MiB. Removing this dependency and rebuilding removes native recording code and Android service permissions; recording="off" does not.

See the core package README for supported versions, setup, callbacks, previews, retry and removal.

## 日本語

バージョン0.6.0。同じ版のcoreと一緒にインストールし、CocoaPods更新・再ビルドを行います。importやJavaScript初期化は不要です。ローカル保存でもグループ送信先、Cloud機能の権限・受付可否、OS許可が必要です。音声なしH.264 MP4、60秒/20 MiB以下を使用します。依存削除と再ビルドで録画コード・Android service権限を除きます。recording="off"では除去しません。要件、導入、コールバック、プレビュー、再試行、削除はcoreのREADMEを参照してください。
