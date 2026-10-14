# KUE for React Native without Expo

Version 0.6.0. Native screenshot editing, grouped findings, recording and Cloud delivery for React Native iOS/Android applications. Recording is a separate optional dependency.

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

## 日本語導入手順

### ExpoなしReact Nativeの要件

対象はReact Native 0.86.2 / React 19.2.3のNew Architecture、iOS 15.1以降またはAndroid API 26以降、JDK 17、compile SDK 36です。別のReact Nativeバージョン、旧アーキテクチャ、Web、macOS、Windowsは対象外です。パッケージにネイティブcoreを同梱し、Expo依存、別のKue pod/Gradle project、非公開ソースの取得は不要です。

### React Native coreの導入

```sh
npm install @kue-qa/react-native-bare@0.6.0
cd ios
bundle exec pod install
```

iOSのpodコマンドはmacOSで実行し、アプリで通常使うXcode/GradleまたはReact Native CLIのコマンドで再ビルドします。AutolinkingとCodegenがモジュールを登録します。Expo用セットアップCLIは使用しません。通常のDebugはMetro、Releaseは同梱JavaScript bundleを使用します。単独起動できるDebugアプリには、bundleの同梱と対応するAppDelegate設定が必要です。

### Kueの配置と撮影

アプリのルート付近にKueを1つ配置します。偽のorigin/keyをプロジェクトの接続設定に置き換えます。この例はReleaseでも明示的に有効化します。

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

hostを配置した後、アプリの操作からネイティブの画像編集画面を開けます。

```tsx
import { reportIssue } from "@kue-qa/react-native-bare";

await reportIssue({
  memo: "Check this flow",
  context: { route: "/products/yirgacheffe" },
});
```

編集画面を開いただけでは送信しません。reportIssueは撮影・表示後に`Promise<void>`を返し、その後の送信・キュー保存・キャンセル・指摘追加はonOutcomeで通知します。撮影・バックグラウンド移行による中断はPromiseをrejectします。既定はネイティブウィンドウ撮影で、保護された表示やネイティブ動画・Surfaceを撮影できない場合があります。

ローカル保存にはCloud送信先の代わりに、安定したonSubmitと空でないsubmitLabelを指定します。両方ある場合はonSubmitを優先します。グループには独立したonSubmitGroupまたはCloud送信先が必要で、個別コールバックで代用しません。メディアURIは返したPromiseが完了するまで有効です。完了前にアップロードするかcopyKueMediaFileをawaitし、保持したコピーはアプリが管理します。コピー削除、独自撮影アダプター、型付き結果はパッケージのAPIリファレンスを参照してください。

既定値はenabledが__DEV__、recordingがauto、フローティングボタンがtrueです。シェイク、OSスクリーンショットトリガー、offlineQueueはfalseです。言語はja/enを指定しない限り端末に従い、コールバック期限は30000 msです。Cloud、ハンドラ参照、撮影、独自トリガー、queue設定は配置中に固定します。安定したコールバックを使い、変更時はReactのkeyを変えて再配置します。

### React Nativeの任意録画モジュール

```sh
npm install @kue-qa/react-native-bare-recorder@0.6.0
cd ios
bundle exec pod install
```

両プラットフォームを再ビルドします。recorderのimportやJavaScript初期化は不要です。ローカル保存でもグループ送信先、Cloud機能の権限・受付可否、OSの許可が必要です。音声なしH.264 MP4、60秒/20 MiB以下で、ユーザーが確認・必須メモ入力後にグループを明示的に確定します。マイク/カメラ権限や動画の自動送信はありません。

### React Native KUEの無効化・削除

enabled={false}で現在の操作を取り消します。録画コードとAndroid service権限を除く場合は任意パッケージを削除し、podを更新して再ビルドします。

```sh
npm uninstall @kue-qa/react-native-bare-recorder
cd ios
bundle exec pod install
```

recording="off"は実行時だけ無効化します。SDKを除く場合はKueとcore依存を削除します。永続保存した未送信画像はhostの削除後も残るため、削除が必要ならSDKを除く前に明示的に破棄します。任意のCloud画像outboxは送信先に固定し、グループ・動画は保存しません。HTTP 202は受付を示し、Issue作成完了を意味しません。


## Mount and capture

