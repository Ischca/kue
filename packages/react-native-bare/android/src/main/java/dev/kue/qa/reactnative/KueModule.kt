package dev.kue.qa.reactnative

import android.app.Activity
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import dev.ischca.kue.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors

/** Activity-owned native reporter. React owns callbacks, not SDK UI, prepared media or transport. */
class KueModule(private val react: ReactApplicationContext) : NativeKueSpec(react), LifecycleEventListener {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newFixedThreadPool(2)
    private val media = KueMediaStore(File(react.cacheDir, "kue-rn-v1"), listOf(react.filesDir, react.cacheDir, react.noBackupFilesDir))
    private var controller: KueController? = null
    private var owner: Activity? = null
    private var sessionId: String? = null
    private var configuration: JSONObject? = null
    private val sessions = linkedMapOf<String, JSONObject>()
    private var generation = 0
    private var invalidated = false
    private var pendingCount = 0
    private var pendingRead = false
    private val lastStates = mutableMapOf<String, String>()
    private var opening: Opening? = null
    private var reportOperation: String? = null
    @Volatile private var foreground = react.lifecycleState == LifecycleState.RESUMED
    private val standaloneCalls = mutableMapOf<String, KueStandaloneCall<String>>()
    private val imported = linkedSetOf<String>()
    private val requests = mutableMapOf<String, Callback>()
    private val triggers = mutableMapOf<String, () -> Unit>()
    private val inbound = mutableSetOf<KueCallbackGate<String>>()
    private var dispatching: KueCallbackGate<String>? = null
    private data class Opening(val operation: String, val done: KueCallbackGate<String>)
    private data class Callback(val sid: String, val kind: String, val gate: KueCallbackGate<JSONObject>, val timer: Runnable)

    init { react.addLifecycleEventListener(this) }
    override fun getName() = NAME
    override fun onHostResume() { main.post {
        if (invalidated) return@post
        foreground = true
        val current = react.currentActivity ?: return@post
        if (owner !== current) { release(clearSession = false); owner = current }
        if (configuration != null && controller == null) runCatching { install(); emitState(); refreshPending() }.onFailure { event("error", KueWire.version("error" to KueWire.error(safeError(it)))) }
    } }
    override fun onHostPause() { foreground = false; main.post { standaloneCalls.values.forEach { it.background() } } }
    override fun onHostDestroy() { foreground = false; main.post { standaloneCalls.values.forEach { it.background() }; release(clearSession = false); owner = null } }
    override fun invalidate() {
        react.removeLifecycleEventListener(this)
        main.post { invalidated = true; standaloneCalls.values.forEach { it.cancel() }; release(clearSession = true); inbound.toList().forEach { it.resolve(Result.failure(KueError("request_cancelled", true))) }; media.close(); worker.shutdown() }
        super.invalidate()
    }

