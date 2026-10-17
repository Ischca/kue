# React Native（Expoなし）

ネイティブのフローティングボタン、範囲とメモの編集、画像と動画をまとめて確認する機能、追加のトリガー、Cloud送信、オフラインキュー（画像1枚のレポートのみ）を使えます。Expoパッケージとは別の導入手順です。

## React Native（Expoなし）の要件

対象はNew ArchitectureのReact Native 0.86.2 / React 19.2.3、iOS 15.1以降またはAndroid API 26以降、JDK 17、compile SDK 36です。ほかのReact Nativeのバージョン、旧アーキテクチャ、Web、macOS、Windowsは対象外です。

パッケージにはネイティブのcoreが同梱されています。Expoへの依存関係、別のKue pod/Gradle project、非公開ソースの取得は不要です。

## React Native coreの導入

```sh
npm install @kue-qa/react-native-bare@0.6.0
cd ios
bundle exec pod install
```

iOSのpodコマンドはmacOSで実行します。その後、アプリでふだん使うXcode/GradleまたはReact Native CLIのコマンドで再ビルドします。AutolinkingとCodegenがモジュールを登録します。Expo用のセットアップCLIは使いません。

Debugでは通常Metroを使い、Releaseでは同梱したJavaScript bundleを使います。単体で起動できるDebugアプリには、bundleの同梱と、対応するAppDelegateの設定が必要です。

## Kueの配置とキャプチャ

アプリのルート付近にKueを1つ配置します。例の仮のURLとプロジェクトキーを、プロジェクトの接続設定の値に置き換えます。この例では、Releaseでも明示的に有効にしています。

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

Kueを配置した後は、アプリの操作からネイティブの画像編集画面を開けます。

```tsx
import { reportIssue } from "@kue-qa/react-native-bare";

await reportIssue({
  memo: "Check this flow",
  context: { route: "/products/yirgacheffe" },
});
```

編集画面を開いただけでは送信されません。reportIssueはキャプチャして画面を表示した後に`Promise<void>`を返します。その後の送信・キューへの保存・キャンセル・指摘の追加は、onOutcomeで通知されます。キャプチャやバックグラウンド移行で中断した場合は、Promiseがrejectされます。

デフォルトではネイティブウィンドウをキャプチャします。保護された表示や、ネイティブの動画・Surfaceはキャプチャできない場合があります。

ローカルに保存する場合は、Cloudの送信先の代わりに、参照が変わらないonSubmitと空でないsubmitLabelを指定します。両方ある場合はonSubmitが優先されます。グループには専用のonSubmitGroupまたはCloudの送信先が必要です。1件ずつのコールバックで代わりに処理することはありません。

コールバックに渡されるメディアURIは、返したPromiseが完了するまでだけ有効です。完了する前にアップロードするか、copyKueMediaFileをawaitしてください。保持したコピーはアプリが管理します。

コピーの削除、独自のキャプチャアダプター、型付きの結果については、パッケージのAPIリファレンスを参照してください。

デフォルト値は、enabledが__DEV__、recordingがauto、フローティングボタンがtrueです。シェイク、OSスクリーンショットのトリガー、offlineQueueはfalseです。言語はja/enを指定しない限り端末の設定に従います。コールバックのタイムアウトは30000 msです。

Kueを配置した後は、Cloud、コールバックの参照、キャプチャ処理、独自トリガー、オフラインキューの設定を変更しても反映されません。コールバックには、参照が変わらないものを使います。設定を変える場合は、Reactのkeyを変えてKueを配置し直します。

## React Nativeの任意録画モジュール

```sh
npm install @kue-qa/react-native-bare-recorder@0.6.0
cd ios
bundle exec pod install
```

両方のプラットフォームを再ビルドします。recorderのimportやJavaScriptでの初期化は不要です。

ローカルに保存する場合も、録画にはまとめ送信の送信先とOSの許可が必要です。また、Cloudで録画が使えるプランであり、受け付けられる状態であることも必要です。録画は音声なしのH.264 MP4で、60秒/20 MiB以下です。

ユーザーが動画を確認して必須のメモを入力したあと、グループを確定します。マイク/カメラの権限は使いません。動画が自動で送信されることもありません。

## React Native KUEの無効化・削除

enabled={false}で、進行中の操作を取り消します。録画のコードとAndroidのサービスの権限を除外する場合は、任意パッケージを削除し、podを更新して再ビルドします。

```sh
npm uninstall @kue-qa/react-native-bare-recorder
cd ios
bundle exec pod install
```

recording="off"は実行時に録画を無効にするだけです。

SDKを削除する場合は、Kueとcoreの依存関係を削除します。端末に保存した送信待ちの画像は、Kueを外した後も残ります。削除が必要な場合は、SDKを削除する前に破棄します。

オフラインキューを有効にした場合、キューに入れたレポートは保存したときの送信先にだけ送られます。グループと動画はキューに入りません。HTTP 202はCloudが受け付けたことを表し、Issueの作成が完了したことは意味しません。

## APIリファレンス

[React Native API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/react-native-bare/README.md)