```tsx
import { useCallback } from "react";
import { Kue, reportIssue, copyKueMediaFile, type KueLocalReport } from "@kue-qa/react-native-bare";

function Feedback() {
  const save = useCallback(async (report: KueLocalReport) => {
    const retainedUri = await copyKueMediaFile(report.screenshot.uri);
    await saveInApplication({ ...report, screenshot: { ...report.screenshot, uri: retainedUri } });
  }, []);
  return <Kue onSubmit={save} submitLabel="Save" locale="en" />;
}

// From an application action after Feedback is mounted:
await reportIssue({ memo: "Check this flow", context: { route: "/products/yirgacheffe" } });
```

Mount one `Kue` near the application root. Its native anchor ignores input and
accessibility. Native core owns the draggable classic/mascot trigger, the
500 ms hold menu, docking/reveal, screenshot capture, crop/memo editor, saved
findings, recording preview and outbox. Native window capture is the default;
secure/protected content and native surface/video views can be unavailable.
A custom `capture` adapter must return an app-private JPEG/PNG file URI,
dimensions, `mimeType`, `capturedAt` and optional `context`/JS-only `cleanup`.
Native imports and validates the file; it never deletes an adapter-owned source.
Cleanup runs once after import or retirement, including a late adapter result.
Host, `reportIssue` and capture-derived overrides cannot contain `platform`;
it always describes the actual native capture. Standalone report/group helpers
preserve their complete input context's explicit `ios`/`android` platform and
supplied optional fields, omitting absent fields without automatic metadata filling.

`reportIssue(options?)` returns `Promise<void>` after capture and editor
presentation. It does **not** wait for submission. Capture/background
cancellation rejects the promise. `onOutcome` reports later `submitted`,
`queued`, `cancelled`, `findingAdded` or `failed`, with an operation ID. An
outbox receipt cannot settle another screenshot operation. Calls use the newest
enabled foreground host; no available host throws `KueUnavailableError`.
Creation order is sent as an immutable bounded `mountOrder`; asynchronous anchor
or recorder installation cannot reorder hosts. Order is stable across disable/re-enable and foreground changes. A newer
disabled host does not replace an older enabled host. Changing native UI ownership
cancels/discards the previous session's current editor, findings and recording;
the selected host is installed fresh from its frozen configuration. Disabling or
unmounting the newest host restores an older enabled host. Durable outbox entries
remain destination-bound, and an old delayed detach cannot uninstall its replacement.

## Destinations and lifetime

- `onSubmit` takes precedence over `cloud`; `cloud` can still supply recording
  entitlement checks. A local handler requires a nonempty `submitLabel`.
- `onSubmitGroup` is an independent, explicitly confirmed group destination.
  Without it, local groups never fall back to repeated single callbacks. With
  Cloud single submission and a custom group handler, `submitLabel` is required;
  `groupSubmitLabel` optionally overrides group action text.
- Local callbacks receive the same Expo-shaped image/video/group DTOs, without
  Expo context. Media crosses the bridge as URI metadata, never arrays/base64.
  The URI is valid only while the callback's returned promise is pending.
  Upload/copy media before resolving. `copyKueMediaFile(uri)` accepts only a
  current callback's exact URI and returns an application-owned retained copy.
  Copies survive completion/unmount. `removeKueCopiedMediaFile(uri)` deletes
  only SDK-created copies; applications manage their retention.
- Cloud uses native validated multipart transport: HTTPS origin, create-only
  key, 15-second default timeout (1–120000 ms), no redirects/cookies. Debug HTTP
  requires `allowDevelopmentLocalhostHttp: true` and localhost/127.0.0.1/::1.
  Android local fixtures can use `adb reverse`; `10.0.2.2` is rejected by JS.
  Only a valid HTTP 202 receipt invokes `onReceipt`. Receipt tokens are secret
  read capabilities and must not be logged.

Cloud configuration, local handler identities, capture identity, custom trigger
identities, `offlineQueue` and callback timeout are immutable within a mounted
host. Use stable `useCallback` handlers. Changing an immutable setting reports
`configuration_changed` and retains the original destination/handlers. Remount
with a new React `key` to apply a new configuration; session findings are cleared.
Durable destination-bound screenshots remain.

Visual settings, locale, context, action labels, built-in triggers, `enabled`
and recording mode can update. `enabled: false` and `recording: "off"` apply
even when another changed setting is rejected. A subsequent valid update of
the original configuration restores operation; it cannot retarget a locked
draft. Disable/background/unmount cancels active work. Activity recreation
clears session findings and reinstalls the same frozen configuration.

