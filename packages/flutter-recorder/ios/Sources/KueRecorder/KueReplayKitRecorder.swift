#if canImport(UIKit)
import Foundation
import ReplayKit
import kue_qa

/// Optional silent H.264 recording product. Link and inject explicitly to include ReplayKit support.
@MainActor public final class KueReplayKitRecorder: KueRecordingProvider {
    private let core = KueScreenRecorder()
    public init() {}
    public var isAvailable: Bool { RPScreenRecorder.shared().isAvailable && !RPScreenRecorder.shared().isRecording }
    public func record() async throws -> KueCapturedVideo {
        let core = self.core
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                core.record { result in
                    switch result {
                    case .failure(let error): continuation.resume(throwing: error)
                    case .success(let data):
                        guard let uri = data["uri"] as? String, let file = URL(string: uri),
                              let width = data["width"] as? Int, let height = data["height"] as? Int,
                              let duration = data["durationMs"] as? Int, let bytes = data["byteSize"] as? Int,
                              let timestamp = data["capturedAt"] as? String, let date = ISO8601DateFormatter().date(from: timestamp) else {
                            continuation.resume(throwing: KueError(code: .recordingFailed)); return
                        }
                        continuation.resume(returning: KueCapturedVideo(file: file, width: width, height: height,
                            durationMs: duration, bytes: bytes, capturedAt: date))
                    }
                }
                // Cancellation may arrive before record() has enqueued its startup.
                // Queue another cancel after startup registration so it cannot be lost.
                if Task.isCancelled { core.cancel() }
            }
        }, onCancel: { core.cancel() })
    }
    public func stop() { core.stop() }
    public func cancel() { core.cancel() }
}
#endif