    override fun attach(sessionId: String, configuration: String, promise: Promise) = command(promise) { done ->
        val sid = KueWire.id(sessionId)
        val current = react.currentActivity?.takeUnless { it.isFinishing || it.isDestroyed } ?: throw KueError("activity_unavailable", retryable = true)
        if (owner !== current) { release(clearSession = false); owner = current }
        if (sessions.containsKey(sid)) {
            updateSession(sid, configuration); done.resolve(Result.success(KueWire.ok().toString())); return@command
        }
        if (sessions.size >= 32) throw KueError("busy")
        val value = KueWire.parse(configuration)
        validateConfig(value)
        if (sessions.values.any { KueWire.int(it, "mountOrder", 0) == KueWire.int(value, "mountOrder", 0) }) throw KueError("invalid_config")
        sessions[sid] = value
        try { reconcile(); if (this.sessionId != sid) inactiveState(sid, value); done.resolve(Result.success(KueWire.ok().toString())) }
        catch (error: Exception) { sessions.remove(sid); reconcile(); throw error }
    }
    override fun update(sessionId: String, configuration: String, promise: Promise) = command(promise) { done ->
        updateSession(KueWire.id(sessionId), configuration); done.resolve(Result.success(KueWire.ok().toString()))
    }
    override fun detach(sessionId: String, promise: Promise) = command(promise) { done ->
        val sid = KueWire.id(sessionId)
        sessions.remove(sid)
        reconcile(); lastStates.remove(sid)
        done.resolve(Result.success(KueWire.ok().toString()))
    }
    override fun execute(sessionId: String, action: String, argumentsJson: String, promise: Promise) = command(promise) { done ->
        requireSession(sessionId)
        val args = KueWire.parse(argumentsJson)
        val host = controller ?: throw KueError("activity_unavailable", retryable = true)
        when (action) {
            "reportIssue" -> {
                // Fully validate before reserving an operation, so a bad context cannot poison the next call.
                val memo = KueWire.str(args, "memo", "").also { if (it.toByteArray().size > 4096 || it.contains('\u0000')) throw KueError("invalid_report") }
                val overrides = KueWire.context(KueWire.objectOrNull(args, "context"))
                val op = KueWire.id(KueWire.str(args, "operationId", UUID.randomUUID().toString()))
                if (opening != null) throw KueError("busy")
                opening = Opening(op, done)
                reportOperation = op
                try { if (!host.reportIssue(memo, overrides)) { opening = null; reportOperation = null; throw KueError(if (host.state.enabled) "busy" else "disabled") } }
                catch (error: Exception) { opening = null; reportOperation = null; throw error }
            }
            "trigger" -> { triggers[KueWire.id(KueWire.str(args, "subscriptionId"))]?.invoke(); done.resolve(Result.success(KueWire.ok().toString())) }
            "openSavedFindings" -> accepted(host.openSavedFindings(), host, done)
            "openOutbox" -> accepted(host.openOutbox(), host, done)
            "beginRecording" -> accepted(host.recordScreen(), host, done)
            "stopRecording" -> { host.stopRecording(); done.resolve(Result.success(KueWire.ok().toString())) }
            "state" -> done.resolve(Result.success(KueWire.success(state(host.state)).toString()))
            "features", "getProjectFeatures", "getKueProjectFeatures" -> host.refreshProjectFeatures { complete(done, it.map { KueWire.success(KueWire.features(it)) }) }
            "status", "getReportStatus", "getKueReportStatus" -> host.readReportStatus(KueWire.receipt(args.getJSONObject("receipt"))) { complete(done, it.map { KueWire.success(KueWire.status(it)) }) }
            "pendingReports", "pendingKueReports" -> host.pendingReports(KueWire.bool(args, "includeOtherDestinations", false)) { complete(done, it.map { rows -> KueWire.success(JSONArray(rows.map(KueWire::pending))) }) }
            "retryPendingReports", "retryPendingKueReports" -> host.retryPendingReports(KueWire.bool(args, "force", false)) { refreshPending(); complete(done, it.map { KueWire.success(it) }) }
            "discardPendingReport", "discardPendingKueReport" -> host.discardPendingReport(KueWire.id(KueWire.str(args, "clientReportId")), KueWire.bool(args, "includeOtherDestinations", false)) { refreshPending(); complete(done, it.map { KueWire.ok() }) }
            else -> throw KueError("unsupported_action")
        }
    }

    override fun completeCallback(sessionId: String, requestId: String, response: String) { main.post {
        val request = requests[requestId] ?: return@post
        if (request.sid != sessionId) return@post
        val reply = runCatching { KueWire.parse(response) }.fold(onSuccess = { value ->
            if (value.opt("ok") == true) Result.success(value)
            else Result.failure(callbackError(value.optJSONObject("error"), request.kind))
        }, onFailure = { Result.failure(KueError("unexpected_response", retryable = true)) })
        request.gate.resolve(reply)
    } }

    override fun copyMediaFile(sessionId: String, requestId: String, uri: String, promise: Promise) = command(promise) { done ->
        requireSession(sessionId)
        if (requests[requestId]?.sid != sessionId) throw KueError("inactive_request")
        val epoch = generation
        worker.execute {
            val copied = runCatching { media.copy(requestId, uri) }
            main.post {
                if (epoch != generation || requests[requestId]?.sid != sessionId) {
                    copied.getOrNull()?.let { runCatching { media.removeCopy(it) } }; done.resolve(Result.failure(KueError("request_cancelled", true)))
                } else complete(done, copied.map { KueWire.success(it) })
            }
        }
    }
    override fun removeCopiedMediaFile(uri: String, promise: Promise) = command(promise) { done ->
        worker.execute { val result = runCatching { media.removeCopy(uri); KueWire.ok() }; main.post { complete(done, result) } }
    }

