import Foundation
public struct KueCapturedVideo: Sendable {
    public let file: URL, width: Int, height: Int, durationMs: Int, bytes: Int, capturedAt: Date
    public init(file: URL, width: Int, height: Int, durationMs: Int, bytes: Int, capturedAt: Date) {
        self.file = file; self.width = width; self.height = height; self.durationMs = durationMs
        self.bytes = bytes; self.capturedAt = capturedAt
    }
}
/// Implemented by the optional KueRecorder product. The core product never imports ReplayKit.
@MainActor public protocol KueRecordingProvider: AnyObject {
    var isAvailable: Bool { get }
    func record() async throws -> KueCapturedVideo
    func stop()
    func cancel()
}
@MainActor final class KueNativeRecorder {
    enum Transition { case inactive, background, invalidated }
    var provider: (any KueRecordingProvider)?
    private var ownsRecording = false
    var included: Bool { provider != nil }
    var available: Bool { provider?.isAvailable == true }
    func record() async throws -> KueCapturedVideo {
        guard let provider else { throw KueError(code: .recorderMissing) }
        guard !ownsRecording, provider.isAvailable else { throw KueError(code: .recordingUnavailable) }
        ownsRecording = true; defer { ownsRecording = false }
        return try await provider.record()
    }
    func stop() { if ownsRecording { provider?.stop() } }
    func cancel() { if ownsRecording { provider?.cancel() } }
    func transition(_ transition: Transition) {
        switch transition { case .inactive: break; case .background: stop(); case .invalidated: cancel() }
    }
    func release(_ video: KueCapturedVideo?) {
        guard let video, KueSessionMedia.owns(video.file, directory: "kue-recordings") else { return }
        try? FileManager.default.removeItem(at: video.file)
    }
}

#if canImport(UIKit)
import UIKit
import CoreMotion
/// Own sensor instance and screenshot notification only; never reads the Photos library.
@MainActor final class KueNativeTriggers {
    let motion = CMMotionManager()
    private var screenshotObserver: NSObjectProtocol?
    private var first = -Double.infinity, last = -Double.infinity
    private var high = false
    func start(shake: Bool, screenshot: Bool, open: @escaping @MainActor () -> Void) {
        stop()
        if shake && motion.isAccelerometerAvailable {
            motion.accelerometerUpdateInterval = 0.05
            motion.startAccelerometerUpdates(to: .main) { [weak self] sample, _ in
                guard let self, let sample else { return }
                let a = sample.acceleration; let strength = sqrt(a.x*a.x + a.y*a.y + a.z*a.z)
                guard strength.isFinite else { return }
                if strength < 1.5 { self.high = false; return }
                guard strength >= 2.3, !self.high else { return }; self.high = true
                let now = Date().timeIntervalSince1970
                guard now - self.last >= 2.5 else { return }
                if (0.1...0.9).contains(now - self.first) { self.first = -.infinity; self.last = now; open() }
                else { self.first = now }
            }
        }
        if screenshot {
            screenshotObserver = NotificationCenter.default.addObserver(forName: UIApplication.userDidTakeScreenshotNotification,
                object: nil, queue: .main) { _ in Task { @MainActor in open() } }
        }
    }
    func stop() { motion.stopAccelerometerUpdates(); if let screenshotObserver { NotificationCenter.default.removeObserver(screenshotObserver) }; screenshotObserver = nil }
    deinit { if let screenshotObserver { NotificationCenter.default.removeObserver(screenshotObserver) }; motion.stopAccelerometerUpdates() }
}
#endif
