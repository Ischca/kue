import ExpoModulesCore
import AVKit

public class KueRecorderModule: Module {
  private let recorder = KueScreenRecorder()
  public func definition() -> ModuleDefinition {
    Name("KueRecorder")
    AsyncFunction("record") { (promise: Promise) in
      self.recorder.record { result in
        switch result {
        case .success(let value): promise.resolve(value)
        case .failure(let error): promise.reject("ERR_KUE_RECORDING", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("stop") { self.recorder.stop() }.runOnQueue(.main)
    AsyncFunction("cancel") { self.recorder.cancel() }.runOnQueue(.main)
    AsyncFunction("preview") { (uri: String) in
      let url = try KueScreenRecorder.ownedURL(uri)
      guard let presenter = self.appContext?.utilities?.currentViewController() else { throw KueRecordingError.unavailable }
      let controller = AVPlayerViewController()
      controller.player = AVPlayer(url: url)
      presenter.present(controller, animated: true) { controller.player?.play() }
    }.runOnQueue(.main)
    OnAppEntersBackground { self.recorder.stop() }
    OnDestroy { self.recorder.cancel() }
  }
}
