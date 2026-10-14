import Flutter
import UIKit

// Add this source to Runner only when the Flutter embedding requires an explicit scene.
// AppDelegate remains FlutterAppDelegate; do not register a second engine there.
class KueFlutterSceneDelegate: NSObject, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options connectionOptions: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene,
          let delegate = UIApplication.shared.delegate as? FlutterAppDelegate else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window; delegate.window = window
    let controller = FlutterViewController(project: nil, nibName: nil, bundle: nil)
    window.rootViewController = controller; window.makeKeyAndVisible()
    GeneratedPluginRegistrant.register(with: controller)
  }
  func sceneDidDisconnect(_ scene: UIScene) {
    if let delegate = UIApplication.shared.delegate as? FlutterAppDelegate, delegate.window === window {
      delegate.window = nil
    }
    window?.rootViewController = nil; window = nil
  }
}
