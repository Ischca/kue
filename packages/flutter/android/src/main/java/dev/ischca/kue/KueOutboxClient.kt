package dev.ischca.kue

import android.content.Context
import java.io.File

/** Blocking app-private outbox utilities, usable without installing a reporter. Run on a worker. */
class KueOutboxClient(context: Context, private val config: KueCloudConfig) {
    private val development = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
    private val store = KueOutboxStore(File(context.noBackupFilesDir, "kue-outbox-native-v1"))
    private val destination get() = KueOutboxStore.destination(config, development)

    fun pendingReports(includeOtherDestinations: Boolean = false): List<KuePendingReport> {
        val current = destination
        return store.list().filter { includeOtherDestinations || it.destination == current }.map {
            KuePendingReport(it.report.clientReportId, it.savedAt, if (it.blocked) "blocked" else "pending", it.attempts, it.nextAttemptAt, it.destination == current)
        }
    }
    fun discardPendingReport(id: String) = store.discard(id, destination)

    /** Every attempt checks the caller's foreground guard. No worker or scheduled retries are created. */
    fun retryPendingReports(force: Boolean = false, cancellation: KueCancellation = KueCancellation(),
                            active: () -> Boolean, receipt: (KueReceipt) -> Unit = {}, error: (KueError) -> Unit = {}): Int {
        val current = destination
        var count = 0
        for (candidate in store.list().filter { it.destination == current }) {
            if (cancellation.cancelled || !active()) break
            val entry = store.claimSending(candidate.report.clientReportId, current, force) ?: continue
            try {
                if (cancellation.cancelled || !active()) break
                val accepted = KueCloud.submit(entry.report, config, development, cancellation.request)
                runCatching { store.accepted(entry.report.clientReportId, current) }
                count++
                runCatching { receipt(accepted) }
            } catch (failure: KueError) {
                store.failed(entry, failure)
                runCatching { error(failure) }
            } finally { store.stopSending(entry.report.clientReportId) }
        }
        return count
    }
}
