import Foundation

/// Outcomes of one screenshot editor. Group/outbox receipts are independent.
public enum KueReportOutcome: String, Sendable { case submitted, queued, findingAdded, cancelled }

@MainActor final class KueReportFlow {
    private var token: UUID?
    private var capturing = false
    var onCaptureFinished: ((KueError?) -> Void)?
    var onOutcome: ((KueReportOutcome) -> Void)?
    func begin() -> UUID { let value = UUID(); token = value; capturing = true; return value }
    func captured(_ value: UUID, error: KueError? = nil) {
        guard token == value, capturing else { return }
        capturing = false
        if error != nil { token = nil }
        onCaptureFinished?(error)
    }
    func finish(_ value: UUID, outcome: KueReportOutcome) {
        guard token == value else { return }
        let wasCapturing = capturing; token = nil; capturing = false
        if wasCapturing { onCaptureFinished?(nil) }
        onOutcome?(outcome)
    }
    func cancel() { if let token { finish(token, outcome: .cancelled) } }
}
