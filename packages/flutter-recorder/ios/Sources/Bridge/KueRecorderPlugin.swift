import Foundation
import Flutter
import kue_qa

/// Installation is per engine; importing the core plugin never links ReplayKit.
@MainActor public final class KueRecorderPlugin: NSObject, FlutterPlugin {
    private let messenger: AnyObject
    private let owner = UUID().uuidString
    private init(messenger: AnyObject) { self.messenger = messenger }
    nonisolated public static func register(with registrar: FlutterPluginRegistrar) {
        let register = {
            MainActor.assumeIsolated {
                let plugin = KueRecorderPlugin(messenger: registrar.messenger())
                registrar.publish(plugin)
                KueFlutterRecordingRegistry.install(messenger: plugin.messenger, owner: plugin.owner) { KueReplayKitRecorder() }
            }
        }
        if Thread.isMainThread { register() } else { DispatchQueue.main.async(execute: register) }
    }
    @objc(detachFromEngineForRegistrar:) nonisolated public func detachFromEngine(for registrar: FlutterPluginRegistrar) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            KueFlutterRecordingRegistry.remove(messenger: self.messenger, owner: self.owner)
        }
    }
}
