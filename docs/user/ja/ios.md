# ネイティブiOS

スクリーンショットの編集、保存した指摘をまとめて確認する画面、録画（任意）、Cloudへの送信、オフラインキュー（画像1枚のレポートのみ）、追加のトリガーを提供します。送信先にはローカル保存かCloudを指定します。

## ネイティブiOSの導入

iOS 15以上、Swift 5.9以上のUIKitまたはSwiftUIアプリを対象とします。アプリのウィンドウごとに1つの `KueController` を保持します。サードパーティーSDKの依存関係はありません。

デフォルトではDebugビルドで有効、Releaseビルドで無効です。以下の例では両方のビルドで使うために `enabled: true` を指定しています。

Xcodeの **File → Add Package Dependencies** で `https://github.com/Ischca/kue.git` を指定し、**Exact Version** を `0.6.0` にします。アプリのターゲットへ `Kue` 製品を追加します。Swiftパッケージから参照する場合は次の依存関係を使用します。

```swift
dependencies: [
    .package(url: "https://github.com/Ischca/kue.git", exact: "0.6.0")
],
targets: [
    .target(name: "YourApp", dependencies: [.product(name: "Kue", package: "kue")])
]
```

CocoaPodsを使う場合は、GitHub Releaseから `kue-ios-0.6.0.zip` と公開されたSHA-256を取得して照合し、アプリのリポジトリの `vendor` に展開します。`vendor/kue-ios` に `Package.swift`、`Sources`、2つのpodspecがあることを確認します。Podfileが `vendor` と同じ階層にある場合は、次のように指定します。

```ruby
platform :ios, '15.0'

target 'YourApp' do
  pod 'Kue', :path => './vendor/kue-ios'
  # Optional native recording:
  # pod 'KueRecorder', :path => './vendor/kue-ios'
end
```

`pod install` を実行し、生成された `.xcworkspace` を開きます。参照先のソースディレクトリを保持してください。この手順はCocoaPods Trunkを使用しません。

Swift PackageとFlutter/RNパッケージに含まれるネイティブCoreを重複してリンクしないでください。Git URLからの導入には `v0.6.0` タグ、ZIPからの導入には対応するRelease assetの公開が必要です。

## SwiftUIへの組み込み

コントローラーを `@StateObject` の所有者に保持し、`KueHost` を画面へ追加します。次の最小構成のアプリでは保存したメモを画面に表示します。ローカルの結果はメモリ上に保持されます。端末に保存する処理は、必要に応じてアプリ側で実装します。

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

## UIKitへの組み込み

画面またはウィンドウの所有者にコントローラーを保持し、ビューがウィンドウへ入った後に `attach(to:)` を呼びます。SDKの編集画面が表示されただけでは `detach()` を呼ばず、組み込みまたはウィンドウを削除するときに呼びます。

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

## ネイティブiOSのキャプチャと録画

フローティングボタンをタップするか、`try kue.reportIssue(memo: "Check this screen")` を呼ぶと、スクリーンショットの編集を開始します。この呼び出しは、送信の完了を待たずに戻ります。ユーザーが範囲とメモ（必須）を確認してから、保存または送信します。

`onCaptureFinished` はキャプチャの完了を通知します。`onReportOutcome` は、その編集画面での保存、キューへの追加、指摘の追加、キャンセルを通知します。

ローカルのコールバックを使う場合は、保存先をアプリ側で実装します。Cloudを使う場合は、HTTPSのURL（origin）とプロジェクトキーを指定します。キー、メディア、メモ、`receiptToken` をログに記録しないでください。

`Kue` だけをリンクしたビルドには、ReplayKitによる録画の実装が含まれません。録画を使う場合は、`KueRecorder` 製品またはpodも追加し、プロバイダーを渡します。次のURLとキーは例です。

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

録画には、Cloudでのプランの確認、まとめ送信の送信先、対応するネイティブプロバイダー、端末で録画が使えること、システムの許可が必要です。録画を停止したら、プレビューとメモ（必須）を確認してから、指摘に追加します。

録画は音声なしのH.264 MP4で、最大60秒・20 MiBです。画像と動画をまとめて送れるのは、合わせて最大10件、合計20 MiBまでです。まとめた指摘は確認画面で内容を確認してから送信します。

`recording = .off` は、実行時に録画を無効にするだけです。モジュールを削除するには、製品またはpodを削除して再ビルドする必要があります。

`offlineQueue` はデフォルトで無効です。有効にすると、Cloudに送る画像1枚のレポートをオフラインキューに保存します。保存できるのは最大10件・50 MiBで、保存期間は7日です。再試行は、アプリがフォアグラウンドにあり、KUEの画面を開いていないときに行います。まとめ送信と動画はオフラインキューに入りません。

HTTP 202の応答は、Cloudが受け付けたことを表します。Issueの作成が完了したことは意味しません。`readReportStatus(_:)` に `receiptToken` を渡して、状態を取得します（SDKは自動で取得しません）。

`detach()` は、SDKの処理と画面、メモリ上の指摘を解放します。オフラインキューのレポートは必要に応じて別に破棄します。

## APIリファレンス

写真ライブラリやマイクの使用許可は要求しません。録画はOSの許可を得てから開始します。シェイクやOSのスクリーンショットを検知する追加のトリガーは、有効にした場合だけ動作します。保存済みの写真は読み取りません。

KUEを削除する場合は、`detach()` で解除してから、製品またはpodを削除して再ビルドします。必要な場合は、削除する前に、送信待ちのレポートを送信するか破棄します。

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/ios/README.md)