    override fun standalone(action: String, argumentsJson: String, promise: Promise) = command(promise) { done ->
        val args = KueWire.parse(argumentsJson)
        val operation = KueWire.id(KueWire.str(args, "operationId"))
        if (action == "cancel") { standaloneCalls[operation]?.cancel(); done.resolve(Result.success(KueWire.ok().toString())); return@command }
        if (standaloneCalls.containsKey(operation)) throw KueError("busy")
        if (standaloneCalls.size >= 16) throw KueError("busy")
        val rawCloud = args.getJSONObject("cloud")
        val cloud = if (action in setOf("getReportStatus", "status", "getKueReportStatus") && !rawCloud.has("projectKey")) KueWire.cloud(JSONObject(rawCloud.toString()).put("projectKey", "pk_status_bridge_unused")) else KueWire.cloud(rawCloud)
        val cancellation = KueCancellation()
        val call = KueStandaloneCall(action, cancellation, done)
        standaloneCalls[operation] = call
        worker.execute {
            val result = runCatching {
                if (cancellation.cancelled || (!foreground && call.requiresForeground)) throw KueError("request_cancelled", true)
                val client = KueCloudClient(react, cloud)
                when (action) {
                    "features", "getProjectFeatures", "getKueProjectFeatures" -> KueWire.success(KueWire.features(client.getProjectFeatures(cancellation)))
                    "status", "getReportStatus", "getKueReportStatus" -> KueWire.success(KueWire.status(client.getReportStatus(KueWire.receipt(args.getJSONObject("receipt")), cancellation)))
                    "submitReport", "submitKueReport" -> KueWire.success(KueWire.receiptDto(client.submitReport(importFinding(args.getJSONObject("report")) as? KueReport ?: throw KueError("invalid_report"), cancellation)))
                    "submitReportGroup", "submitKueReportGroup" -> {
                        val group = args.getJSONObject("group"); val items = group.getJSONArray("findings")
                        if (items.length() !in 1..10) throw KueError("invalid_report")
                        var remaining = 20 * 1024 * 1024
                        val findings = (0 until items.length()).map { importFinding(items.getJSONObject(it), remaining).also { finding -> remaining -= finding.byteSize } }
                        KueWire.success(KueWire.receiptDto(client.submitGroup(KueReportGroup(KueWire.str(group, "title"), findings, KueWire.str(group, "clientReportId")), cancellation)))
                    }
                    "pendingReports" -> KueWire.success(JSONArray(KueOutboxClient(react, cloud).pendingReports(KueWire.bool(args, "includeOtherDestinations", false)).map(KueWire::pending)))
                    "discardPendingReport" -> { KueOutboxClient(react, cloud).discardPendingReport(KueWire.id(KueWire.str(args, "clientReportId"))); KueWire.ok() }
                    "retryPendingReports" -> KueWire.success(KueOutboxClient(react, cloud).retryPendingReports(KueWire.bool(args, "force", false), cancellation, active = { foreground && !cancellation.cancelled },
                        receipt = { receipt -> main.post { if (!cancellation.cancelled && !invalidated) event("receipt", KueWire.version("receipt" to KueWire.receiptDto(receipt)), operation) } },
                        error = { error -> main.post { if (!cancellation.cancelled && !invalidated) event("error", KueWire.version("error" to KueWire.error(error)), operation) } }))
                    else -> throw KueError("unsupported_action")
                }
            }
            main.post { standaloneCalls.remove(operation); complete(done, result) }
        }
    }

