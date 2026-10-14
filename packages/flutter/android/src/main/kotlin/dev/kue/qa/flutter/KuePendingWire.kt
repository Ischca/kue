package dev.kue.qa.flutter

import dev.ischca.kue.KuePendingReport

private const val DART_DATE_MAX_MILLISECONDS = 8_640_000_000_000_000L

/** Display dates fit Dart DateTime; the native outbox retains its complete retry deadline. */
internal fun kuePendingDto(value: KuePendingReport): Map<String, Any?> {
    fun displayDate(milliseconds: Long) = milliseconds.coerceIn(
        -DART_DATE_MAX_MILLISECONDS, DART_DATE_MAX_MILLISECONDS)
    return mapOf("clientReportId" to value.clientReportId, "savedAt" to displayDate(value.savedAt),
        "state" to value.state, "attempts" to value.attempts, "nextAttemptAt" to displayDate(value.nextAttemptAt),
        "currentDestination" to value.currentDestination)
}
