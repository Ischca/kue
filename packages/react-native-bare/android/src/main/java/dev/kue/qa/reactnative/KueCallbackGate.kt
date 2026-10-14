package dev.kue.qa.reactnative

/** One completion wins; teardown can still release a resource delivered after cancellation. */
internal class KueCallbackGate<T>(private val completion: (Result<T>) -> Unit, private val lateSuccess: (T) -> Unit = {}) {
    private var settled = false
    private var lateDelivered = false
    fun resolve(reply: Result<T>) {
        val first = synchronized(this) { if (settled) false else { settled = true; true } }
        if (first) completion(reply) else reply.onSuccess { value ->
            val release = synchronized(this) { if (lateDelivered) false else { lateDelivered = true; true } }
            if (release) lateSuccess(value)
        }
    }
}