    private fun install() {
        val activity = owner ?: throw KueError("activity_unavailable", true)
        val cfg = configuration ?: throw KueError("inactive_session")
        val sid = sessionId ?: throw KueError("inactive_session")
        val epoch = generation
        fun active() = !invalidated && epoch == generation && sessionId == sid && owner === activity
        val timeout = KueWire.int(cfg, "callbackTimeoutMs", 30000).also { if (it !in 1..120000) throw KueError("invalid_config") }.toLong()
        val hasSubmit = KueWire.bool(cfg, "hasOnSubmit", false)
        val hasGroup = KueWire.bool(cfg, "hasOnSubmitGroup", false)
        val handler = if (hasSubmit) KueWire.id(KueWire.str(cfg, "handlerId")) else null
        val groupHandler = if (hasGroup) KueWire.id(KueWire.str(cfg, "groupHandlerId")) else null
        val captureAdapter = if (KueWire.bool(cfg, "hasCaptureAdapter", false)) KueWire.id(KueWire.str(cfg, "captureAdapterId")) else null
        val ids = cfg.optJSONArray("triggerIds")?.let { array -> (0 until array.length()).map { KueWire.id(array.opt(it) as? String ?: throw KueError("invalid_config")) } }.orEmpty()
        if (ids.size > 32 || ids.distinct().size != ids.size) throw KueError("invalid_config")
        controller = Kue.install(activity, KueConfig(
            enabled = if (cfg.has("enabled") && !cfg.isNull("enabled")) KueWire.bool(cfg, "enabled", false) else null,
            locale = locale(cfg), buttonDesign = design(cfg), context = KueWire.context(KueWire.objectOrNull(cfg, "context")),
            recording = recording(cfg), offlineQueue = KueWire.bool(cfg, "offlineQueue", false),
            cloud = KueWire.objectOrNull(cfg, "cloud")?.let(KueWire::cloud),
            submitLabel = KueWire.optional(cfg, "submitLabel"), groupSubmitLabel = KueWire.optional(cfg, "groupSubmitLabel"),
            floatingButton = KueWire.bool(cfg, "floatingButton", true), shakeTrigger = KueWire.bool(cfg, "shakeTrigger", false),
            systemScreenshotTrigger = KueWire.bool(cfg, "systemScreenshotTrigger", false),
            captureImage = if (!KueWire.bool(cfg, "hasCaptureAdapter", false)) null else { _, complete ->
                val requestId = UUID.randomUUID().toString()
                callback("capture", timeout, KueWire.version("operationId" to (reportOperation ?: UUID.randomUUID().toString()), "captureAdapterId" to captureAdapter), requestId = requestId, completion = { reply ->
                    if (reply.isFailure) { complete(Result.failure(reply.exceptionOrNull()!!)); return@callback }
                    val value = reply.getOrThrow().optJSONObject("value") ?: reply.getOrThrow().optJSONObject("capture") ?: reply.getOrThrow()
                    worker.execute {
                        val decoded = runCatching {
                            val bytes = media.readCaller(KueWire.str(value, "uri"), 10 * 1024 * 1024)
                            val at = KueWire.str(value, "capturedAt"); if (at.length > 64) throw KueError("capture_unavailable"); Instant.parse(at)
                            val capturedContext = KueWire.context(KueWire.objectOrNull(value, "context"))
                            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                            if (bounds.outMimeType !in setOf("image/png", "image/jpeg") || bounds.outMimeType != KueWire.str(value, "mimeType") ||
                                bounds.outWidth != KueWire.int(value, "width", 0) || bounds.outHeight != KueWire.int(value, "height", 0) ||
                                bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > 16_000_000) throw KueError("capture_unavailable")
                            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw KueError("capture_unavailable")
                            KueCapturedImage(bitmap, at, capturedContext)
                        }
                        main.post { captureImported(sid, requestId); if (!active()) decoded.getOrNull()?.bitmap?.recycle() else complete(decoded.fold(onSuccess = { Result.success(it) }, onFailure = { Result.failure(KueError("capture_unavailable")) })) }
                    }
                })
            },
            onSubmit = if (!hasSubmit) null else { report, complete ->
                callbackMedia("submit", timeout, handler, report, null) { complete(it.map { Unit }) }
            },
            onSubmitGroup = if (!hasGroup) null else { group, complete ->
                callbackMedia("submitGroup", timeout, groupHandler, null, group) { complete(it.map { Unit }) }
            },
            asyncTriggers = ids.map { id -> KueAsyncTriggerSource { open, complete ->
                val subscription = UUID.randomUUID().toString()
                triggers[subscription] = { if (active()) open() }
                fun cleanup() { triggers.remove(subscription); event("unsubscribeTrigger", KueWire.version("subscriptionId" to subscription), sid) }
                callback("subscribeTrigger", timeout, KueWire.version("triggerId" to id, "subscriptionId" to subscription), lateSuccess = { cleanup() }) { reply ->
                    if (reply.isSuccess) complete(Result.success { cleanup() }) else { cleanup(); complete(Result.failure(reply.exceptionOrNull()!!)) }
                }
            } },
            onDraftChanged = { if (active()) emitState() },
            onReceipt = { if (active()) { event("receipt", KueWire.version("receipt" to KueWire.receiptDto(it))); refreshPending() } },
            onQueued = { if (active()) { event("queued", KueWire.version("clientReportId" to it)); refreshPending() } },
            onError = { if (active()) event("error", KueWire.version("error" to KueWire.error(it))) },
            onReportOutcome = { outcome, error -> if (active()) {
                opening?.let { it.done.resolve(Result.failure(error ?: KueError("request_cancelled", true))) }; opening = null
                val op = reportOperation; reportOperation = null
                if (op != null) event("outcome", KueWire.version("operationId" to op, "outcome" to when (outcome) {
                    KueReportOutcome.SUBMITTED -> "submitted"; KueReportOutcome.QUEUED -> "queued"; KueReportOutcome.CANCELLED -> "cancelled"; KueReportOutcome.FINDING_ADDED -> "findingAdded"; KueReportOutcome.FAILED -> "failed"
                }, "error" to error?.let(KueWire::error)))
            } },
            onStateChanged = { if (active()) { settleOpened(it); event("state", KueWire.version("state" to state(it))) } },
        ))
    }

