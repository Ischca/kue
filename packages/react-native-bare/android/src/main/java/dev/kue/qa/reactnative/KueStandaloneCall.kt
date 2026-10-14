package dev.kue.qa.reactnative

import dev.ischca.kue.KueCancellation

/** Activity lifecycle stops transport; local outbox metadata belongs to the React runtime. */
internal class KueStandaloneCall<T>(action: String, val cancellation: KueCancellation, val done: KueCallbackGate<T>) {
    val requiresForeground = action !in setOf("pendingReports", "discardPendingReport")
    fun background() { if (requiresForeground) cancellation.cancel() }
    fun cancel() = cancellation.cancel()
}
