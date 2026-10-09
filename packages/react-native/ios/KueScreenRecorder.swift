import AVFoundation
import ReplayKit

enum KueRecordingError: LocalizedError {
  case unavailable, busy, cancelled, failed, tooLarge
  var errorDescription: String? {
    switch self {
    case .unavailable: return "Screen recording is unavailable on this device."
    case .busy: return "A screen recording is already in progress."
    case .cancelled: return "Screen recording was cancelled."
    case .failed: return "Could not finish the recording. Try recording again."
    case .tooLarge: return "Recording exceeds 20 MiB. Record a shorter clip."
    }
  }
}

/// Platform-only recorder. No Expo, account, credentials or network dependency.
/// All state is serialized on queue; completion is called once on main.
final class KueScreenRecorder: NSObject, RPScreenRecorderDelegate {
  private let queue = DispatchQueue(label: "dev.kue.recorder")
  private var completion: ((Result<[String: Any], Error>) -> Void)?
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var file: URL?
  private var firstTime: CMTime?
  private var width = 0, height = 0
  private var frames = 0
  private var capturedAt = ""
  private var finishing = false
  private var starting = false
  private var cancelRequested = false
  private var stopRequested = false
  private var limit: DispatchWorkItem?
  private var session: UUID?
  private weak var previousDelegate: RPScreenRecorderDelegate?
  private var previousMicrophone = false
  private var previousCamera = false
  private var ownsRecorder = false

