#if canImport(UIKit)
import UIKit

public struct KueCapturedImage {
    public let image: UIImage, capturedAt: Date
    public let context: KueContextOverrides
    public init(image: UIImage, capturedAt: Date = Date(), context: KueContextOverrides = .init()) {
        self.image = image; self.capturedAt = capturedAt; self.context = context
    }
}
public typealias KueCaptureAdapter = @MainActor () async throws -> KueCapturedImage
final class KueOwnedMenu: UIAlertController {
    var didClose: (() -> Void)?
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); let callback = didClose; didClose = nil; callback?() }
}
#endif
