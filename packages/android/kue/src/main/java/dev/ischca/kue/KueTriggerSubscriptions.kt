package dev.ischca.kue

/** Serial UI dispatch owns subscriptions; settlement itself may come from any setup thread. */
internal class KueTriggerSubscriptions(
    private val dispatch: (() -> Unit) -> Unit,
    private val open: () -> Unit,
    private val onError: (KueError) -> Unit,
) {
    private var epoch = 0
    private var active = false
    private val cleanups = mutableListOf<() -> Unit>()

    fun start(sources: List<KueTriggerSource>, asyncSources: List<KueAsyncTriggerSource>) {
        stop()
        active = true
        val generation = ++epoch
        val guardedOpen = { dispatch { if (active && epoch == generation) open() }; Unit }
        sources.forEach { source ->
            if (!active || epoch != generation) return@forEach
            accept(generation, runCatching { source.subscribe(guardedOpen) })
        }
        asyncSources.forEach { source ->
            if (!active || epoch != generation) return@forEach
            val settlement = Any()
            var settled = false
            val delivered = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<() -> Unit, Boolean>())
            val complete: (Result<() -> Unit>) -> Unit = { result ->
                val (first, newCleanup) = synchronized(settlement) {
                    val first = !settled; settled = true
                    val cleanup = result.getOrNull()
                    first to cleanup?.takeIf { delivered.add(it) }
                }
                if (first) dispatch { accept(generation, result) }
                else newCleanup?.let { cleanup -> dispatch { release(cleanup) } }
            }
            runCatching { source.subscribe(guardedOpen, complete) }
                .onFailure { complete(Result.failure(KueError("trigger_setup_failed"))) }
        }
    }

    fun stop() {
        active = false; epoch++
        val owned = cleanups.toList(); cleanups.clear()
        owned.forEach(::release)
    }

    private fun accept(generation: Int, result: Result<() -> Unit>) {
        result.fold(onSuccess = { cleanup ->
            if (active && epoch == generation) cleanups.add(cleanup) else release(cleanup)
        }, onFailure = {
            if (active && epoch == generation) report("trigger_setup_failed")
        })
    }

    private fun release(cleanup: () -> Unit) {
        // Teardown is best-effort, including a late setup settling after another mount/detach.
        // An old cleanup failure must not notify or disrupt a current SDK session.
        runCatching { cleanup() }
    }

    private fun report(code: String) { runCatching { onError(KueError(code)) } }
}
