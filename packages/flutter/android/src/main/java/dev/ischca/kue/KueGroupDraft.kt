package dev.ischca.kue

/** Owns immutable in-session findings. Never sends or persists without explicit user confirmation. */
internal class KueGroupDraft {
    private val items = mutableListOf<KueFinding>()
    var prepared: KueReportGroup? = null
        private set
    val findings get() = items.toList()
    val full get() = items.size >= 10
    val locked get() = prepared != null
    val accepts get() = !full && !locked
    fun add(finding: KueFinding) {
        if (locked) throw KueError("draft_locked")
        if (items.any { it.clientReportId == finding.clientReportId }) return
        if (full || items.sumOf { it.byteSize.toLong() } + finding.byteSize > 20 * 1024 * 1024) throw KueError("draft_full")
        items.add(finding)
    }
    fun remove(id: String) {
        if (locked) throw KueError("draft_locked")
        items.removeAll { it.clientReportId == id }
    }
    fun prepare(title: String): KueReportGroup {
        prepared?.let { return it }
        return try { KueReportGroup(title.trim(), items).also { prepared = it } }
        catch (_: IllegalArgumentException) { throw KueError("invalid_group") }
    }
    fun clear() { items.clear(); prepared = null }
}