`enabled` defaults to `__DEV__`; `recording` defaults to `"auto"`; floating button
defaults to true; offline queue/shake/system screenshot triggers default to false.
Locale follows the native preferred languages unless fixed to `ja`/`en`.
Callback timeout defaults to 30000 ms (1–120000). Custom trigger subscription may
return cleanup synchronously or asynchronously; late setup is cleaned once.
Observer exceptions do not alter accepted submissions or native retry state.

Local callback failures retain their prepared payload and use
`local_save_failed`, including on iOS; they are not reported as network failures.
Explicit callback timeout/capture/cancellation errors retain their native
semantics.

## API reference

| API | Return / behavior |
| --- | --- |
| `submitKueReport(report, cloud)` | `Promise<KueReceipt>`; snapshots an app-private screenshot before upload. |
| `submitKueReportGroup(group, cloud)` | `Promise<KueReceipt>`; ordered mixed group, stable group ID. |
| `getKueProjectFeatures(cloud)` | `Promise<KueProjectFeatures>`; no automatic polling. |
| `getKueReportStatus({id, receiptToken}, {apiBaseUrl, timeoutMs?})` | `Promise<KueReportStatus>`; receipt-only authentication, no project key required. |
| `pendingKueReports(cloud, includeOtherDestinations?)` | `Promise<readonly KuePendingReport[]>`; IDs/dates/state/current-destination only, no keys/media. |
| `retryPendingKueReports(cloud, {force?, active?, receipt?, error?})` | `Promise<void>`; explicit manual force; optional guard is checked before retry and every 250 ms, cancellation reaches native transport. |
| `discardPendingKueReport(cloud, id)` | `Promise<void>`; current destination only. |
| `openKueSavedFindings()`, `openKueOutbox()` | `Promise<void>`; current host management UI. |
| `beginKueRecording()`, `stopKueRecording()` | `Promise<void>`; optional provider and runtime feature checks apply. |
| `getKueRuntimeState()`, `refreshKueProjectFeatures()`, `readKueReportStatus(receipt)` | Typed promises from current host. |
| `listKuePendingReports(includeOtherDestinations?)`, `retryKuePendingReports(force?)`, `discardKuePendingReport(id, includeOtherDestinations?)` | Current-host queue management; other destinations can be inspected/discarded, never retargeted. |

Report status `error.code` is an opaque server string, preserved within the
128 KiB bridge JSON limit. Transport error codes and `serverCode` remain sanitized.

Images: 10 MiB / 16 million pixels. Video: silent H.264 MP4, up to 60 seconds /
20 MiB. Groups: 1–10 findings / 20 MiB total, title up to 200 Unicode codepoints;
memo up to 4 KiB UTF-8, metadata up to 16 KiB. A prepared failed payload retains
its exact bytes and ID for retry; groups are locked after preparation. Editing
a failed single creates a new report and does not silently remove its old
blocked durable entry.

Offline queue is opt-in, Cloud screenshots only: 10 reports / 50 MiB / 7 days.
It survives process restart, binds each entry to its original origin/key, obeys
backoff/Retry-After, and blocks permanent failures. Groups/videos are not queued.
There are no OS background jobs. Accepted receipts remove entries; unknown
acceptance can replay only the original bytes/ID. Corrupt/unsafe files fail
closed; changed keys never reroute pending media.

If a native Retry-After value cannot be represented as finite, nonnegative
JavaScript milliseconds at or below `Number.MAX_SAFE_INTEGER`, the bridge
preserves the error code, HTTP status and server code, sets `retryable: false`,
and omits `retryAfterMs`. Representable delays are unchanged. Native outbox
deadlines and explicit manual `force` behavior are unchanged.

Recording is checked against Cloud's Indie entitlement and server availability,
native provider inclusion and device capability. Runtime `off` stops recording;
it does not remove recorder code/permissions from a compiled binary. A core-only
consumer has no ReplayKit or Android recording service/FGS permissions. Physical
recording/media validation and external Cloud-to-Issue delivery are separate
checks from source compilation.

## 日本語

バージョン0.6.0。対象はRN 0.86.2 / React 19.2.3のNew Architecture、iOS 15.1以上、Android API 26以上、JDK 17、compile SDK 36です。旧アーキテクチャ、別のRNバージョン、Web、macOS、Windowsは対象外です。

上記のnpmパッケージを導入し、iOSはCocoaPodsを更新してネイティブアプリを再ビルドします。録画は同じ版の任意パッケージを追加します。各パッケージにネイティブ実装を同梱し、別のKue pod/Gradle projectや非公開ソースの取得は不要です。

