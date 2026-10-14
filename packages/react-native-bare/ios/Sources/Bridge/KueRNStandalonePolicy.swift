import Foundation

enum KueRNStandalonePolicy {
    static func requiresForeground(_ action: String) -> Bool {
        !["pendingReports", "discardPendingReport"].contains(action)
    }
}
