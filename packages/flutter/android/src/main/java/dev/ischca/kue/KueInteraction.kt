package dev.ischca.kue

import kotlin.math.*

internal const val KUE_TRIGGER_SIZE = 54
internal const val KUE_HOLD_MS = 500L

/** Gesture intent survives a second pointer, a delayed timer and a return to the down point. */
internal class KueTriggerGesture(val startX: Float, val startY: Float, val startedAt: Long, val hasMenu: Boolean, val startEdge: Int? = null) {
    var dragged = false; private set
    var cancelled = false; private set
    fun move(dx: Float, dy: Float, touches: Int, density: Float): Boolean {
        if (touches != 1) cancelled = true
        dragged = dragged || hypot(dx, dy) > 6 * density
        return dragged && !cancelled
    }
    fun cancel() { cancelled = true }
    fun canHold(recording: Boolean) = hasMenu && !recording && !dragged && !cancelled
    fun canTap(now: Long) = !dragged && !cancelled && (!hasMenu || now - startedAt < KUE_HOLD_MS)
}

internal fun kueMenuKinds(saved: Int, hasCloud: Boolean, groupable: Boolean, recordingOff: Boolean, durable: Boolean): List<String> =
    buildList {
        if (saved > 0) add("issue")
        if (hasCloud && groupable && !recordingOff) add("recording")
        if (durable) add("outbox")
    }

internal data class KuePoint(val x: Double, val y: Double)
internal data class KueRect(val x: Double, val y: Double, val width: Double, val height: Double) {
    fun contains(p: KuePoint) = p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height
}
internal data class KueMenuLayout(val origin: KuePoint, val items: List<KuePoint>, val labels: List<KueRect>)

/** Same column/fan placement as the released Expo trigger, in logical pixels. */
internal fun kueMenuLayout(origin: KuePoint, width: Double, height: Double, names: List<String>): KueMenuLayout? {
    if (names.isEmpty() || names.size > 5 || width < 160 || height < 160) return null
    val estimates = names.map { name -> ceil(26 + name.codePoints().toArray().sumOf { if (it in 0x20..0x24f) 8.6 else 14.6 }) }
    fun rect(p: KuePoint, half: Double) = KueRect(p.x - half, p.y - half, half * 2, half * 2)
    fun inside(r: KueRect) = r.x >= 8 && r.y >= 8 && r.x + r.width <= width - 8 && r.y + r.height <= height - 8
    fun overlaps(a: KueRect, b: KueRect, gap: Double) = a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
    fun place(items: List<KuePoint>, sides: List<String>): List<KueRect>? {
        val targets = listOf(rect(origin, KUE_TRIGGER_SIZE / 2.0)) + items.map { rect(it, 22.0) }
        val labels = mutableListOf<KueRect>()
        for ((index, point) in items.withIndex()) {
            val estimate = estimates[index]
            val label = sides.mapNotNull { side ->
                val room = when (side) { "left" -> point.x - 30 - 8; "right" -> width - 8 - point.x - 30; else -> width - 16 }
                val labelWidth = min(estimate, min(floor(width * .6), floor(room)))
                if (labelWidth < min(estimate, 120.0)) null else when (side) {
                    "left" -> KueRect(point.x - 30 - labelWidth, point.y - 15, labelWidth, 30.0)
                    "right" -> KueRect(point.x + 30, point.y - 15, labelWidth, 30.0)
                    else -> KueRect((point.x - labelWidth / 2).coerceIn(8.0, width - 8 - labelWidth), if (side == "above") point.y - 60 else point.y + 30, labelWidth, 30.0)
                }
            }.firstOrNull { inside(it) && targets.none { t -> overlaps(it, t, 2.0) } && labels.none { l -> overlaps(it, l, 4.0) } } ?: return null
            labels.add(label)
        }
        return labels
    }
    fun fit(items: List<KuePoint>, sides: List<String>): KueMenuLayout? {
        if (items.any { !inside(rect(it, 22.0)) }) return null
        return place(items, sides)?.let { KueMenuLayout(origin, items, it) }
    }
    val roomier = if (origin.x > width / 2) "left" else "right"
    val other = if (roomier == "left") "right" else "left"
    val first = KUE_TRIGGER_SIZE / 2.0 + 15 + 22
    val columnX = origin.x.coerceIn(30.0, width - 30)
    for (direction in if (origin.y > height / 2) listOf(-1, 1) else listOf(1, -1)) {
        fit(names.indices.map { KuePoint(columnX, origin.y + direction * (first + it * 56)) }, listOf(roomier))?.let { return it }
    }
    val dx = width / 2 - origin.x; val dy = height / 2 - origin.y
    val preferred = if (hypot(dx, dy) < 40) -PI / 2 else atan2(dy, dx)
    for (tidy in listOf(true, false)) for (radius in listOf(72.0, 82.0, 94.0, 108.0)) {
        val step = if (names.size < 2) 0.0 else 2 * asin(56 / 2 / radius)
        for (turn in 0..90) for (sign in if (turn == 0) listOf(1) else listOf(1, -1)) {
            val heading = preferred + sign * turn * PI / 90
            val items = names.indices.map { val angle = heading + step * (it - (names.size - 1) / 2.0); KuePoint(origin.x + cos(angle) * radius, origin.y + sin(angle) * radius) }
            val outward = if (cos(heading) < -.3) "left" else if (cos(heading) > .3) "right" else roomier
            fit(items, if (tidy) listOf(outward) else listOf(outward, "above", if (outward == roomier) other else roomier, "below"))?.let { return it }
        }
    }
    return null
}

internal fun kueMenuSelection(layout: KueMenuLayout, pointer: KuePoint): Int? {
    if (hypot(pointer.x - layout.origin.x, pointer.y - layout.origin.y) < 38) return null
    layout.items.indexOfFirst { hypot(pointer.x - it.x, pointer.y - it.y) <= 22 }.takeIf { it >= 0 }?.let { return it }
    layout.labels.indexOfFirst { it.contains(pointer) }.takeIf { it >= 0 }?.let { return it }
    return layout.items.indices.filter { hypot(pointer.x - layout.items[it].x, pointer.y - layout.items[it].y) < 30 }
        .minByOrNull { hypot(pointer.x - layout.items[it].x, pointer.y - layout.items[it].y) }
}