アプリのルート付近に `Kue` を配置します。ボタン、500 ms 長押しメニュー、
ドック、撮影、範囲選択、メモ、指摘の確認、録画プレビュー、未送信画面は
ネイティブ SDK が表示します。標準はネイティブ画面撮影です。保護された画面や
ネイティブの動画・Surface は撮影できない場合があります。独自 `capture` は
アプリ内の JPEG/PNG URI、寸法、MIME、撮影日時と任意の context/cleanup を返します。
元ファイルは SDK が削除せず、cleanup は読込・取消後に一度だけ呼ばれます。
ホスト・`reportIssue`・撮影アダプタの context で platform は上書きできません。
単独送信 API は入力の ios/android と任意フィールドを保持し、未指定の情報を
自動補完しません。

`reportIssue()` は編集画面が開いた時点で解決し、送信結果は後から `onOutcome`
で通知します。`onSubmit` が Cloud より優先し、グループには独立した
`onSubmitGroup` が必要です。ローカル保存には `submitLabel` を指定します。
コールバックの URI は返した Promise が解決するまで有効です。長期保存は
`copyKueMediaFile()` を await し、不要になったコピーは
`removeKueCopiedMediaFile()` で削除します。画像のバイト列や base64 は JS に渡しません。

生成順を固定の mountOrder で渡し、非同期の設置順に左右されません。
マウント順は無効化・再有効化でも変わりません。新しい無効ホストは既存の有効
ホストを置き換えず、新しいホストの無効化・破棄で古い有効ホストへ戻ります。
ネイティブ UI の所有者が変わると、以前の編集画面・指摘・録画を取り消して
破棄し、選ばれたホストの固定設定で再設置します。未送信画像の送信先は保持し、
遅れて返った古い detach で新しいホストを解除しません。

Cloud・保存ハンドラ・撮影アダプタ・独自トリガー・未送信設定・コールバック期限は
マウント中に固定されます。`useCallback` で参照を保ち、設定変更は React の key
を変えて再マウントします。指摘の下書きは消え、送信先に紐づいた未送信画像は
残ります。変更拒否時も `enabled:false` / `recording:"off"` は先に反映します。
元の固定設定を使う次の有効な更新で復帰できます。

初期値は enabled が `__DEV__`、録画が auto、浮動ボタンが有効、未送信保存・
シェイク・OS スクリーンショットトリガーが無効です。言語は端末に従い ja/en
に固定できます。コールバック期限は 30 秒、指定範囲は 1–120000 ms です。
非同期トリガーの遅い登録も解除され、通知ハンドラの例外は送信結果を変更しません。

上記 API 表の送信・機能・処理状況・未送信 API はマウントなしでも動作します。
処理状況は受付トークンのみで認証し、キーを要求しません。受付トークンは記録・
公開しないでください。HTTPS が必須で、明示的な Debug 設定のみ loopback HTTP
を許可します。Android のローカル検証は `adb reverse` を使い、10.0.2.2 は不可です。

処理状況の `error.code` はサーバーの文字列を、ブリッジ JSON 全体の 128 KiB
制限内でそのまま保持します。通信エラーの種別と `serverCode` の制限は変わりません。

画像は 10 MiB / 1600 万画素、無音 H.264 MP4 は 60 秒 / 20 MiB、グループは
1–10 件 / 合計 20 MiB、タイトルは 200 Unicode コードポイント、メモは UTF-8
4 KiB、メタデータは 16 KiB です。再試行は同じ ID・データを保持します。
未送信保存は Cloud の画像のみ、10 件 / 50 MiB / 7 日で、グループと動画は
対象外です。送信先の変更で転送せず、恒久的なエラーは blocked になります。
OS バックグラウンドジョブや自動ポーリングはありません。

ネイティブの Retry-After を有限・非負かつ `Number.MAX_SAFE_INTEGER` 以下の
JavaScript ミリ秒で表せない場合、ブリッジはエラー種別・HTTP 状態・サーバーの
エラーコードを保持し、`retryable:false` として `retryAfterMs` を省略します。
表現可能な待ち時間、ネイティブの未送信データの再試行期限、明示的な手動
`force` の動作は変わりません。

録画は Indie・Cloud の受付可否・任意モジュール・端末対応を確認します。off は
録画を停止しますが、バイナリからコードを除きません。モジュールなしの consumer
には ReplayKit と Android の録画サービス・FGS 権限を含めません。実機録画と
Cloud から Issue への到達は、ソースビルドとは別の検証結果です。
