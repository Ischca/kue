package dev.ischca.kue

import android.app.Activity
import android.app.Application
import android.app.Dialog
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.view.Gravity
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import android.widget.ScrollView
import android.widget.VideoView
import android.widget.MediaController
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Install once per Activity, after setContent()/setContentView(). All controller calls use the main thread. */
object Kue {
    fun install(activity: Activity, config: KueConfig): KueController = KueController(activity, config)
}

class KueController internal constructor(private val activity: Activity, private val config: KueConfig) {
    private companion object { val activePreviewPaths = java.util.concurrent.ConcurrentHashMap.newKeySet<String>() }
    private val ink = Color.rgb(43, 30, 22)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "KueReport").apply { isDaemon = true } }
    private val development = activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    private var enabled = config.enabled ?: development
    private val overlay = FrameLayout(activity)
    private val trigger = FrameLayout(activity)
    private val triggerIcon = ImageView(activity).apply { setImageResource(R.drawable.kue_viewfinder); scaleType = ImageView.ScaleType.FIT_CENTER }
    private val triggerMascot = ImageView(activity).apply {
        setImageResource(R.drawable.kue_mascot); scaleType = ImageView.ScaleType.FIT_CENTER
    }
    private val triggerBadge = TextView(activity).apply {
        id = R.id.kue_trigger_badge
        gravity = Gravity.CENTER; setTextColor(Color.WHITE); textSize = 12f
        typeface = android.graphics.Typeface.DEFAULT_BOLD; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        background = rounded(Color.rgb(219, 39, 119), dp(10))
    }
    private var triggerGesture: KueTriggerGesture? = null
    private var holdTask: Runnable? = null
    private var dialog: Dialog? = null
    private var capture: Bitmap? = null
    private var prepared: KueReport? = null
    private val requests = java.util.concurrent.ConcurrentHashMap.newKeySet<KueCloud.Request>()
    private var busy = false
    @Volatile private var disposed = false
    @Volatile private var foreground = true
    private var session = 0
    private var captureEpoch = 0
    private var capturing = false
    private var reportOutcomePending = false
    private var lastState: KueControllerState? = null
    private var locale = config.locale ?: preferredLocale()
    private var design = config.buttonDesign
    private var submissionLabel = config.submitLabel
    private var groupSubmissionLabel = config.groupSubmitLabel
    private var contextDefaults = config.context
    private var lastAttemptAt = 0L
    private var retryAfterMs = 0L
    private val draft = KueGroupDraft()
    private val outbox = KueOutboxStore(File(activity.noBackupFilesDir, "kue-outbox-native-v1"))
    private var flushing = false
    private var recorder = config.recorder ?: optionalKueRecorder()
    private var recordingMode = config.recording
    private var recordingEpoch = 0
    private var recordingPreparing = false
    private var recordingHandle: KueRecordingHandle? = null
    private var recordingActive = false
    private var recordingStopping = false
    private var pendingVideo: Pair<KueRecordedVideo, KueContext>? = null
    private var previewDialog: Dialog? = null
    private var reviewedVideo: KueRecordedVideo? = null
    private var activePlayer: VideoView? = null
    private val flushTick = object : Runnable { override fun run() { if (!disposed && foreground) { autoFlush(); main.postDelayed(this, 60000) } } }
    private var features: KueProjectFeatures? = null
    private var featureFailed = false
    private var docked = false
    private var dockEdge: Int? = null
    private var heldMenu: FrameLayout? = null
    private data class MenuAction(val kind: String, val label: String, val id: Int, val run: () -> Unit)
    private var heldActions = emptyList<MenuAction>()
    private var heldLayout: KueMenuLayout? = null
    private var heldViews = emptyList<Pair<View, View>>()
    private var floatingVisible = config.floatingButton
    private var shakeEnabled = config.shakeTrigger
    private var screenshotEnabled = config.systemScreenshotTrigger
    private var triggersActive = false
    private val subscriptions = KueTriggerSubscriptions(
        dispatch = { task -> main.post(task) }, open = { reportIssue() },
        onError = { error -> if (!disposed) runCatching { config.onError?.invoke(error) } },
    )
    private val lifecycle = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityStopped(value: Activity) { if (value === activity) {
            foreground = false; requests.forEach { it.cancel() }; syncTriggers()
            if (capturing) {
                captureEpoch++; capturing = false; busy = false; overlay.visibility = View.VISIBLE
                runCatching { config.onError?.invoke(KueError("request_cancelled", retryable = true)) }
                finishReportOutcome(KueReportOutcome.CANCELLED)
            }
            main.removeCallbacks(flushTick)
            cancelTriggerGesture()
            closeHeld()
            activePlayer?.pause()
            if (recordingActive) stopRecording()
        } }
        override fun onActivityDestroyed(value: Activity) { if (value === activity) uninstall() }
        override fun onActivityCreated(value: Activity, state: Bundle?) = Unit
        override fun onActivityStarted(value: Activity) { if (value === activity) foreground = true }
        override fun onActivityResumed(value: Activity) { if (value === activity) {
            foreground = true; syncTriggers(); autoFlush(); main.removeCallbacks(flushTick); main.postDelayed(flushTick, 60000)
            pendingVideo?.let { pendingVideo = null; openRecordingReview(it.first, it.second) }
        } }
        override fun onActivityPaused(value: Activity) = Unit
        override fun onActivitySaveInstanceState(value: Activity, state: Bundle) = Unit
    }

    init {
        mainThread()
        config.cloud?.endpoint(development)
        runCatching { recorder?.cleanupOrphans(activity) }
        activity.cacheDir.listFiles().orEmpty().filter { it.name.matches(Regex("^kue-preview-[A-Fa-f0-9-]{36}\\.mp4$")) && it.absolutePath !in activePreviewPaths }.forEach { it.delete() }
        if (enabled) {
            activity.application.registerActivityLifecycleCallbacks(lifecycle)
            (activity.findViewById<View>(android.R.id.content) as ViewGroup).addView(overlay,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            val params = FrameLayout.LayoutParams(dp(KUE_TRIGGER_SIZE), dp(KUE_TRIGGER_SIZE), Gravity.BOTTOM or Gravity.END)
            params.setMargins(dp(16), dp(16), dp(16), dp(12))
            overlay.addView(trigger, params)
            overlay.setOnApplyWindowInsetsListener { _, insets -> updateSafeBounds(); insets }
            overlay.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updateSafeBounds() }
            trigger.addView(triggerIcon, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
            trigger.addView(triggerMascot, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            trigger.addView(triggerBadge, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.TOP or Gravity.END))
            trigger.tag = "kue-trigger"
            trigger.id = R.id.kue_trigger
            trigger.elevation = dp(6).toFloat()
            renderTrigger()
            var downX = 0f; var downY = 0f; var longPress = false
            trigger.setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        cancelTriggerGesture()
                        downX = event.rawX; downY = event.rawY; longPress = false
                        val gesture = KueTriggerGesture(trigger.x, trigger.y, event.eventTime, menuActions().isNotEmpty() && !recordingActive, dockEdge)
                        triggerGesture = gesture; trigger.alpha = .7f
                        if (gesture.hasMenu) {
                            val task = Runnable { if (triggerGesture === gesture && gesture.canHold(recordingActive) && foreground && !disposed) {
                                longPress = true; trigger.alpha = 1f; showHeldMenu()
                            } }
                            holdTask = task; main.postDelayed(task, KUE_HOLD_MS)
                        }
                        true
                    }
                    MotionEvent.ACTION_POINTER_DOWN -> { triggerGesture?.cancel(); clearHold(); closeHeld(); trigger.alpha = 1f; true }
                    MotionEvent.ACTION_POINTER_UP -> true
                    MotionEvent.ACTION_MOVE -> {
                        val gesture = triggerGesture ?: return@setOnTouchListener true
                        val dx = event.rawX - downX; val dy = event.rawY - downY
                        val moving = gesture.move(dx, dy, event.pointerCount, activity.resources.displayMetrics.density)
                        if (gesture.dragged || gesture.cancelled) { clearHold(); trigger.alpha = 1f }
                        if (gesture.cancelled) { closeHeld(); return@setOnTouchListener true }
                        if (longPress) { highlightHeld(event.rawX, event.rawY); return@setOnTouchListener true }
                        if (!moving) return@setOnTouchListener true
                        docked = false
                        dockEdge = null
                        moveTrigger(gesture.startX + dx, gesture.startY + dy)
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        clearHold(); trigger.alpha = 1f
                        val gesture = triggerGesture; triggerGesture = null
                        if (gesture == null || disposed || !foreground) { closeHeld(); return@setOnTouchListener true }
                        if (longPress && !gesture.cancelled) { releaseHeld(event.rawX, event.rawY); return@setOnTouchListener true }
                        if (!gesture.cancelled && !longPress) {
                            if (gesture.dragged && !recordingActive) dockTrigger() else if (gesture.canTap(event.eventTime)) {
                                if (docked && !recordingActive) revealTrigger() else trigger.performClick()
                            }
                        }
                        if (gesture.cancelled) restoreTriggerGesture(gesture)
                        closeHeld()
                        true
                    }
                    MotionEvent.ACTION_CANCEL -> { cancelTriggerGesture(); closeHeld(); true }
                    else -> false
                }
            }
            trigger.setOnClickListener { if (recordingActive) stopRecording() else reportIssue() }
            trigger.accessibilityDelegate = moveAccessibility()
            trigger.visibility = if (floatingVisible) View.VISIBLE else View.GONE
            syncTriggers()
            autoFlush()
        }
    }

    fun setLocale(value: KueLocale) { mainThread(); locale = value; renderTrigger(); heldMenu?.let { menu -> val actions = menuActions(); if (populateHeld(menu, actions)) heldActions = actions else { triggerGesture?.cancel(); closeHeld() } } }
    fun setButtonDesign(value: KueButtonDesign) { mainThread(); design = value; renderTrigger() }
    fun setSubmitLabel(value: String) { mainThread(); require(value.isNotBlank()); submissionLabel = value }
    fun setGroupSubmitLabel(value: String) { mainThread(); require(value.isNotBlank()); groupSubmissionLabel = value }
    fun setRecordingMode(value: KueRecordingMode) {
        mainThread()
        if (disposed || recordingMode == value) return
        recordingMode = value
        if (value == KueRecordingMode.OFF) {
            recordingEpoch++
            val hadRecording = recordingPreparing || recordingHandle != null || recordingActive
            recordingPreparing = false
            runCatching { recordingHandle?.stop(true) }; recordingHandle = null; recordingActive = false; recordingStopping = false
            pendingVideo?.first?.let { recorder?.release(it) }; pendingVideo = null
            if (reviewedVideo != null) {
                activePlayer?.stopPlayback(); activePlayer = null
                reviewedVideo?.let { recorder?.release(it) }; reviewedVideo = null
                dialog?.dismiss(); dialog = null
            }
            if (hadRecording) busy = false
            trigger.visibility = if (floatingVisible) View.VISIBLE else View.GONE
            dialog?.findViewById<View>(R.id.kue_menu_recording)?.visibility = View.GONE
            closeHeld(); renderTrigger(); syncTriggers()
        } else {
            features = null; featureFailed = false; emitState()
            dialog?.findViewById<Button>(R.id.kue_menu_recording)?.apply { visibility = View.VISIBLE; text = recordingLabel() }
            if (config.cloud != null && enabled && foreground) refreshProjectFeatures {
                dialog?.findViewById<Button>(R.id.kue_menu_recording)?.text = menuRecordingLabel(); emitState()
            }
        }
    }
    fun setContext(value: KueContextOverrides) { mainThread(); contextDefaults = value }
    fun setFloatingButtonVisible(value: Boolean) { mainThread(); floatingVisible = value; if (!value) { cancelTriggerGesture(); closeHeld() }; trigger.visibility = if (value || recordingActive) View.VISIBLE else View.GONE }
    fun setShakeTriggerEnabled(value: Boolean) { mainThread(); if (shakeEnabled == value) return; shakeEnabled = value; resetTriggers() }
    fun setSystemScreenshotTriggerEnabled(value: Boolean) { mainThread(); if (screenshotEnabled == value) return; screenshotEnabled = value; resetTriggers() }
    val savedFindings: List<KueFinding> get() = draft.findings
    val state: KueControllerState get() { mainThread(); return KueControllerState(enabled && !disposed, foreground && !disposed,
        dialog != null && !disposed, capturing && !disposed, recordingActive && !disposed, !disposed && (busy || flushing), draft.findings.size, recordingAvailability(), draft.locked, draft.full) }

    private fun emitState() {
        if (disposed) return
        val current = state
        if (current != lastState) { lastState = current; runCatching { config.onStateChanged?.invoke(current) } }
    }
    private fun finishReportOutcome(outcome: KueReportOutcome, error: KueError? = null) {
        if (!reportOutcomePending) return
        reportOutcomePending = false
        if (!disposed) { emitState(); runCatching { config.onReportOutcome?.invoke(outcome, error) } }
    }

    /** Returns false when disabled, disposed, already open, or the Activity is unavailable. */
    fun reportIssue(memo: String = "", context: KueContextOverrides = KueContextOverrides()): Boolean {
        mainThread()
        if (!enabled || disposed || !foreground || busy || dialog != null || activity.isFinishing || activity.isDestroyed) return false
        if (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
            notifyError(KueError("capture_protected")); return false
        }
        busy = true; capturing = true; reportOutcomePending = true
        syncTriggers()
        overlay.visibility = View.INVISIBLE
        val current = ++session
        val epoch = ++captureEpoch
        // Give the window two frames to remove the trigger before copying its pixels.
        activity.window.decorView.postOnAnimation { activity.window.decorView.postOnAnimation {
            if (current != session || disposed || epoch != captureEpoch || !foreground || activity.isFinishing || activity.isDestroyed) return@postOnAnimation
            if (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
                captureFailed(KueError("capture_protected")); return@postOnAnimation
            }
            val adapter = config.captureImage ?: config.capture?.let { legacy ->
                { owner: Activity, completion: (Result<KueCapturedImage>) -> Unit ->
                    legacy(owner) { result -> completion(result.map { KueCapturedImage(it, Instant.now().toString()) }) }
                }
            }
            if (adapter != null) {
                val once = AtomicBoolean(false)
                try { adapter(activity) { result ->
                    if (once.compareAndSet(false, true)) main.post {
                        if (disposed || current != session || epoch != captureEpoch || !foreground) { result.getOrNull()?.bitmap?.let { if (!it.isRecycled) it.recycle() }; return@post }
                        capturing = false
                        result.fold(onSuccess = { captured ->
                            val bitmap = captured.bitmap
                            if (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
                                if (!bitmap.isRecycled) bitmap.recycle(); captureFailed(KueError("capture_protected"))
                            } else if (bitmap.isRecycled || bitmap.width.toLong() * bitmap.height > 16_000_000) {
                                if (!bitmap.isRecycled) bitmap.recycle(); captureFailed(KueError("capture_unavailable"))
                            } else { busy = false; overlay.visibility = View.VISIBLE; capture = bitmap
                                openEditor(bitmap, memo, captured.capturedAt, context, captured.context) }
                        }, onFailure = { captureFailed(KueError("capture_unavailable")) })
                    }
                } } catch (_: Exception) { if (once.compareAndSet(false, true)) captureFailed(KueError("capture_unavailable")) }
                return@postOnAnimation
            }
            val decor = activity.window.decorView
            val width = decor.width; val height = decor.height
            if (width <= 0 || height <= 0 || width.toLong() * height > 16_000_000) {
                captureFailed(KueError("capture_unavailable")); return@postOnAnimation
            }
            val bitmap = try { Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888) }
            catch (_: OutOfMemoryError) { captureFailed(KueError("capture_unavailable")); return@postOnAnimation }
            try {
                PixelCopy.request(activity.window, Rect(0, 0, width, height), bitmap, { result ->
                    if (current != session || disposed || epoch != captureEpoch || !foreground) { bitmap.recycle(); return@request }
                    busy = false; capturing = false
                    overlay.visibility = View.VISIBLE
                    if (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
                        bitmap.recycle(); captureFailed(KueError("capture_protected"))
                    } else if (result == PixelCopy.SUCCESS) {
                        capture = bitmap
                        openEditor(bitmap, memo, Instant.now().toString(), context)
                    } else { bitmap.recycle(); captureFailed(KueError("capture_unavailable")) }
                }, main)
            } catch (_: Exception) { bitmap.recycle(); captureFailed(KueError("capture_unavailable")) }
        } }
        return true
    }

    /** Cancels the active request, discards the in-memory draft, removes the overlay, and detaches lifecycle callbacks. */
    fun uninstall() {
        mainThread()
        if (disposed) return
        cancelTriggerGesture()
        disposed = true; session++; reportOutcomePending = false
        runCatching { recordingHandle?.stop(true) }; draft.clear(); syncTriggers()
        closeHeld()
        pendingVideo?.first?.let { recorder?.release(it) }; pendingVideo = null; main.removeCallbacks(flushTick)
        reviewedVideo?.let { recorder?.release(it) }; reviewedVideo = null
        activePlayer?.stopPlayback(); activePlayer = null
        previewDialog?.dismiss(); previewDialog = null
        requests.forEach { it.cancel() }
        dialog?.dismiss(); dialog = null
        val bitmap = capture; capture = null; prepared = null
        if (bitmap != null) worker.execute { if (!bitmap.isRecycled) bitmap.recycle() }
        (overlay.parent as? ViewGroup)?.removeView(overlay)
        activity.application.unregisterActivityLifecycleCallbacks(lifecycle)
        worker.shutdown()
    }

    private fun captureFailed(error: KueError) { busy = false; capturing = false; overlay.visibility = View.VISIBLE; syncTriggers(); notifyError(error); finishReportOutcome(KueReportOutcome.FAILED, error) }
    private fun cloudRequest(): KueCloud.Request = KueCloud.Request().also {
        requests.add(it)
        if (!foreground || disposed) it.cancel()
    }
    private fun notifyError(error: KueError) {
        if (disposed) return
        runCatching { config.onError?.invoke(error) }
        Toast.makeText(activity, text("画面を取得できません。", "Could not capture this screen."), Toast.LENGTH_SHORT).show()
    }

    private fun openEditor(bitmap: Bitmap, initialMemo: String, capturedAt: String, contextOverrides: KueContextOverrides,
                           captureContext: KueContextOverrides = KueContextOverrides()) {
        val current = session
        val editor = Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar)
        val ui = editor.context
        val root = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
            setBackgroundColor(Color.rgb(250, 247, 242)); fitsSystemWindows = true
        }
        val header = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(ui).apply {
            text = text("範囲を選択", "Select a region"); textSize = 22f; setTextColor(ink)
        }, LinearLayout.LayoutParams(0, dp(50), 1f))
        val cancel = Button(ui).apply { text = text("キャンセル", "Cancel"); tag = "kue-cancel"; id = R.id.kue_cancel }
        header.addView(cancel)
        root.addView(header)
        root.addView(TextView(ui).apply { text = text("枠を移動・四隅をドラッグして調整します。", "Move the region or drag its corners to resize."); setPadding(0, dp(4), 0, dp(10)) })
        val cropView = KueCropView(ui, bitmap, text("キャプチャ範囲", "Capture region"), locale)
        cropView.id = R.id.kue_crop_editor
        root.addView(cropView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val full = Button(ui).apply { id = R.id.kue_full_screen; text = text("画面全体を選択", "Select full screen"); setOnClickListener { cropView.fullScreen() } }
        root.addView(full)
        val memo = EditText(ui).apply {
            hint = text("メモ（必須）", "Memo (required)"); tag = "kue-memo-input"; id = R.id.kue_memo_input; contentDescription = hint
            setText(initialMemo); gravity = Gravity.TOP; setLines(3)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
            filters = arrayOf(InputFilter.LengthFilter(4096))
        }
        root.addView(memo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(98)))
        val status = TextView(ui).apply { id = R.id.kue_editor_status; setTextColor(Color.rgb(156, 47, 28)); textSize = 13f; setPadding(0, dp(6), 0, dp(6)) }
        root.addView(status)
        val edit = Button(ui).apply { text = text("レポートを編集", "Edit report"); id = R.id.kue_edit_report; visibility = View.GONE }
        root.addView(edit)
        val send = Button(ui).apply {
            text = if (draft.findings.isNotEmpty() && draft.accepts) "${groupLabel()} (${draft.findings.size + 1})" else singleLabel()
            isAllCaps = false
            tag = "kue-send"; id = R.id.kue_send; setTextColor(Color.WHITE); background = rounded(Color.rgb(194, 99, 47), dp(10))
        }
        root.addView(send, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))
        val add = Button(ui).apply { text = text("指摘を追加", "Add finding"); id = R.id.kue_add_finding; isEnabled = groupable() && draft.accepts }
        if (groupable()) root.addView(add)
        val saved = Button(ui).apply { id = R.id.kue_editor_saved; text = text("保存した指摘を開く (${draft.findings.size})", "Open saved findings (${draft.findings.size})") }
        if (draft.findings.isNotEmpty()) root.addView(saved)
        if (!draft.accepts) status.text = text("保存済みの指摘は送信中の内容を保持、または上限に達しています。今回は単独で送信します。", "Saved findings are locked or full. This capture submits on its own.")
        fun updateBusy(value: Boolean) {
            busy = value; send.isEnabled = !value; cancel.isEnabled = !value; memo.isEnabled = !value && prepared == null
            full.isEnabled = !value && prepared == null; cropView.editable = !value && prepared == null
            add.isEnabled = !value && prepared == null && draft.accepts
            saved.isEnabled = !value
            edit.isEnabled = !value
            editor.setCancelable(!value)
            emitState()
        }
        edit.setOnClickListener {
            if (busy || prepared == null) return@setOnClickListener
            prepared = null; retryAfterMs = 0; lastAttemptAt = 0; edit.visibility = View.GONE
            updateBusy(false)
            send.text = if (draft.findings.isNotEmpty() && draft.accepts) "${groupLabel()} (${draft.findings.size + 1})" else singleLabel()
            cancel.text = text("キャンセル", "Cancel")
            status.text = text("編集後は新しい送信IDになります。以前の送信が受け付け済みの可能性があります。保存済みの未送信レポートは別途管理します。", "Editing creates a new report ID. An earlier request may already be accepted. Stored pending reports remain separate.")
        }
        fun discard() {
            if (busy) return
            session++; prepared = null; dialog = null
            editor.dismiss(); capture = null; bitmap.recycle()
            syncTriggers(); finishReportOutcome(KueReportOutcome.CANCELLED); autoFlush()
        }
        cancel.setOnClickListener { discard() }
        editor.setOnCancelListener { discard() }
        fun failure(error: KueError) {
            if (disposed || current != session) return
            retryAfterMs = error.retryAfterMs ?: 0
            status.text = errorText(error)
            runCatching { config.onError?.invoke(error) }
            updateBusy(false)
            send.text = text("同じ内容で再試行", "Retry same report")
            send.isEnabled = error.retryable
            cancel.text = text("破棄", "Discard")
            edit.visibility = if (prepared != null) View.VISIBLE else View.GONE
        }
        fun complete(outcome: KueReportOutcome = KueReportOutcome.SUBMITTED) {
            if (disposed || current != session) return
            busy = false; prepared = null; dialog = null
            editor.dismiss(); capture = null; bitmap.recycle()
            syncTriggers()
            finishReportOutcome(outcome)
        }
        fun submit(report: KueReport) {
            if (!foreground) { failure(KueError("request_cancelled", retryable = true)); return }
            lastAttemptAt = android.os.SystemClock.elapsedRealtime()
            val cloud = config.cloud
            if (cloud != null && config.onSubmit == null) {
                val active = cloudRequest()
                worker.execute {
                    val result = runCatching {
                        val destination = KueOutboxStore.destination(cloud, development)
                        val entry = if (config.offlineQueue) {
                            outbox.save(report, destination)
                            outbox.claimSending(report.clientReportId, destination, true) ?: throw KueError("outbox_sending", retryable = true)
                        } else null
                        try {
                            KueCloud.submit(report, cloud, development, active).also {
                                if (entry != null) runCatching { outbox.accepted(report.clientReportId, entry.destination) }
                            }
                        } catch (error: KueError) {
                            if (entry != null) {
                                outbox.failed(entry, error)
                                if (error.retryable) return@runCatching null
                            }
                            throw error
                        } finally { if (entry != null) outbox.stopSending(report.clientReportId) }
                    }
                    requests.remove(active)
                    main.post {
                        if (current != session || disposed) return@post
                        result.fold(onSuccess = { receipt -> complete(if (receipt == null) KueReportOutcome.QUEUED else KueReportOutcome.SUBMITTED); if (receipt != null) runCatching { config.onReceipt?.invoke(receipt) }
                            else runCatching { config.onQueued?.invoke(report.clientReportId) } },
                            onFailure = { failure(it as? KueError ?: KueError("network_error", retryable = true)) })
                    }
                }
            } else {
                val once = AtomicBoolean(false)
                try {
                    config.onSubmit!!.invoke(report) { result ->
                        if (once.compareAndSet(false, true)) main.post {
                            result.fold(onSuccess = { complete() }, onFailure = { failure(it as? KueError ?: KueError("local_save_failed", retryable = true)) })
                        }
                    }
                } catch (_: Exception) { if (once.compareAndSet(false, true)) failure(KueError("local_save_failed", retryable = true)) }
            }
        }
        var action = "single"
        fun begin() {
            if (android.os.SystemClock.elapsedRealtime() - lastAttemptAt < retryAfterMs) {
                status.text = text("少し待ってから再試行してください。", "Wait before retrying."); return
            }
            val saved = prepared
            if (saved != null) { updateBusy(true); status.text = ""; submit(saved); return }
            val value = memo.text.toString().trim()
            if (value.isBlank() || value.contains('\u0000') || value.toByteArray(Charsets.UTF_8).size > 4096) {
                status.text = text("メモを1〜4096バイトで入力してください。", "Enter a memo of 1–4096 UTF-8 bytes."); return
            }
            updateBusy(true); status.text = text("準備中…", "Preparing…")
            val crop = cropView.normalizedCrop()
            val context = try { reportContext(contextOverrides, captureContext) } catch (_: Exception) { failure(KueError("invalid_report")); return }
            worker.execute {
                val result = runCatching { prepare(bitmap, crop, value, context, capturedAt) }
                main.post {
                    if (current != session || disposed) return@post
                    result.fold(onSuccess = {
                        prepared = it; status.text = ""
                        if (action == "add" || (draft.findings.isNotEmpty() && draft.accepts)) {
                            try { draft.add(it); complete(KueReportOutcome.FINDING_ADDED); draftChanged(); if (action != "add") openSavedFindings() }
                            catch (error: KueError) { failure(error) }
                        } else submit(it)
                    },
                        onFailure = { failure(KueError("capture_preparation_failed")) })
                }
            }
        }
        send.setOnClickListener { action = "single"; begin() }
        add.setOnClickListener { action = "add"; begin() }
        saved.setOnClickListener { editor.hide(); dialog = null; openSavedFindings(editor) }
        editor.setContentView(root)
        editor.setOnShowListener {
            if (prepared == null) {
                send.text = if (draft.findings.isNotEmpty() && draft.accepts) "${groupLabel()} (${draft.findings.size + 1})" else singleLabel()
                add.isEnabled = !busy && groupable() && draft.accepts
                saved.text = text("保存した指摘を開く (${draft.findings.size})", "Open saved findings (${draft.findings.size})")
                saved.isEnabled = !busy && draft.findings.isNotEmpty()
            }
        }
        editor.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        editor.show()
        styleSystemBars(editor)
        editor.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog = editor
        syncTriggers()
    }

    private fun prepare(bitmap: Bitmap, crop: KueCrop, memo: String, context: KueContext, capturedAt: String): KueReport {
        val x = (crop.x * bitmap.width).toInt().coerceIn(0, bitmap.width - 1)
        val y = (crop.y * bitmap.height).toInt().coerceIn(0, bitmap.height - 1)
        val width = max(1, kotlin.math.ceil((crop.x + crop.width) * bitmap.width).toInt() - x).coerceAtMost(bitmap.width - x)
        val height = max(1, kotlin.math.ceil((crop.y + crop.height) * bitmap.height).toInt() - y).coerceAtMost(bitmap.height - y)
        val cropped = Bitmap.createBitmap(bitmap, x, y, width, height)
        val scale = min(1.0, 2048.0 / max(width, height))
        val output = if (scale < 1) Bitmap.createScaledBitmap(cropped, max(1, (width * scale).toInt()), max(1, (height * scale).toInt()), true) else cropped
        try {
            val stream = ByteArrayOutputStream()
            check(output.compress(Bitmap.CompressFormat.JPEG, 90, stream))
            val actualCrop = KueCrop(x.toDouble() / bitmap.width, y.toDouble() / bitmap.height,
                min(width.toDouble() / bitmap.width, 1 - x.toDouble() / bitmap.width), min(height.toDouble() / bitmap.height, 1 - y.toDouble() / bitmap.height))
            return KueReport(UUID.randomUUID().toString(), memo, actualCrop, KueSize(bitmap.width, bitmap.height),
                KueSize(output.width, output.height), context, capturedAt, stream.toByteArray())
        } finally {
            if (output !== bitmap && output !== cropped) output.recycle()
            if (cropped !== bitmap) cropped.recycle()
        }
    }

    @Suppress("DEPRECATION")
    private fun reportContext(overrides: KueContextOverrides = KueContextOverrides(),
                              captureContext: KueContextOverrides = KueContextOverrides()): KueContext {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        val build = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toString() else info.versionCode.toString()
        val installed = contextDefaults.withFallback(KueContextOverrides(route = config.route))
        val resolved = overrides.withFallback(installed).withFallback(captureContext)
        val density = activity.resources.displayMetrics.density.toDouble()
        val display = android.util.DisplayMetrics().also { activity.windowManager.defaultDisplay.getRealMetrics(it) }
        val screen = if (Build.VERSION.SDK_INT >= 30) activity.windowManager.maximumWindowMetrics.bounds else Rect(0, 0, display.widthPixels, display.heightPixels)
        return KueContext(resolved.osVersion ?: Build.VERSION.RELEASE,
            resolved.deviceModel ?: Build.MODEL, resolved.appVersion ?: info.versionName,
            resolved.buildNumber ?: build, resolved.screenWidth ?: screen.width() / density,
            resolved.screenHeight ?: screen.height() / density, resolved.route ?: config.route)
    }

    private fun groupable() = config.onSubmitGroup != null || (config.cloud != null && config.onSubmit == null)
    private fun singleLabel() = if (config.onSubmit != null) submissionLabel!! else text("Issueを作る", "Create Issue")
    private fun groupLabel() = if (config.onSubmitGroup != null) (groupSubmissionLabel ?: submissionLabel)!! else text("Issueを作る", "Create Issue")
    private fun draftChanged() { renderTrigger(); emitState(); runCatching { config.onDraftChanged?.invoke(draft.findings) } }

    fun recordingAvailability(): KueRecordingAvailability {
        if (recordingMode == KueRecordingMode.OFF) return KueRecordingAvailability.OFF
        if (config.cloud == null || !groupable()) return KueRecordingAvailability.CLOUD_REQUIRED
        if (featureFailed) return KueRecordingAvailability.CHECK_FAILED
        val value = features ?: return if (featureFailed) KueRecordingAvailability.CHECK_FAILED else KueRecordingAvailability.CHECKING
        if (!value.recordingEntitled) return KueRecordingAvailability.UPGRADE
        if (!value.recordingAvailable) return KueRecordingAvailability.UNAVAILABLE
        return if (recorder == null) KueRecordingAvailability.REBUILD else KueRecordingAvailability.READY
    }

    fun refreshProjectFeatures(completion: (Result<KueProjectFeatures>) -> Unit) {
        mainThread()
        val cloud = config.cloud
        if (cloud == null || !enabled || disposed || !foreground) { completion(Result.failure(KueError("invalid_config"))); return }
        worker.execute {
            val active = cloudRequest()
            val result = if (foreground && !disposed) runCatching { KueCloud.features(cloud, development, active) }
                else Result.failure(KueError("request_cancelled", retryable = true))
            requests.remove(active)
            main.post {
                if (disposed) return@post
                result.onSuccess { features = it; featureFailed = false }.onFailure { featureFailed = true }
                emitState()
                runCatching { completion(result) }
            }
        }
    }

    fun readReportStatus(receipt: KueReceipt, completion: (Result<KueReportStatus>) -> Unit) {
        mainThread()
        val cloud = config.cloud
        if (cloud == null || !enabled || disposed || !foreground) { completion(Result.failure(KueError("invalid_config"))); return }
        worker.execute {
            val active = cloudRequest()
            val result = if (foreground && !disposed) runCatching { KueCloud.status(receipt, cloud, development, active) }
                else Result.failure(KueError("request_cancelled", retryable = true))
            requests.remove(active)
            main.post { if (!disposed) runCatching { completion(result) } }
        }
    }

    /** Long-press menu. Capture still starts immediately on the normal floating-button tap. */
    fun openActions(): Boolean {
        mainThread()
        if (!enabled || disposed || !foreground || busy || dialog != null || recordingHandle != null) return false
        val actions = menuActions()
        if (actions.isEmpty()) return false
        val (menu, root) = panel("KUE")
        var record: Button? = null
        actions.forEach { item ->
            val button = action(root, item.label, item.id) { closePanel(menu); item.run() }.apply { isAllCaps = false }
            if (item.kind == "recording") record = button
        }
        action(root, text("閉じる", "Close"), R.id.kue_menu_close) { closePanel(menu) }
        showPanel(menu)
        if (record != null) refreshProjectFeatures { if (dialog === menu) record?.text = menuRecordingLabel() }
        return true
    }

    fun openSavedFindings(): Boolean = openSavedFindings(null)
    private fun openSavedFindings(previous: Dialog?): Boolean {
        mainThread()
        if (!enabled || disposed || !foreground || busy || dialog != null) return false
        val (review, root) = panel(text("保存した指摘", "Saved findings"))
        val title = EditText(root.context).apply {
            id = R.id.kue_group_title; hint = text("Issueタイトル（必須・200文字まで）", "Issue title (required, up to 200 characters)")
            isSingleLine = true; setText(draft.prepared?.title ?: defaultTitle(draft.findings.firstOrNull()?.memo.orEmpty())); isEnabled = !draft.locked
        }
        root.addView(title)
        val note = TextView(root.context).apply { text = text("確認して送信するまで、保存済みの指摘は送信しません。", "Saved findings are sent only after explicit confirmation."); setPadding(0, dp(8), 0, dp(8)) }
        root.addView(note)
        if (draft.locked) note.text = text("同じ送信ID・画像・動画・タイトルを保持しています。編集せずに再試行します。", "The same ID, media and title are retained for retry.")
        val list = LinearLayout(root.context).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        val error = TextView(root.context).apply { setTextColor(Color.rgb(156, 47, 28)) }; root.addView(error)
        var confirmation: Button? = null
        fun refresh() {
            list.removeAllViews()
            draft.findings.forEachIndexed { index, finding ->
                list.addView(TextView(root.context).apply { text = "${index + 1}. ${finding.memo}"; textSize = 16f; setPadding(0, dp(12), 0, dp(6)) })
                if (finding is KueVideoFinding) action(list, text("動画を再生 (${finding.durationMs / 1000.0}秒)", "Play recording (${finding.durationMs / 1000.0}s)"), R.id.kue_group_video) { previewVideo(finding, review) }
                else list.addView(ImageView(root.context).apply {
                    val bytes = finding.mediaBytes; setImageBitmap(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)); scaleType = ImageView.ScaleType.FIT_CENTER
                    contentDescription = text("指摘 ${index + 1} の画像", "Finding ${index + 1} image")
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(150)))
                action(list, text("削除", "Remove"), R.id.kue_group_remove) { runCatching { draft.remove(finding.clientReportId) }.onFailure { error.text = text("送信内容は変更できません。", "The prepared group cannot be changed.") }; draftChanged(); refresh() }
                    .isEnabled = !draft.locked
            }
            if (!draft.locked) confirmation?.apply { text = "${groupLabel()} (${draft.findings.size})"; isEnabled = draft.findings.isNotEmpty() && groupable() }
        }
        refresh()
        var retryAt = 0L
        val send = action(root, "${groupLabel()} (${draft.findings.size})", R.id.kue_group_confirm) {}
        send.isAllCaps = false
        confirmation = send
        var back: Button? = null
        var discardAll: Button? = null
        fun finishPanel() {
            closePanel(review)
            if (previous != null && !disposed) { previous.show(); dialog = previous; syncTriggers() }
        }
        send.setOnClickListener {
            if (busy || android.os.SystemClock.elapsedRealtime() < retryAt) return@setOnClickListener
            val group = try { draft.prepare(title.text.toString()) } catch (e: KueError) { error.text = text("指摘と1〜200文字のタイトルが必要です。", "Add findings and a title of 1–200 characters."); return@setOnClickListener }
            busy = true; send.isEnabled = false; title.isEnabled = false; back?.isEnabled = false; discardAll?.isEnabled = false; review.setCancelable(false); syncTriggers(); refresh()
            fun complete(result: Result<KueReceipt?>) {
                if (disposed) return
                busy = false; review.setCancelable(true); back?.isEnabled = true; discardAll?.isEnabled = true
                result.fold(onSuccess = { receipt -> draft.clear(); draftChanged(); finishPanel(); if (receipt != null) runCatching { config.onReceipt?.invoke(receipt) } },
                    onFailure = { cause ->
                        val failure = cause as? KueError ?: KueError("local_save_failed", retryable = true)
                        val clock = android.os.SystemClock.elapsedRealtime()
                        retryAt = clock + (failure.retryAfterMs ?: 0).coerceIn(0, Long.MAX_VALUE - clock)
                        error.text = errorText(failure); send.isEnabled = failure.retryable; send.text = text("同じ内容で再試行", "Retry same group")
                        runCatching { config.onError?.invoke(failure) }
                    })
            }
            val local = config.onSubmitGroup
            if (local != null) {
                val once = AtomicBoolean(false)
                try { local(group) { result -> if (once.compareAndSet(false, true)) main.post { complete(result.map { null }) } } }
                catch (_: Exception) { if (once.compareAndSet(false, true)) complete(Result.failure(KueError("local_save_failed", retryable = true))) }
            } else {
                val cloud = config.cloud
                if (cloud == null || config.onSubmit != null) { complete(Result.failure(KueError("group_destination_missing"))); return@setOnClickListener }
                worker.execute {
                    val active = cloudRequest()
                    val result = if (foreground) runCatching { KueCloud.submitGroup(group, cloud, development, active) } else Result.failure(KueError("request_cancelled", retryable = true))
                    requests.remove(active)
                    main.post { complete(result) }
                }
            }
        }
        send.isEnabled = draft.findings.isNotEmpty() && groupable()
        back = action(root, text("戻る", "Back"), R.id.kue_group_back) { if (!busy) finishPanel() }
        discardAll = action(root, text("すべて破棄", "Discard all"), R.id.kue_group_discard) {
            if (!busy) AlertDialog.Builder(android.view.ContextThemeWrapper(activity, android.R.style.Theme_Material_Light_Dialog_Alert)).setMessage(text("保存した指摘をすべて破棄しますか？タイムアウト後は送信先が受け付けている可能性があります。", "Discard all saved findings? After a timeout the destination may already have accepted them."))
                .setNegativeButton(text("戻る", "Keep"), null).setPositiveButton(text("破棄", "Discard")) { _, _ -> draft.clear(); draftChanged(); finishPanel() }.show()
        }
        showPanel(review)
        review.setOnCancelListener { finishPanel() }
        return true
    }

    fun recordScreen(): Boolean {
        mainThread()
        if (!enabled || disposed || !foreground || busy || dialog != null || recordingHandle != null) return false
        if (recordingMode == KueRecordingMode.OFF || config.cloud == null || !groupable()) { recordingFailure(KueError("recording_cloud_required")); return false }
        if (!draft.accepts) return openSavedFindings()
        busy = true; recordingPreparing = true; val epoch = ++recordingEpoch; syncTriggers()
        refreshProjectFeatures { result ->
            if (epoch != recordingEpoch || recordingMode == KueRecordingMode.OFF || !recordingPreparing) return@refreshProjectFeatures
            recordingPreparing = false
            busy = false
            if (!foreground || disposed) { syncTriggers(); return@refreshProjectFeatures }
            if (result.isFailure || recordingAvailability() != KueRecordingAvailability.READY) {
                runCatching { config.onError?.invoke(KueError("recording_${recordingAvailability().name.lowercase()}")) }
                showInfo(recordingLabel()); syncTriggers(); return@refreshProjectFeatures
            }
            val provider = recorder ?: return@refreshProjectFeatures
            val context = try { reportContext() }
            catch (_: Exception) { notifyError(KueError("invalid_report")); syncTriggers(); return@refreshProjectFeatures }
            busy = true; syncTriggers()
            try {
                recordingHandle = provider.start(activity, locale, onStarted = {
                    if (epoch != recordingEpoch || recordingMode == KueRecordingMode.OFF || disposed) return@start
                    recordingActive = true; trigger.visibility = View.VISIBLE; overlay.visibility = View.VISIBLE; revealTrigger(); renderTrigger()
                    emitState()
                    main.postDelayed({ if (!disposed && recordingActive && !foreground) recordingHandle?.stop(false) }, 500)
                }, completion = { video ->
                    main.post {
                        if (epoch != recordingEpoch || recordingMode == KueRecordingMode.OFF) { video.getOrNull()?.let { provider.release(it) }; return@post }
                        recordingHandle = null; recordingActive = false; recordingStopping = false; busy = false; renderTrigger()
                        if (disposed) { video.getOrNull()?.let { provider.release(it) }; return@post }
                        video.fold(onSuccess = { openRecordingReview(it, context) }, onFailure = {
                            recordingFailure(it as? KueError ?: KueError("recording_failed")); syncTriggers()
                        })
                    }
                })
            } catch (error: Exception) {
                busy = false; recordingHandle = null; recordingActive = false; recordingStopping = false; renderTrigger(); syncTriggers()
                recordingFailure(error as? KueError ?: KueError("recording_unavailable"))
            }
        }
        return true
    }

    fun stopRecording() {
        mainThread(); if (recordingStopping) return
        recordingStopping = recordingActive; renderTrigger()
        try { recordingHandle?.stop(false) }
        catch (error: Exception) {
            recordingStopping = false; renderTrigger()
            recordingFailure(error as? KueError ?: KueError("recording_stop_failed", retryable = true))
        }
    }

    private fun recordingFailure(error: KueError) {
        if (disposed) return
        val handler = config.onError
        if (handler != null) runCatching { handler.invoke(error) }
        else if (foreground && dialog == null) showInfo(when (error.code) {
            "recording_cloud_required" -> recordingLabel()
            "recording_unavailable" -> text("録画を開始できませんでした。もう一度お試しください。", "Could not start recording. Try again.")
            "recording_stop_failed" -> text("録画を停止できませんでした。もう一度停止してください。", "Could not stop recording. Try stopping again.")
            "recording_cancelled" -> text("録画をキャンセルしました。", "Recording was cancelled.")
            else -> text("録画を完了できませんでした。もう一度お試しください。", "Could not finish recording. Try again.")
        })
    }

    private fun openRecordingReview(video: KueRecordedVideo, context: KueContext) {
        if (!foreground) { pendingVideo = video to context; return }
        val (review, root) = panel(text("録画を確認", "Review recording"))
        reviewedVideo = video
        root.addView(TextView(root.context).apply { text = text("${video.durationMs / 1000.0}秒 · 音声なし · メモを追加して保存します。", "${video.durationMs / 1000.0}s · Silent · Add a memo to save.") })
        val player = VideoView(root.context).apply { setVideoPath(video.file.absolutePath) }
        activePlayer = player
        player.setMediaController(MediaController(root.context).apply { setAnchorView(player) })
        root.addView(player, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)))
        action(root, text("再生", "Play"), R.id.kue_video_play) { player.start() }
        val memo = EditText(root.context).apply { hint = text("メモ（必須）", "Memo (required)"); id = R.id.kue_video_memo; setLines(3) }; root.addView(memo)
        val error = TextView(root.context); root.addView(error)
        action(root, text("指摘を追加", "Add finding"), R.id.kue_video_save) {
            val value = memo.text.toString().trim()
            if (value.isEmpty() || value.contains('\u0000') || value.toByteArray(Charsets.UTF_8).size > 4096) { error.text = text("メモを1〜4096バイトで入力してください。", "Enter a memo of 1–4096 UTF-8 bytes."); return@action }
            try {
                if (video.file.length() !in 1..20L * 1024 * 1024) throw KueError("invalid_video")
                draft.add(KueVideoFinding(memo = value, outputSize = video.size, context = context, capturedAt = video.capturedAt, durationMs = video.durationMs, videoBytes = video.file.readBytes()))
                player.stopPlayback(); activePlayer = null; reviewedVideo = null; recorder?.release(video); draftChanged(); closePanel(review)
            } catch (_: Exception) { error.text = text("保存できません。指摘は10件・合計20MiBまでです。", "Could not save. Maximum 10 findings and 20MiB total.") }
        }
        action(root, text("破棄", "Discard"), R.id.kue_video_discard) { player.stopPlayback(); activePlayer = null; reviewedVideo = null; recorder?.release(video); closePanel(review) }
        showPanel(review)
        review.setOnCancelListener { player.stopPlayback(); activePlayer = null; reviewedVideo = null; recorder?.release(video); closePanel(review) }
    }

    private fun previewVideo(finding: KueVideoFinding, previous: Dialog) {
        val file = File(activity.cacheDir, "kue-preview-${UUID.randomUUID()}.mp4")
        activePreviewPaths.add(file.absolutePath)
        file.writeBytes(finding.mediaBytes)
        val preview = Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar)
        previewDialog = preview
        val root = LinearLayout(preview.context).apply { orientation = LinearLayout.VERTICAL }
        val player = VideoView(preview.context).apply { setVideoPath(file.absolutePath); setOnPreparedListener { start() } }
        activePlayer = player
        root.addView(player, LinearLayout.LayoutParams(dp(300), dp(400)))
        action(root, text("閉じる", "Close"), R.id.kue_preview_close) { preview.dismiss() }
        preview.setContentView(root); preview.setOnDismissListener {
            player.stopPlayback(); file.delete(); activePreviewPaths.remove(file.absolutePath)
            if (activePlayer === player) activePlayer = null
            if (previewDialog === preview) previewDialog = null
        }; preview.show(); styleSystemBars(preview)
    }

    fun pendingReports(includeOtherDestinations: Boolean = false, completion: (Result<List<KuePendingReport>>) -> Unit) {
        mainThread()
        val cloud = config.cloud
        worker.execute {
            val result = runCatching {
                val destination = cloud?.let { KueOutboxStore.destination(it, development) }
                outbox.list().filter { includeOtherDestinations || it.destination == destination }.map {
                    KuePendingReport(it.report.clientReportId, it.savedAt, if (it.blocked) "blocked" else "pending", it.attempts, it.nextAttemptAt, it.destination == destination)
                }
            }
            main.post { if (!disposed) runCatching { completion(result) } }
        }
    }

    fun discardPendingReport(id: String, includeOtherDestinations: Boolean = false, completion: (Result<Unit>) -> Unit = {}) {
        mainThread()
        if (!includeOtherDestinations && config.cloud == null) { completion(Result.failure(KueError("outbox_unavailable"))); return }
        worker.execute {
            val result = runCatching { outbox.discard(id, if (includeOtherDestinations) null else config.cloud?.let { KueOutboxStore.destination(it, development) }) }
            main.post { if (!disposed) runCatching { completion(result) } }
        }
    }

    fun retryPendingReports(force: Boolean = false, completion: (Result<Int>) -> Unit = {}) {
        mainThread()
        val cloud = config.cloud
        if (!enabled || disposed || !foreground || busy || recordingHandle != null || cloud == null || config.onSubmit != null || flushing) { completion(Result.failure(KueError("outbox_unavailable"))); return }
        flushing = true; syncTriggers()
        worker.execute {
            val result = runCatching {
                var count = 0
                val destination = KueOutboxStore.destination(cloud, development)
                for (candidate in outbox.list().filter { it.destination == destination }) {
                    if (disposed || !foreground) break
                    if (!force && (busy || dialog != null || heldMenu != null || recordingHandle != null)) break
                    val entry = outbox.claimSending(candidate.report.clientReportId, destination, force) ?: continue
                    val active = cloudRequest()
                    try {
                        val receipt = KueCloud.submit(entry.report, cloud, development, active)
                        runCatching { outbox.accepted(entry.report.clientReportId, destination) }
                        count++; main.post { if (!disposed) runCatching { config.onReceipt?.invoke(receipt) } }
                    } catch (error: KueError) {
                        outbox.failed(entry, error); main.post { if (!disposed) runCatching { config.onError?.invoke(error) } }
                    } finally { outbox.stopSending(entry.report.clientReportId); requests.remove(active) }
                }
                count
            }
            main.post { flushing = false; syncTriggers(); if (!disposed) runCatching { completion(result) } }
        }
    }

    private fun autoFlush() {
        if (config.offlineQueue && !disposed && enabled && foreground && !busy && dialog == null && !flushing && config.cloud != null && config.onSubmit == null) retryPendingReports()
    }

    fun openOutbox(): Boolean {
        mainThread()
        if (!enabled || disposed || !foreground || busy || dialog != null || config.cloud == null) return false
        val (view, root) = panel(text("未送信レポート", "Pending reports"))
        root.addView(TextView(root.context).apply { text = text("10件・50MiB・7日間。送信先が変わったレポートは再送せず、破棄できます。", "10 reports · 50MiB · 7 days. Reports for another destination may be discarded, never retargeted.") })
        val list = LinearLayout(root.context).apply { orientation = LinearLayout.VERTICAL }; root.addView(list)
        val status = TextView(root.context); root.addView(status)
        fun refresh() { pendingReports(true) { result -> result.fold(onSuccess = { entries ->
            list.removeAllViews()
            if (entries.isEmpty()) list.addView(TextView(root.context).apply { text = text("未送信レポートはありません。", "No pending reports.") })
            entries.forEach { entry ->
                val date = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT,
                    if (locale == KueLocale.JA) java.util.Locale.JAPAN else java.util.Locale.US).format(java.util.Date(entry.savedAt))
                val state = if (!entry.currentDestination) text("別の送信先", "Other destination") else if (entry.state == "blocked") text("送信停止", "Blocked") else text("未送信", "Pending")
                list.addView(TextView(root.context).apply { text = "$date · $state · ${entry.attempts}" })
                list.addView(TextView(root.context).apply { text = entry.clientReportId; setTextIsSelectable(true) })
                action(list, text("破棄", "Discard"), R.id.kue_outbox_discard) {
                    if (!flushing) AlertDialog.Builder(android.view.ContextThemeWrapper(activity, android.R.style.Theme_Material_Light_Dialog_Alert)).setMessage(text("端末からこの未送信レポートを破棄しますか？", "Discard this pending report from the device?"))
                        .setNegativeButton(text("戻る", "Keep"), null).setPositiveButton(text("破棄", "Discard")) { _, _ -> discardPendingReport(entry.clientReportId, true) { refresh() } }.show()
                }.isEnabled = !flushing
            }
        }, onFailure = { status.text = text("未送信レポートを読み取れません。", "Could not read pending reports.") }) } }
        lateinit var retry: Button
        retry = action(root, text("今すぐ再試行", "Retry now"), R.id.kue_outbox_retry) {
            retry.isEnabled = false
            for (index in 0 until list.childCount) (list.getChildAt(index) as? Button)?.isEnabled = false
            retryPendingReports(true) {
                retry.isEnabled = true
                status.text = it.fold({ count -> text("${count}件受け付けました。", "$count reports accepted.") }, { text("再試行できません。", "Could not retry.") })
                refresh()
            }
        }
        action(root, text("閉じる", "Close"), R.id.kue_outbox_close) { closePanel(view) }
        showPanel(view); refresh(); return true
    }

    private fun panel(title: String): Pair<Dialog, LinearLayout> {
        val dialog = Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar)
        val root = LinearLayout(dialog.context).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)); setBackgroundColor(Color.rgb(250, 247, 242)); fitsSystemWindows = true }
        root.addView(TextView(dialog.context).apply { text = title; textSize = 22f; setTextColor(ink); setPadding(0, 0, 0, dp(12)) })
        val scroll = ScrollView(dialog.context).apply { addView(root) }; dialog.setContentView(scroll)
        return dialog to root
    }
    private fun action(root: LinearLayout, label: String, identifier: Int = View.NO_ID, onClick: () -> Unit): Button {
        return Button(root.context).apply { text = label; id = identifier; minHeight = dp(52); setOnClickListener { onClick() }; root.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
    }
    private fun showPanel(panel: Dialog) {
        dialog = panel; panel.setOnCancelListener { closePanel(panel) }; panel.show()
        styleSystemBars(panel)
        panel.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT); syncTriggers()
    }
    private fun closePanel(panel: Dialog) { panel.dismiss(); if (dialog === panel) dialog = null; syncTriggers() }
    @Suppress("DEPRECATION")
    private fun styleSystemBars(panel: Dialog) {
        val window = panel.window ?: return
        window.statusBarColor = Color.rgb(250, 247, 242)
        window.navigationBarColor = Color.rgb(250, 247, 242)
        if (Build.VERSION.SDK_INT >= 30) {
            val flags = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(flags, flags)
        } else window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }
    private fun defaultTitle(memo: String): String { val line = memo.lineSequence().firstOrNull { it.isNotBlank() }?.trim().orEmpty(); return String(line.codePoints().limit(200).toArray(), 0, line.codePointCount(0, line.length).coerceAtMost(200)) }
    private fun recordingLabel(): String = when (recordingAvailability()) {
        KueRecordingAvailability.READY -> text("画面録画", "Screen recording")
        KueRecordingAvailability.UPGRADE -> text("🔒 画面録画 · Indie", "🔒 Screen recording · Indie")
        KueRecordingAvailability.CHECKING -> text("録画の利用条件を確認中…", "Checking recording access…")
        KueRecordingAvailability.CHECK_FAILED -> text("録画を確認できません · 再確認", "Could not verify recording · Retry check")
        KueRecordingAvailability.UNAVAILABLE -> text("録画はこのCloudで利用できません", "Recording is unavailable on this Cloud")
        KueRecordingAvailability.REBUILD -> text("録画モジュールを追加して再ビルドしてください", "Add the recorder module and rebuild")
        KueRecordingAvailability.CLOUD_REQUIRED -> text("録画にはCloud接続とグループ送信先が必要です", "Recording requires Cloud and a group destination")
        KueRecordingAvailability.OFF -> text("録画は無効です", "Recording is off")
    }
    private fun selectRecording() {
        when (recordingAvailability()) {
            KueRecordingAvailability.READY -> recordScreen()
            KueRecordingAvailability.CHECK_FAILED -> refreshProjectFeatures { result ->
                if (result.isSuccess) selectRecording() else showInfo(recordingLabel())
            }
            KueRecordingAvailability.UPGRADE -> {
                val prompt = AlertDialog.Builder(android.view.ContextThemeWrapper(activity, android.R.style.Theme_Material_Light_Dialog_Alert)).setTitle(text("画面録画はIndieで利用できます", "Screen recording requires Indie"))
                .setMessage(text("スクリーンショットはFreeでも利用できます。", "Screenshots remain available on Free."))
                .setNegativeButton(text("閉じる", "Close"), null).setPositiveButton(text("プランを見る", "View plans")) { _, _ ->
                    config.cloud?.let { runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(it.apiBaseUrl.trimEnd('/') + "/app"))) } }
                }.create()
                dialog = prompt; syncTriggers(); prompt.setOnDismissListener { if (dialog === prompt) dialog = null; syncTriggers() }; prompt.show()
            }
            else -> showInfo(recordingLabel())
        }
    }
    private fun showInfo(message: String) {
        val prompt = AlertDialog.Builder(android.view.ContextThemeWrapper(activity, android.R.style.Theme_Material_Light_Dialog_Alert)).setMessage(message).setPositiveButton(text("閉じる", "Close"), null).create()
        dialog = prompt; syncTriggers(); prompt.setOnDismissListener { if (dialog === prompt) dialog = null; syncTriggers() }; prompt.show()
    }
    private fun preferredLocale(): KueLocale {
        val preferences = android.os.LocaleList.getDefault()
        for (index in 0 until preferences.size()) when (preferences[index].language) { "ja" -> return KueLocale.JA; "en" -> return KueLocale.EN }
        return KueLocale.EN
    }
    private fun syncTriggers() {
        emitState()
        val active = enabled && !disposed && foreground && !busy && !flushing && dialog == null && heldMenu == null && recordingHandle == null
        if (active == triggersActive) return
        subscriptions.stop(); triggersActive = active
        if (active) {
            val sources = config.triggers.toMutableList()
            if (shakeEnabled) sources.add(KueShakeTrigger(activity))
            if (screenshotEnabled) sources.add(KueSystemScreenshotTrigger(activity))
            subscriptions.start(sources, config.asyncTriggers)
        }
    }
    private fun resetTriggers() { subscriptions.stop(); triggersActive = false; syncTriggers() }
    private fun menuRecordingLabel() = if (recordingAvailability() == KueRecordingAvailability.UPGRADE)
        text("🔒 画面録画 · Indie", "🔒 Screen recording · Indie") else text("画面録画", "Screen recording")
    private fun menuActions(): List<MenuAction> = kueMenuKinds(draft.findings.size, config.cloud != null, groupable(),
        recordingMode == KueRecordingMode.OFF, config.offlineQueue && config.cloud != null && config.onSubmit == null).map { kind ->
        when (kind) {
            "issue" -> MenuAction(kind, "${groupLabel()} (${draft.findings.size})", R.id.kue_menu_saved) { openSavedFindings() }
            "recording" -> MenuAction(kind, menuRecordingLabel(), R.id.kue_menu_recording) { selectRecording() }
            else -> MenuAction(kind, text("未送信レポート", "Pending reports"), R.id.kue_menu_outbox) { openOutbox() }
        }
    }
    private fun clearHold() { holdTask?.let(main::removeCallbacks); holdTask = null }
    private fun restoreTriggerGesture(gesture: KueTriggerGesture) {
        trigger.x = gesture.startX; trigger.y = gesture.startY
        docked = gesture.startEdge != null && !recordingActive; dockEdge = if (docked) gesture.startEdge else null
        if (docked) dockEdge?.let(::applyDock) else moveTrigger(trigger.x, trigger.y)
    }
    private fun cancelTriggerGesture() {
        clearHold(); trigger.alpha = 1f
        triggerGesture?.let { it.cancel(); restoreTriggerGesture(it) }; triggerGesture = null
        updateTriggerTouchTarget()
    }
    private fun showHeldMenu() {
        if (!enabled || disposed || !foreground || busy || dialog != null || recordingHandle != null || heldMenu != null) return
        val actions = menuActions()
        if (actions.isEmpty()) return
        val accessibility = activity.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
        if (accessibility.isTouchExplorationEnabled) { openActions(); return }
        revealTrigger()
        val menu = FrameLayout(activity).apply {
            id = R.id.kue_radial_menu
            setBackgroundColor(Color.argb(56, 15, 23, 42))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        heldActions = actions
        if (!populateHeld(menu, actions)) { heldActions = emptyList(); openActions(); return }
        overlay.addView(menu, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        heldMenu = menu; syncTriggers()
        if (actions.any { it.kind == "recording" }) refreshProjectFeatures {
            if (heldMenu === menu) {
                val next = menuActions()
                if (!populateHeld(menu, next)) { closeHeld(); triggerGesture?.cancel() } else heldActions = next
            }
        }
    }
    private fun populateHeld(menu: FrameLayout, actions: List<MenuAction>): Boolean {
        val bounds = safeBounds(); val density = activity.resources.displayMetrics.density.toDouble()
        val origin = KuePoint((trigger.x + trigger.width / 2 - bounds.left) / density, (trigger.y + trigger.height / 2 - bounds.top) / density)
        val layout = kueMenuLayout(origin, bounds.width() / density, bounds.height() / density, actions.map { it.label }) ?: return false
        menu.removeAllViews(); heldLayout = layout
        heldViews = actions.mapIndexed { index, item ->
            val point = layout.items[index]; val labelRect = layout.labels[index]
            val icon = KueMenuIcon(activity, item.kind).apply { background = menuBackground(false, 22); elevation = dp(6).toFloat() }
            val label = TextView(activity).apply {
                text = item.label; id = item.id; gravity = Gravity.CENTER
                setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 14f)
                setTextColor(Color.WHITE); typeface = android.graphics.Typeface.DEFAULT_BOLD
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(dp(10), 0, dp(10), 0); background = menuBackground(false, 15); elevation = dp(6).toFloat()
            }
            menu.addView(icon, FrameLayout.LayoutParams(dp(44), dp(44)).apply {
                leftMargin = bounds.left + ((point.x - 22) * density).toInt(); topMargin = bounds.top + ((point.y - 22) * density).toInt()
            })
            menu.addView(label, FrameLayout.LayoutParams((labelRect.width * density).toInt(), dp(30)).apply {
                leftMargin = bounds.left + (labelRect.x * density).toInt(); topMargin = bounds.top + (labelRect.y * density).toInt()
            })
            icon to label
        }
        return true
    }
    private fun menuBackground(selected: Boolean, radius: Int) = rounded(if (selected) Color.rgb(219, 39, 119) else Color.rgb(21, 27, 51), dp(radius)).apply {
        setStroke(dp(1), if (selected) Color.WHITE else Color.argb(41, 255, 255, 255))
    }
    private fun heldAt(x: Float, y: Float): Int? {
        val layout = heldLayout ?: return null
        val point = IntArray(2); overlay.getLocationOnScreen(point); val bounds = safeBounds(); val density = activity.resources.displayMetrics.density.toDouble()
        return kueMenuSelection(layout, KuePoint((x - point[0] - bounds.left) / density, (y - point[1] - bounds.top) / density))
    }
    private fun highlightHeld(x: Float, y: Float) {
        val selected = heldAt(x, y)
        heldViews.forEachIndexed { index, (icon, label) ->
            val active = index == selected; icon.isSelected = active; icon.background = menuBackground(active, 22)
            label.background = menuBackground(active, 15); icon.invalidate()
        }
    }
    private fun releaseHeld(x: Float, y: Float) { val selected = heldAt(x, y)?.let { heldActions.getOrNull(it)?.run }; closeHeld(); selected?.invoke() }
    private fun closeHeld() { heldMenu?.let { overlay.removeView(it) }; heldMenu = null; heldActions = emptyList(); heldViews = emptyList(); heldLayout = null; updateTriggerTouchTarget(); syncTriggers() }

    private fun safeBounds(): Rect {
        val decor = activity.window.decorView
        val insets = decor.rootWindowInsets
        val bars = if (Build.VERSION.SDK_INT >= 30) insets?.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout() or android.view.WindowInsets.Type.ime()) else null
        @Suppress("DEPRECATION")
        val left = bars?.left ?: insets?.systemWindowInsetLeft ?: 0
        @Suppress("DEPRECATION")
        val top = bars?.top ?: insets?.systemWindowInsetTop ?: 0
        @Suppress("DEPRECATION")
        val right = bars?.right ?: insets?.systemWindowInsetRight ?: 0
        @Suppress("DEPRECATION")
        val bottom = bars?.bottom ?: insets?.systemWindowInsetBottom ?: 0
        val origin = IntArray(2); val window = IntArray(2)
        overlay.getLocationOnScreen(origin); decor.getLocationOnScreen(window)
        return Rect((window[0] + left - origin[0]).coerceIn(0, overlay.width),
            (window[1] + top - origin[1]).coerceIn(0, overlay.height),
            (window[0] + decor.width - right - origin[0]).coerceIn(0, overlay.width),
            (window[1] + decor.height - bottom - origin[1]).coerceIn(0, overlay.height)).apply {
                this.right = this.right.coerceAtLeast(this.left); this.bottom = this.bottom.coerceAtLeast(this.top)
            }
    }
    private fun updateSafeBounds() {
        if (overlay.width <= 0 || overlay.height <= 0) return
        val bounds = safeBounds()
        if (overlay.clipBounds == bounds) return
        overlay.clipBounds = bounds
        cancelTriggerGesture()
        if (trigger.width <= 0 || trigger.height <= 0) return
        if (docked) dockEdge?.let(::applyDock) else moveTrigger(trigger.x, trigger.y)
        closeHeld()
    }
    private fun moveTrigger(x: Float, y: Float) {
        val bounds = safeBounds()
        trigger.x = x.coerceIn(bounds.left.toFloat(), max(bounds.left, bounds.right - trigger.width).toFloat())
        trigger.y = y.coerceIn(bounds.top.toFloat(), max(bounds.top, bounds.bottom - trigger.height).toFloat())
        updateTriggerTouchTarget()
    }
    private fun dockTrigger() {
        val bounds = safeBounds()
        val maxX = (bounds.right - trigger.width).coerceAtLeast(bounds.left).toFloat()
        val maxY = (bounds.bottom - trigger.height).coerceAtLeast(bounds.top).toFloat()
        val distances = listOf(trigger.x - bounds.left, maxX - trigger.x, trigger.y - bounds.top, maxY - trigger.y)
        val index = distances.indices.minByOrNull { distances[it] } ?: return
        if (distances[index] > dp(8)) return
        docked = true; dockEdge = index; applyDock(index)
    }
    private fun applyDock(index: Int) {
        val bounds = safeBounds()
        moveTrigger(trigger.x, trigger.y)
        when (index) { 0 -> trigger.x = (bounds.left + dp(18) - trigger.width).toFloat(); 1 -> trigger.x = (bounds.right - dp(18)).toFloat(); 2 -> trigger.y = (bounds.top + dp(18) - trigger.height).toFloat(); 3 -> trigger.y = (bounds.bottom - dp(18)).toFloat() }
        renderTrigger(); updateTriggerTouchTarget()
    }
    private fun revealTrigger() {
        val bounds = safeBounds()
        val margin = min(dp(12), min(bounds.width(), bounds.height()) / 4)
        trigger.x = trigger.x.coerceIn((bounds.left + margin).toFloat(), (bounds.right - trigger.width - margin).coerceAtLeast(bounds.left + margin).toFloat())
        trigger.y = trigger.y.coerceIn((bounds.top + margin).toFloat(), (bounds.bottom - trigger.height - margin).coerceAtLeast(bounds.top + margin).toFloat()); docked = false; dockEdge = null
        renderTrigger(); updateTriggerTouchTarget()
    }
    private fun updateTriggerTouchTarget() {
        if (triggerGesture != null || trigger.width <= 0) return
        val rect = Rect(); trigger.getHitRect(rect); val extra = dp(if (docked) 26 else 6)
        rect.inset(-extra, -extra); rect.intersect(safeBounds())
        overlay.touchDelegate = android.view.TouchDelegate(rect, trigger)
    }
    private fun moveAccessibility() = object : View.AccessibilityDelegate() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            info.className = Button::class.java.name; info.isEnabled = !recordingStopping
            info.hintText = if (recordingActive) text("タップで停止。ドラッグで移動できます。", "Tap to stop recording, or drag to move.") else
                text("タップで撮影、ドラッグで移動。端に隠せます。", "Tap to capture, drag to move, or drop at an edge to hide.") +
                if (menuActions().isNotEmpty()) text("長押しし、項目までスライドして離すと選択できます。", " Hold, slide to an item and release to choose it.") else ""
            listOf(text("左へ移動", "Move left"), text("右へ移動", "Move right"), text("上へ移動", "Move up"), text("下へ移動", "Move down")).forEachIndexed { index, title -> info.addAction(AccessibilityNodeInfo.AccessibilityAction(0x4b1000 + index, title)) }
            if (!recordingActive) {
                info.addAction(AccessibilityNodeInfo.AccessibilityAction(0x4b1004, text("端に隠す", "Hide at edge")))
                if (docked) info.addAction(AccessibilityNodeInfo.AccessibilityAction(0x4b1005, text("表示", "Reveal")))
                if (menuActions().isNotEmpty()) info.addAction(AccessibilityNodeInfo.AccessibilityAction(0x4b1007, text("操作メニューを表示", "Show actions menu")))
            }
        }
        override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
            if (action !in 0x4b1000..0x4b1007) return super.performAccessibilityAction(host, action, args)
            if (recordingStopping || action == 0x4b1006 || (recordingActive && action >= 0x4b1004)) return false
            if (action == 0x4b1007) return openActions()
            revealTrigger()
            when (action - 0x4b1000) {
                0 -> moveTrigger(trigger.x - dp(32), trigger.y); 1 -> moveTrigger(trigger.x + dp(32), trigger.y)
                2 -> moveTrigger(trigger.x, trigger.y - dp(32)); 3 -> moveTrigger(trigger.x, trigger.y + dp(32))
                4 -> {
                    val b = safeBounds(); val maxX = (b.right - trigger.width).coerceAtLeast(b.left); val maxY = (b.bottom - trigger.height).coerceAtLeast(b.top)
                    val distances = listOf(trigger.x - b.left, maxX - trigger.x, trigger.y - b.top, maxY - trigger.y)
                    val edge = distances.indices.minByOrNull { distances[it] }!!; docked = true; dockEdge = edge; applyDock(edge)
                }
            }
            if (action < 0x4b1004 && !recordingActive) dockTrigger()
            return true
        }
    }

    private fun errorText(error: KueError): String = when (error.code) {
        "request_timeout" -> text("応答がありません。同じ内容で再試行できます。", "Request timed out. Retry keeps the same report.")
        "request_cancelled" -> text("送信を中断しました。同じ内容で再試行できます。", "Upload stopped. Retry keeps the same report.")
        "local_save_failed" -> if (error.retryable)
            text("アプリ内への保存に失敗しました。同じ内容で再試行できます。", "Could not save locally. Retry keeps the same report.")
            else text("アプリ内への保存に失敗しました。準備した内容は保持しています。", "Could not save locally. Prepared content is retained.")
        "redirect_rejected" -> text("送信先の転送を拒否しました。設定を確認してください。", "The destination redirected the request. Check configuration.")
        "upload_rejected" -> when (error.serverCode) {
            "quota_exceeded" -> text("今月のレポート上限に達しました。", "The monthly report quota has been reached.")
            "project_plan_paused" -> text("プロジェクトが停止中です。ダッシュボードを確認してください。", "The project is paused. Check the dashboard.")
            "storage_quota_exceeded" -> text("画像ストレージが満杯です。ダッシュボードを確認してください。", "Image storage is full. Check the dashboard.")
            else -> text("送信を受け付けませんでした（HTTP ${error.status}）。", "Upload rejected (HTTP ${error.status}).")
        }
        else -> text("処理を完了できませんでした。", "Could not complete the report.")
    }

    private fun renderTrigger() {
        triggerBadge.text = draft.findings.size.toString()
        triggerBadge.visibility = if (!recordingActive && draft.findings.isNotEmpty()) View.VISIBLE else View.GONE
        val hasMenu = !recordingActive && menuActions().isNotEmpty()
        trigger.setOnLongClickListener(if (hasMenu) View.OnLongClickListener { openActions(); true } else null)
        trigger.isLongClickable = hasMenu
        trigger.isEnabled = !recordingStopping
        if (recordingActive) {
            triggerIcon.id = R.id.kue_recording_stop
            triggerIcon.visibility = View.VISIBLE; triggerMascot.visibility = View.GONE
            triggerIcon.layoutParams = FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER)
            triggerIcon.setImageDrawable(GradientDrawable().apply { setColor(Color.rgb(220, 38, 38)); cornerRadius = dp(3).toFloat() })
            trigger.background = rounded(Color.WHITE, dp(27)).apply { setStroke(dp(2), Color.rgb(220, 38, 38)) }
            trigger.elevation = dp(6).toFloat(); trigger.alpha = if (recordingStopping) .7f else 1f
            trigger.contentDescription = if (recordingStopping) text("録画を停止中", "Stopping recording") else text("録画を停止", "Stop recording")
            return
        }
        triggerIcon.setImageResource(R.drawable.kue_viewfinder)
        triggerIcon.id = View.NO_ID
        triggerIcon.layoutParams = FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER)
        triggerIcon.visibility = if (design == KueButtonDesign.CLASSIC) View.VISIBLE else View.GONE
        triggerMascot.visibility = if (design == KueButtonDesign.MASCOT) View.VISIBLE else View.GONE
        trigger.setPadding(0, 0, 0, 0)
        trigger.background = rounded(if (design == KueButtonDesign.CLASSIC) Color.rgb(21, 27, 51) else Color.TRANSPARENT, dp(27)).apply {
            if (design == KueButtonDesign.CLASSIC) setStroke(dp(1), Color.argb(41, 255, 255, 255))
        }
        trigger.elevation = if (design == KueButtonDesign.CLASSIC) dp(6).toFloat() else 0f
        trigger.contentDescription = (if (docked) text("KUE ボタンを表示", "Reveal KUE button") else text("KUE レポートを開く", "Open KUE report")) +
            if (draft.findings.isNotEmpty()) text("。保存した指摘${draft.findings.size}件", ". ${draft.findings.size} saved findings") else ""
        trigger.visibility = if (floatingVisible) View.VISIBLE else View.GONE
    }
    private fun text(ja: String, en: String) = if (locale == KueLocale.JA) ja else en
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply { setColor(color); cornerRadius = radius.toFloat() }
    private fun mainThread() { check(Looper.myLooper() == Looper.getMainLooper()) { "KUE controller calls require the main thread." } }
}
