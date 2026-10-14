import Foundation
import KueBare

@MainActor @objc(KueRNRecorderBridge) public final class KueRNRecorderBridge: NSObject {
    private let engine: String, owner = UUID().uuidString
    private var alive = true
    @objc public init(engine: String) { self.engine = engine; super.init() }
    @objc public func install(_ session: String) -> String {
        guard alive else { return failure("request_cancelled") }
        do {
            try KueRNRecordingRegistry.install(engine: engine, session: session, owner: owner) { KueReplayKitRecorder() }
            return "{\"schemaVersion\":1,\"ok\":true,\"value\":null}"
        } catch { return failure("invalid_config") }
    }
    @objc public func remove(_ session: String) -> String {
        KueRNRecordingRegistry.remove(engine: engine, session: session, owner: owner)
        return "{\"schemaVersion\":1,\"ok\":true,\"value\":null}"
    }
    @objc public func invalidate() {
        guard alive else { return }; alive = false; KueRNRecordingRegistry.invalidate(engine: engine, owner: owner)
    }
    private func failure(_ code: String) -> String { "{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"\(code)\",\"retryable\":false}}" }
}
