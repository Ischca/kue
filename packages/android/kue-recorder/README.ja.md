# KUE Android recorder

ネイティブAndroid SDK用の任意の画面録画実装です。Android API 26以上、Kotlin／JVM 17、compile SDK 36を必要とします。[English](./README.md)

## 導入

[coreの導入手順](../android/README.ja.md)に従って、0.6.0のGitHub Release Maven ZIPを取得・検証・解凍します。アプリモジュールに次の依存を追加して再ビルドします。

```kotlin
implementation("dev.kue.qa:kue-android-recorder:0.6.0")
```

POMは`dev.kue.qa:kue-android:0.6.0`を解決します。Maven Centralの配布座標ではありません。録画用Activityとmedia-projection foreground serviceは非exportedです。`FOREGROUND_SERVICE`と`FOREGROUND_SERVICE_MEDIA_PROJECTION`を追加し、マイク・音声の権限は追加しません。R8でproviderを保持するルールも含まれます。

## 設定と動作

coreの録画モードを`AUTO`にし、Cloudとグループ送信先を設定します。現在のIndie権限とサービス可用性を確認した後、毎回OSの録画同意を要求します。Freeによるロック、サービス停止、権限確認の失敗、recorder未導入による再ビルド要求は別の状態として表示します。

画面全体をシステムバー込みで無音H.264／MP4として記録します。Android 14以上ではアプリ選択画面でホストActivityを起動し直さないよう、標準ディスプレイの同意を要求します。ホストのlaunch modeや`onActivityResult`変更は不要です。OSや端末メーカーの選択ポリシーは変更できません。

SDKは59.5秒または18MiBで停止し、完成した動画を最大60秒／20MiBとして検証します。浮動ボタンの停止操作、通知のStop、ホストがフォアグラウンドを離れたときに停止します。再生と必須メモを確認して指摘へ追加し、グループの送信確認を別に行います。録画からの自動送信やバックグラウンド送信はありません。

`OFF`への変更は未完了の録画をキャンセルします。バイナリから録画用のクラス・サービス・権限を除外するには、この依存を削除して再ビルドしてください。
