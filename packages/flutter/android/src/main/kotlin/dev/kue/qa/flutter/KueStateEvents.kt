package dev.kue.qa.flutter

/** Prevent a state observer's widget rebuild/update from feeding back the same state forever. */
internal class KueStateEvents {
    private var previous: Map<*, *>? = null
    fun accept(state: Map<*, *>): Boolean {
        if (state == previous) return false
        previous = state.toMap()
        return true
    }
    fun reset() { previous = null }
}
