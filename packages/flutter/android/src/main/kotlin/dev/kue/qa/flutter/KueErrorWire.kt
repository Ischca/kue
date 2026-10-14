package dev.kue.qa.flutter

import dev.ischca.kue.KueError

/** Dart's Duration stores microseconds; retain only interoperable, nonnegative millisecond delays. */
internal fun kueErrorDto(value: KueError): Map<String, Any?> {
    val delay = value.retryAfterMs
    val safe = delay == null || delay in 0..9_007_199_254_740_991L
    return mapOf("code" to value.code, "retryable" to (value.retryable && safe),
        "status" to value.status, "serverCode" to value.serverCode,
        "retryAfterMs" to delay?.takeIf { safe })
}