    private fun optOut(sid: String, value: JSONObject) {
        val old = sessions[sid] ?: return
        if (value.opt("enabled") == false && old.opt("enabled") != false) {
            old.put("enabled", false)
            reconcile(force = sessionId == sid && selectedSession() == sid)
        }
        if (value.opt("recording") == "off") { if (sessionId == sid) controller?.setRecordingMode(KueRecordingMode.OFF); old.put("recording", "off") }
        emitState()
    }
    private fun updateSession(sid: String, encoded: String) {
        if (!sessions.containsKey(sid)) throw KueError("inactive_session")
        if (encoded.toByteArray().size <= KueWire.MAX_JSON) runCatching { JSONObject(encoded) }.getOrNull()?.let { optOut(sid, it) }
        val value = KueWire.parse(encoded)
        val old = sessions[sid] ?: throw KueError("inactive_session")
        val frozen = setOf("mountOrder", "cloud", "hasOnSubmit", "hasOnSubmitGroup", "handlerId", "groupHandlerId", "hasCaptureAdapter", "captureAdapterId", "offlineQueue", "triggerIds", "callbackTimeoutMs")
        if (frozen.any { canonical(old.opt(it)) != canonical(value.opt(it)) }) throw KueError("configuration_changed")
        validateConfig(value)
        val enabling = !enabled(old) && enabled(value)
        sessions[sid] = value
        if (selectedSession() != sessionId || (enabling && sessionId == sid) || controller == null) reconcile(force = enabling && sessionId == sid)
        else if (sessionId == sid) applyConfig(value)
        if (sessionId != sid) inactiveState(sid, value)
        emitState()
    }
    private fun applyConfig(value: JSONObject) {
        val old = configuration ?: throw KueError("inactive_session")
        val nextLocale = locale(value); val nextDesign = design(value); val nextRecording = recording(value)
        val nextContext = KueWire.context(KueWire.objectOrNull(value, "context"))
        val nextSubmit = KueWire.optional(value, "submitLabel"); val nextGroup = KueWire.optional(value, "groupSubmitLabel")
        if (nextSubmit?.isBlank() == true || nextGroup?.isBlank() == true) throw KueError("invalid_config")
        val floating = KueWire.bool(value, "floatingButton", true); val shake = KueWire.bool(value, "shakeTrigger", false); val screenshot = KueWire.bool(value, "systemScreenshotTrigger", false)
        val host = controller ?: throw KueError("activity_unavailable", true)
        host.setRecordingMode(nextRecording); host.setLocale(nextLocale ?: preferredLocale()); host.setButtonDesign(nextDesign); host.setContext(nextContext)
        nextSubmit?.let(host::setSubmitLabel); nextGroup?.let(host::setGroupSubmitLabel); host.setFloatingButtonVisible(floating)
        if (KueWire.bool(value, "hasOnSubmitGroup", false)) host.setGroupSubmitLabel(nextGroup ?: nextSubmit!!)
        if (old.opt("shakeTrigger") != value.opt("shakeTrigger")) host.setShakeTriggerEnabled(shake)
        if (old.opt("systemScreenshotTrigger") != value.opt("systemScreenshotTrigger")) host.setSystemScreenshotTriggerEnabled(screenshot)
        configuration = value
    }
    private fun validateConfig(value: JSONObject) {
        if (KueWire.int(value, "mountOrder", 0) <= 0) throw KueError("invalid_config")
        locale(value); design(value); recording(value); KueWire.context(KueWire.objectOrNull(value, "context"))
        listOf("enabled", "offlineQueue", "floatingButton", "shakeTrigger", "systemScreenshotTrigger").forEach { KueWire.bool(value, it, false) }
        val timeout = KueWire.int(value, "callbackTimeoutMs", 30000); if (timeout !in 1..120000) throw KueError("invalid_config")
        val submit = KueWire.bool(value, "hasOnSubmit", false); val group = KueWire.bool(value, "hasOnSubmitGroup", false)
        if (submit) KueWire.id(KueWire.str(value, "handlerId")); if (group) KueWire.id(KueWire.str(value, "groupHandlerId"))
        if (KueWire.bool(value, "hasCaptureAdapter", false)) KueWire.id(KueWire.str(value, "captureAdapterId"))
        val cloud = KueWire.objectOrNull(value, "cloud")?.let(KueWire::cloud)
        cloud?.let { KueCloudClient(react, it) }
        if (!submit && cloud == null) throw KueError("invalid_config")
        val label = KueWire.optional(value, "submitLabel"); val groupLabel = KueWire.optional(value, "groupSubmitLabel")
        if (submit && label.isNullOrBlank() || group && (groupLabel ?: label).isNullOrBlank()) throw KueError("invalid_config")
        if (value.has("triggerIds") && value.opt("triggerIds") !is JSONArray) throw KueError("invalid_config")
        value.optJSONArray("triggerIds")?.let { ids ->
            if (ids.length() > 32) throw KueError("invalid_config")
            val parsed = (0 until ids.length()).map { KueWire.id(ids.opt(it) as? String ?: throw KueError("invalid_config")) }
            if (parsed.distinct().size != parsed.size) throw KueError("invalid_config")
        }
    }
    private fun enabled(value: JSONObject): Boolean = KueWire.bool(value, "enabled", react.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
    private fun selectedSession(): String? = (sessions.entries.filter { enabled(it.value) }.maxByOrNull { KueWire.int(it.value, "mountOrder", 0) }
        ?: sessions.entries.maxByOrNull { KueWire.int(it.value, "mountOrder", 0) })?.key
    private fun reconcile(force: Boolean = false) {
        val selected = selectedSession()
        if (!force && selected == sessionId && controller != null) return
        val previous = sessionId
        release(clearSession = false)
        previous?.let { sessions[it]?.let { config -> inactiveState(it, config) } }
        sessionId = selected; configuration = selected?.let(sessions::get); pendingCount = 0
        if (selected != null && owner != null) { install(); emitState(); refreshPending() }
    }
    private fun inactiveState(sid: String, config: JSONObject) {
        val included = runCatching { Class.forName("dev.ischca.kue.recorder.KueNativeRecorder") }.isSuccess
        event("state", KueWire.version("state" to JSONObject().put("attached", false).put("enabled", enabled(config)).put("foreground", foreground)
            .put("reporterOpen", false).put("capturing", false).put("recordingActive", false).put("busy", false).put("savedCount", 0)
            .put("pendingCount", 0).put("groupLocked", false).put("groupFull", false).put("recorderIncluded", included)
            .put("recordingAvailability", if (recording(config) == KueRecordingMode.OFF) "off" else if (config.isNull("cloud") || !config.has("cloud")) "cloud_required" else if (!included) "rebuild" else "checking")), sid)
    }
    private fun preferredLocale(): KueLocale {
        val locales = android.os.LocaleList.getDefault()
        for (index in 0 until locales.size()) when (locales[index].language) { "ja" -> return KueLocale.JA; "en" -> return KueLocale.EN }
        return KueLocale.EN
    }

    private fun callbackMedia(kind: String, timeout: Long, handler: String?, report: KueReport?, group: KueReportGroup?, complete: (Result<JSONObject>) -> Unit) {
        val sid = sessionId ?: run { complete(Result.failure(KueError("request_cancelled", true))); return }
        val epoch = generation; val id = UUID.randomUUID().toString()
        worker.execute {
            val result = runCatching { KueWire.version("handlerId" to handler).apply {
                if (report != null) put("report", KueWire.finding(report, media.write(id, report.mediaBytes, report.mimeType)))
                else put("group", KueWire.group(group!!, media, id))
            } }
            main.post {
                if (epoch != generation || sid != sessionId || invalidated) { media.release(id); return@post }
                result.fold(onSuccess = { callback(kind, timeout, it, requestId = id, completion = complete) },
                    onFailure = { media.release(id); complete(Result.failure(KueError("local_save_failed", true))) })
            }
        }
    }
    private fun callback(kind: String, timeout: Long, payload: JSONObject, requestId: String = UUID.randomUUID().toString(),
                         lateSuccess: (JSONObject) -> Unit = {}, completion: (Result<JSONObject>) -> Unit) {
        val sid = sessionId ?: run { completion(Result.failure(KueError("inactive_session"))); return }
        lateinit var timer: Runnable
        val gate = KueCallbackGate<JSONObject>(completion = {
            requests.remove(requestId); main.removeCallbacks(timer); media.release(requestId)
            if (it.isFailure) { event("cancelRequest", KueWire.version("requestId" to requestId), sid); if (kind == "capture") captureImported(sid, requestId) }
            completion(it)
        }, lateSuccess = lateSuccess)
        timer = Runnable { gate.resolve(Result.failure(KueError("request_timeout", true))) }
        requests[requestId] = Callback(sid, kind, gate, timer); main.postDelayed(timer, timeout)
        emitRequest(sid, requestId, kind, payload)
    }
    private fun emitRequest(sid: String, id: String, kind: String, payload: JSONObject) {
        if (invalidated || !react.hasActiveReactInstance()) return
        emitOnRequest(Arguments.createMap().apply { putString("sessionId", sid); putString("requestId", id); putString("kind", kind); putString("payload", payload.toString()) })
    }
    private fun event(kind: String, payload: JSONObject, eventSession: String? = sessionId) {
        val sid = eventSession ?: return
        if (invalidated || !react.hasActiveReactInstance()) return
        if (kind == "state") { val encoded = payload.toString(); if (lastStates[sid] == encoded) return; lastStates[sid] = encoded }
        emitOnEvent(Arguments.createMap().apply { putString("sessionId", sid); putString("kind", kind); putString("payload", payload.toString()) })
    }
    private fun state(value: KueControllerState) = JSONObject().put("attached", true).put("enabled", value.enabled).put("foreground", value.foreground).put("reporterOpen", value.reporterOpen)
        .put("capturing", value.capturing).put("recordingActive", value.recording).put("busy", value.busy)
        .put("savedCount", value.savedFindingCount).put("pendingCount", pendingCount).put("groupLocked", value.groupLocked).put("groupFull", value.groupFull)
        .put("recordingAvailability", value.recordingAvailability.name.lowercase()).put("recorderIncluded", runCatching { Class.forName("dev.ischca.kue.recorder.KueNativeRecorder") }.isSuccess)
    private fun settleOpened(state: KueControllerState) { if (state.reporterOpen && !state.capturing) { opening?.done?.resolve(Result.success(KueWire.ok().toString())); opening = null } }
    private fun emitState() { controller?.state?.let { settleOpened(it); event("state", KueWire.version("state" to state(it))) } }
    private fun refreshPending() {
        if (pendingRead) return
        val host = controller ?: return
        val epoch = generation; pendingRead = true
        host.pendingReports { reply -> if (epoch == generation) { pendingRead = false; reply.onSuccess { pendingCount = it.size; emitState() } } }
    }
    private fun release(clearSession: Boolean) {
        opening?.done?.resolve(Result.failure(KueError("request_cancelled", true))); opening = null
        reportOperation?.let { event("outcome", KueWire.version("operationId" to it, "outcome" to "cancelled")) }; reportOperation = null
        generation++; pendingRead = false; sessionId?.let { lastStates.remove(it) }
        controller?.uninstall(); controller = null
        requests.values.toList().forEach { it.gate.resolve(Result.failure(KueError("request_cancelled", true))) }
        triggers.clear()
        inbound.toList().filter { it !== dispatching && standaloneCalls.values.none { operation -> operation.done === it } }.forEach { it.resolve(Result.failure(KueError("request_cancelled", true))) }
        if (clearSession) { sessionId = null; configuration = null; pendingCount = 0; sessions.clear(); lastStates.clear() }
    }
    private fun requireSession(sid: String) { if (KueWire.id(sid) != sessionId) throw KueError("inactive_session") }
    private fun command(promise: Promise, action: (KueCallbackGate<String>) -> Unit) {
        main.post {
            lateinit var gate: KueCallbackGate<String>
            gate = KueCallbackGate(completion = { reply -> inbound.remove(gate); reply.fold(onSuccess = promise::resolve, onFailure = {
                val error = safeError(it)
                if (invalidated) failure(promise, error) else promise.resolve(KueWire.failure(error).toString())
            }) })
            inbound.add(gate)
            try { if (invalidated) throw KueError("request_cancelled", true); dispatching = gate; action(gate) }
            catch (error: Exception) { gate.resolve(Result.failure(safeError(error))) }
            finally { dispatching = null }
        }
    }
    private fun complete(done: KueCallbackGate<String>, reply: Result<JSONObject>) = done.resolve(reply.map { it.toString() })
    private fun accepted(value: Boolean, host: KueController, done: KueCallbackGate<String>) { if (!value) throw KueError(if (host.state.enabled) "busy" else "disabled"); done.resolve(Result.success(KueWire.ok().toString())) }
    private fun failure(promise: Promise, error: KueError) { promise.reject(error.code, "KUE operation failed.", Arguments.createMap().apply { putString("code", error.code); putBoolean("retryable", error.retryable); error.status?.let { putInt("httpStatus", it) }; error.serverCode?.let { putString("serverCode", it) }; error.retryAfterMs?.let { putDouble("retryAfterSeconds", it / 1000.0) } }) }
    private fun safeError(error: Throwable) = error as? KueError ?: KueError("invalid_config")
    private fun captureImported(sid: String, request: String) {
        if (!imported.add(request)) return
        if (imported.size > 256) imported.remove(imported.first())
        event("captureImported", KueWire.version("requestId" to request), sid)
    }
    private fun callbackError(value: JSONObject?, kind: String): KueError {
        val code = value?.opt("code") as? String
        return KueError(code?.takeIf { it in setOf("local_save_failed", "request_cancelled", "request_timeout", "capture_unavailable", "invalid_report") } ?: if (kind == "capture") "capture_unavailable" else "local_save_failed", value?.opt("retryable") as? Boolean ?: true)
    }
    private fun locale(value: JSONObject) = when (KueWire.optional(value, "locale")) { null -> null; "ja" -> KueLocale.JA; "en" -> KueLocale.EN; else -> throw KueError("invalid_config") }
    private fun design(value: JSONObject) = when (KueWire.str(value, "buttonDesign", "classic")) { "classic" -> KueButtonDesign.CLASSIC; "mascot" -> KueButtonDesign.MASCOT; else -> throw KueError("invalid_config") }
    private fun recording(value: JSONObject) = when (KueWire.str(value, "recording", "auto")) { "auto" -> KueRecordingMode.AUTO; "off" -> KueRecordingMode.OFF; else -> throw KueError("invalid_config") }
    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"; is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { JSONObject.quote(it) + ":" + canonical(value.opt(it)) }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.opt(it)) }
        is String -> JSONObject.quote(value); is Number, is Boolean -> value.toString(); else -> throw KueError("invalid_config")
    }
    private fun importFinding(value: JSONObject, remainingBytes: Int = 20 * 1024 * 1024): KueFinding {
        if (remainingBytes <= 0) throw KueError("invalid_report")
        val context = value.getJSONObject("context")
        val nativeContext = KueWire.reportContext(context)
        val id = KueWire.str(value, "clientReportId"); val memo = KueWire.str(value, "memo"); val at = KueWire.str(value, "capturedAt")
        val video = value.optJSONObject("video")
        if (video != null) {
            if (KueWire.str(video, "mimeType") != "video/mp4") throw KueError("invalid_report")
            val bytes = media.readCaller(KueWire.str(video, "uri"), remainingBytes)
            if (KueWire.int(video, "byteSize", -1) != bytes.size || bytes.size < 12 || bytes.sliceArray(4..7).toString(Charsets.US_ASCII) != "ftyp") throw KueError("invalid_report")
            return KueVideoFinding(id, memo, KueSize(KueWire.int(video, "width", 0), KueWire.int(video, "height", 0)), nativeContext, at,
                KueWire.int(video, "durationMs", 0), bytes)
        }
        val screenshot = value.getJSONObject("screenshot"); val crop = value.getJSONObject("crop"); val source = value.getJSONObject("sourceSize")
        val bytes = media.readCaller(KueWire.str(screenshot, "uri"), minOf(10 * 1024 * 1024, remainingBytes))
        val mime = KueWire.str(screenshot, "mimeType")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outMimeType != mime || bounds.outWidth != KueWire.int(screenshot, "width", 0) || bounds.outHeight != KueWire.int(screenshot, "height", 0) || bounds.outWidth.toLong() * bounds.outHeight > 16_000_000) throw KueError("invalid_report")
        return KueReport(id, memo, KueCrop(KueWire.number(crop, "x"), KueWire.number(crop, "y"), KueWire.number(crop, "width"), KueWire.number(crop, "height")),
            KueSize(KueWire.int(source, "width", 0), KueWire.int(source, "height", 0)), KueSize(bounds.outWidth, bounds.outHeight), nativeContext, at, bytes, mime)
    }
    companion object { const val NAME = "NativeKue" }
}