  static var directory: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("kue-recordings", isDirectory: true)
  }
  static func ownedURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL,
      isOwnedDirectory(url.deletingLastPathComponent().standardizedFileURL),
      url.pathExtension == "mp4", FileManager.default.fileExists(atPath: url.path) else { throw KueRecordingError.failed }
    return url
  }
  private static func isOwnedDirectory(_ url: URL) -> Bool {
    if url == directory.standardizedFileURL { return true }
    return url.deletingLastPathComponent() == directory.deletingLastPathComponent().standardizedFileURL &&
      url.lastPathComponent.range(of: "^kue-group-[A-Za-z0-9_-]+$", options: .regularExpression) != nil
  }
  private static func byteSize(_ url: URL) -> Int {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return 0 }
    defer { try? handle.close() }
    return Int((try? handle.seekToEnd()) ?? 0)
  }

  func screenRecorder(_ screenRecorder: RPScreenRecorder, didStopRecordingWith previewViewController: RPPreviewViewController?, error: Error?) {
    stop()
  }
  func screenRecorderDidChangeAvailability(_ screenRecorder: RPScreenRecorder) {
    if !screenRecorder.isAvailable { stop() }
  }

  func record(_ completion: @escaping (Result<[String: Any], Error>) -> Void) {
    queue.async {
      guard self.completion == nil else { DispatchQueue.main.async { completion(.failure(KueRecordingError.busy)) }; return }
      self.completion = completion
      let session = UUID(); self.session = session
      self.starting = true
      self.cancelRequested = false
      self.stopRequested = false
      DispatchQueue.main.async {
        let recorder = RPScreenRecorder.shared()
        guard recorder.isAvailable, !recorder.isRecording else {
          self.queue.async { self.starting = false; self.finish(.failure(KueRecordingError.unavailable)) }; return
        }
        self.previousDelegate = recorder.delegate
        self.previousMicrophone = recorder.isMicrophoneEnabled
        self.previousCamera = recorder.isCameraEnabled
        self.ownsRecorder = true
        recorder.delegate = self
        recorder.isMicrophoneEnabled = false; recorder.isCameraEnabled = false
        recorder.startCapture(handler: { buffer, type, error in
          self.queue.async {
            guard self.session == session, self.completion != nil, !self.finishing else { return }
            if error != nil { self.requestStop(cancel: true); return }
            // App audio and microphone buffers are never written.
            if type == .video { self.append(buffer) }
          }
        }, completionHandler: { error in
          self.queue.async {
            guard self.session == session else { return }
            self.starting = false
            if error != nil { self.finish(.failure(KueRecordingError.unavailable)); return }
            if self.stopRequested { self.requestStop(cancel: self.cancelRequested); return }
            let timer = DispatchWorkItem { self.requestStop(cancel: false) }
            self.limit = timer
            self.queue.asyncAfter(deadline: .now() + 59.5, execute: timer)
          }
        })
      }
    }
  }

  func stop() { queue.async { self.requestStop(cancel: false) } }
  func cancel() { queue.async { self.requestStop(cancel: true) } }

  private func append(_ buffer: CMSampleBuffer) {
    guard CMSampleBufferDataIsReady(buffer), let image = CMSampleBufferGetImageBuffer(buffer) else { return }
    let timestamp = CMSampleBufferGetPresentationTimeStamp(buffer)
    do {
      if writer == nil {
        width = CVPixelBufferGetWidth(image); height = CVPixelBufferGetHeight(image)
        guard width <= 4096, height <= 4096, width * height <= 8_388_608 else { throw KueRecordingError.unavailable }
        try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        let url = Self.directory.appendingPathComponent(UUID().uuidString + ".mp4")
        file = url
        let output = try AVAssetWriter(outputURL: url, fileType: .mp4)
        output.shouldOptimizeForNetworkUse = true
        let track = AVAssetWriterInput(mediaType: .video, outputSettings: [
          AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
          AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_600_000, AVVideoExpectedSourceFrameRateKey: 30,
            AVVideoMaxKeyFrameIntervalKey: 30, AVVideoAllowFrameReorderingKey: false]
        ])
        track.expectsMediaDataInRealTime = true
        guard output.canAdd(track) else { throw KueRecordingError.failed }
        output.add(track); writer = output; input = track
        guard output.startWriting() else { throw KueRecordingError.failed }
        output.startSession(atSourceTime: timestamp); firstTime = timestamp
        capturedAt = ISO8601DateFormatter().string(from: Date())
      }
      guard let firstTime, let input else { return }
      if CMTimeGetSeconds(timestamp - firstTime) >= 59.5 || CVPixelBufferGetWidth(image) != width || CVPixelBufferGetHeight(image) != height {
        requestStop(cancel: false); return
      }
      if input.isReadyForMoreMediaData {
        guard input.append(buffer) else { throw KueRecordingError.failed }
        frames += 1
      }
      if frames % 30 == 0, let file, Self.byteSize(file) >= 18 * 1024 * 1024 {
        requestStop(cancel: false)
      }
    } catch { requestStop(cancel: true) }
  }

  private func requestStop(cancel: Bool) {
    guard completion != nil else { return }
    cancelRequested = cancelRequested || cancel
    stopRequested = true
    if starting || finishing { return }
    finishing = true; limit?.cancel(); limit = nil
    DispatchQueue.main.async {
      RPScreenRecorder.shared().stopCapture { _ in
        self.queue.async {
          guard let writer = self.writer, let input = self.input, self.frames > 0 else {
            self.finish(.failure(self.cancelRequested ? KueRecordingError.cancelled : KueRecordingError.failed)); return
          }
          if self.cancelRequested {
            writer.cancelWriting(); self.finish(.failure(KueRecordingError.cancelled)); return
          }
          input.markAsFinished()
          writer.finishWriting {
            self.queue.async {
              guard !self.cancelRequested, writer.status == .completed, let file = self.file else {
                self.finish(.failure(KueRecordingError.failed)); return
              }
              let asset = AVURLAsset(url: file)
              let duration = CMTimeGetSeconds(asset.duration)
              guard duration.isFinite, duration > 0, duration <= 60 else {
                self.finish(.failure(KueRecordingError.failed)); return
              }
              let durationMs = Int(ceil(duration * 1000))
              let size = Self.byteSize(file)
              guard durationMs > 0, durationMs <= 60_000, size > 0, size <= 20 * 1024 * 1024 else {
                self.finish(.failure(KueRecordingError.tooLarge)); return
              }
              self.finish(.success(["uri": file.absoluteString, "width": self.width, "height": self.height,
                "durationMs": durationMs, "byteSize": size, "mimeType": "video/mp4", "capturedAt": self.capturedAt]))
            }
          }
        }
      }
    }
  }

  private func finish(_ result: Result<[String: Any], Error>) {
    if case .failure = result, let file { try? FileManager.default.removeItem(at: file) }
    let callback = completion
    limit?.cancel(); limit = nil; session = nil; completion = nil; writer = nil; input = nil; file = nil
    firstTime = nil; frames = 0; finishing = false; starting = false
    DispatchQueue.main.async {
      let recorder = RPScreenRecorder.shared()
      if self.ownsRecorder && recorder.delegate === self {
        recorder.delegate = self.previousDelegate
        recorder.isMicrophoneEnabled = self.previousMicrophone
        recorder.isCameraEnabled = self.previousCamera
      }
      self.ownsRecorder = false
      callback?(result)
    }
  }
}
