# Native iOS

Provides screenshot editing, saved-finding group confirmation, optional recording, Cloud submission, a durable single-image outbox, and additional triggers. Configure a local destination or Cloud.

## Install native iOS

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

## Integrate with SwiftUI

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

## Integrate with UIKit

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

## Native iOS capture and recording

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

## API reference

No photo-library or microphone permission is requested. Recording starts through OS consent. Additional shake/OS screenshot triggers are explicitly enabled and do not read saved photos. To remove the integration, call `detach()`, remove its product or pod, and rebuild. Submit or discard required pending reports before removal.

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/ios/README.md)
