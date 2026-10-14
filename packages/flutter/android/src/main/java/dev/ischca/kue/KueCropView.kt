package dev.ischca.kue

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Rect
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeProvider
import android.view.accessibility.AccessibilityEvent
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Letterboxed preview with movable selection, four resize handles, and drag-to-select. */
internal class KueCropView(context: Context, private val bitmap: Bitmap, description: String, private val locale: KueLocale = KueLocale.EN) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val imageRect = RectF()
    private val selection = RectF(0f, 0f, 1f, 1f)
    private var origin = RectF(selection)
    private var downX = 0f
    private var downY = 0f
    private var mode = -1
    private var cancelled = false
    private var accessibilityFocus = -1
    private var hovered = -1
    var editable = true
    init { contentDescription = description; minimumHeight = (160 * resources.displayMetrics.density).toInt(); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES }

    fun normalizedCrop(): KueCrop {
        val x = selection.left.toDouble().coerceIn(0.0, 1.0)
        val y = selection.top.toDouble().coerceIn(0.0, 1.0)
        return KueCrop(x, y, (selection.right.toDouble() - x).coerceAtMost(1 - x),
            (selection.bottom.toDouble() - y).coerceAtMost(1 - y))
    }

    fun fullScreen() { selection.set(0f, 0f, 1f, 1f); invalidate() }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val scale = min(width.toFloat() / bitmap.width, height.toFloat() / bitmap.height)
        val left = (width - bitmap.width * scale) / 2
        val top = (height - bitmap.height * scale) / 2
        imageRect.set(left, top, width - left, height - top)
        paint.color = Color.rgb(231, 224, 214)
        canvas.drawColor(paint.color)
        canvas.drawBitmap(bitmap, null, imageRect, paint)
        val crop = pixelRect()
        paint.color = Color.argb(135, 0, 0, 0)
        canvas.drawRect(imageRect.left, imageRect.top, imageRect.right, crop.top, paint)
        canvas.drawRect(imageRect.left, crop.bottom, imageRect.right, imageRect.bottom, paint)
        canvas.drawRect(imageRect.left, crop.top, crop.left, crop.bottom, paint)
        canvas.drawRect(crop.right, crop.top, imageRect.right, crop.bottom, paint)
        paint.color = Color.rgb(194, 99, 47)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3 * resources.displayMetrics.density
        canvas.drawRect(crop, paint)
        paint.style = Paint.Style.FILL
        corners(crop).forEach { (x, y) -> canvas.drawCircle(x, y, 6 * resources.displayMetrics.density, paint) }
    }

    private fun pixelRect() = RectF(imageRect.left + selection.left * imageRect.width(),
        imageRect.top + selection.top * imageRect.height(), imageRect.left + selection.right * imageRect.width(),
        imageRect.top + selection.bottom * imageRect.height())
    private fun corners(rect: RectF) = listOf(rect.left to rect.top, rect.right to rect.top,
        rect.right to rect.bottom, rect.left to rect.bottom)

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!editable || imageRect.isEmpty) return false
        val x = ((event.x - imageRect.left) / imageRect.width()).coerceIn(0f, 1f)
        val y = ((event.y - imageRect.top) / imageRect.height()).coerceIn(0f, 1f)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (!imageRect.contains(event.x, event.y)) return false
                parent.requestDisallowInterceptTouchEvent(true)
                downX = x; downY = y; origin = RectF(selection)
                cancelled = false
                val hit = 24 * resources.displayMetrics.density
                mode = corners(pixelRect()).indexOfFirst { (cx, cy) -> abs(cx - event.x) <= hit && abs(cy - event.y) <= hit }
                if (mode == -1) mode = if (selection.contains(x, y)) 4 else 5
                if (mode == 5) {
                    val left = x.coerceAtMost(.88f); val top = y.coerceAtMost(.88f)
                    selection.set(left, top, left + .12f, top + .12f)
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount != 1) cancelled = true
                if (cancelled) return true
                val minimum = .12f
                when (mode) {
                    0 -> { selection.left = x.coerceAtMost(origin.right - minimum); selection.top = y.coerceAtMost(origin.bottom - minimum) }
                    1 -> { selection.right = x.coerceAtLeast(origin.left + minimum); selection.top = y.coerceAtMost(origin.bottom - minimum) }
                    2 -> { selection.right = x.coerceAtLeast(origin.left + minimum); selection.bottom = y.coerceAtLeast(origin.top + minimum) }
                    3 -> { selection.left = x.coerceAtMost(origin.right - minimum); selection.bottom = y.coerceAtLeast(origin.top + minimum) }
                    4 -> {
                        val dx = (x - downX).coerceIn(-origin.left, 1 - origin.right)
                        val dy = (y - downY).coerceIn(-origin.top, 1 - origin.bottom)
                        selection.set(origin.left + dx, origin.top + dy, origin.right + dx, origin.bottom + dy)
                    }
                    5 -> {
                        val left = min(x, downX).coerceAtMost(1 - minimum)
                        val top = min(y, downY).coerceAtMost(1 - minimum)
                        selection.set(left, top, max(x, downX).coerceAtLeast(left + minimum), max(y, downY).coerceAtLeast(top + minimum))
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_POINTER_DOWN -> { cancelled = true; selection.set(origin); invalidate(); return true }
            MotionEvent.ACTION_POINTER_UP -> return true
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (cancelled || event.actionMasked == MotionEvent.ACTION_CANCEL) { selection.set(origin); invalidate() }
                parent.requestDisallowInterceptTouchEvent(false); mode = -1
                if (!cancelled && event.actionMasked == MotionEvent.ACTION_UP) performClick()
                return true
            }
        }
        return false
    }
    override fun performClick(): Boolean { super.performClick(); return true }

    private fun label(ja: String, en: String) = if (locale == KueLocale.JA) ja else en
    private fun handleLabel(index: Int) = if (locale == KueLocale.JA) listOf("左上の角", "右上の角", "右下の角", "左下の角")[index]
        else listOf("Top-left corner", "Top-right corner", "Bottom-right corner", "Bottom-left corner")[index]
    private fun handleBounds(index: Int): Rect {
        val (x, y) = corners(pixelRect())[index]; val half = 15 * resources.displayMetrics.density
        return Rect((x - half).toInt(), (y - half).toInt(), (x + half).toInt(), (y + half).toInt()).apply { intersect(0, 0, width, height) }
    }
    private fun announce(index: Int, type: Int) {
        val event = AccessibilityEvent.obtain(type)
        event.setSource(this, index); event.packageName = context.packageName; event.className = android.widget.SeekBar::class.java.name
        event.contentDescription = handleLabel(index); parent?.requestSendAccessibilityEvent(this, event)
    }
    override fun getAccessibilityNodeProvider() = object : AccessibilityNodeProvider() {
        override fun createAccessibilityNodeInfo(id: Int): AccessibilityNodeInfo? {
            if (id == HOST_VIEW_ID) return AccessibilityNodeInfo.obtain(this@KueCropView).also { info ->
                onInitializeAccessibilityNodeInfo(info); (0..3).forEach { info.addChild(this@KueCropView, it) }
            }
            if (id !in 0..3) return null
            return AccessibilityNodeInfo.obtain().apply {
                setSource(this@KueCropView, id); setParent(this@KueCropView); packageName = context.packageName
                className = android.widget.SeekBar::class.java.name; contentDescription = handleLabel(id)
                text = label("幅 ${(selection.width() * 100).roundToInt()}%、高さ ${(selection.height() * 100).roundToInt()}%", "${(selection.width() * 100).roundToInt()}% wide, ${(selection.height() * 100).roundToInt()}% tall")
                hintText = label("操作で撮影範囲を広げる・狭めることができます。", "Use actions to expand or shrink the crop.")
                isEnabled = editable; isFocusable = true; isScrollable = editable; isAccessibilityFocused = accessibilityFocus == id
                val rect = handleBounds(id); setBoundsInParent(rect)
                val offset = IntArray(2); getLocationOnScreen(offset); rect.offset(offset[0], offset[1]); setBoundsInScreen(rect)
                isVisibleToUser = isShown && !imageRect.isEmpty
                addAction(if (accessibilityFocus == id) AccessibilityNodeInfo.AccessibilityAction.ACTION_CLEAR_ACCESSIBILITY_FOCUS else AccessibilityNodeInfo.AccessibilityAction.ACTION_ACCESSIBILITY_FOCUS)
                if (editable) {
                    addAction(AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD, label("範囲を広げる", "Expand the crop")))
                    addAction(AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD, label("範囲を狭める", "Shrink the crop")))
                }
            }
        }
        override fun findAccessibilityNodeInfosByText(text: String, id: Int): List<AccessibilityNodeInfo> {
            val query = text.lowercase(java.util.Locale.ROOT)
            val candidates = if (id == HOST_VIEW_ID) (0..3).toList() else if (id in 0..3) listOf(id) else emptyList()
            return candidates.mapNotNull { createAccessibilityNodeInfo(it) }.filter {
                it.contentDescription?.toString()?.lowercase(java.util.Locale.ROOT)?.contains(query) == true ||
                    it.text?.toString()?.lowercase(java.util.Locale.ROOT)?.contains(query) == true
            }
        }
        override fun findFocus(focus: Int) = if (focus == AccessibilityNodeInfo.FOCUS_ACCESSIBILITY && accessibilityFocus >= 0) createAccessibilityNodeInfo(accessibilityFocus) else null
        override fun performAction(id: Int, action: Int, args: Bundle?): Boolean {
            if (id == HOST_VIEW_ID) return this@KueCropView.performAccessibilityAction(action, args)
            if (id !in 0..3) return false
            when (action) {
                AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS -> {
                    if (accessibilityFocus == id) return false
                    if (accessibilityFocus >= 0) announce(accessibilityFocus, AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED)
                    accessibilityFocus = id; announce(id, AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED); return true
                }
                AccessibilityNodeInfo.ACTION_CLEAR_ACCESSIBILITY_FOCUS -> {
                    if (accessibilityFocus != id) return false
                    accessibilityFocus = -1; announce(id, AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED); return true
                }
                AccessibilityNodeInfo.ACTION_SCROLL_FORWARD, AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> {
                    if (!editable) return false
                    val amount = if (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) .04f else -.04f
                    if (id == 0 || id == 3) selection.left = (selection.left - amount).coerceIn(0f, selection.right - .12f)
                    else selection.right = (selection.right + amount).coerceIn(selection.left + .12f, 1f)
                    if (id == 0 || id == 1) selection.top = (selection.top - amount).coerceIn(0f, selection.bottom - .12f)
                    else selection.bottom = (selection.bottom + amount).coerceIn(selection.top + .12f, 1f)
                    invalidate(); announce(id, AccessibilityEvent.TYPE_VIEW_SELECTED); return true
                }
            }
            return false
        }
    }
    override fun dispatchHoverEvent(event: MotionEvent): Boolean {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
        if (!manager.isTouchExplorationEnabled || imageRect.isEmpty) return super.dispatchHoverEvent(event)
        val next = if (event.actionMasked == MotionEvent.ACTION_HOVER_EXIT) -1 else (0..3).firstOrNull { handleBounds(it).contains(event.x.toInt(), event.y.toInt()) } ?: -1
        if (next != hovered) {
            if (next >= 0) announce(next, AccessibilityEvent.TYPE_VIEW_HOVER_ENTER)
            if (hovered >= 0) announce(hovered, AccessibilityEvent.TYPE_VIEW_HOVER_EXIT)
            hovered = next
        }
        return next >= 0 || event.actionMasked == MotionEvent.ACTION_HOVER_EXIT
    }
}
