package dev.kue.qa.flutter

/** One completion per channel call. Late successful trigger setup still releases its resource. */
internal class KueBridgeCall<T>(
    private val completion: (Result<T>) -> Unit,
    private val lateSuccess: (T) -> Unit = {},
) {
    private var settled = false
    private var lateReleased = false
    private var succeeded = false
    @Synchronized fun resolve(result: Result<T>): Boolean {
        if (settled) {
            if (!succeeded && result.isSuccess && !lateReleased) { lateReleased = true; lateSuccess(result.getOrThrow()) }
            return false
        }
        settled = true
        succeeded = result.isSuccess
        completion(result)
        return true
    }
}
