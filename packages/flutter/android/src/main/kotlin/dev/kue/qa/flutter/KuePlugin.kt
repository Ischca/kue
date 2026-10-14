package dev.kue.qa.flutter

import android.app.Activity
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import dev.ischca.kue.*
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors

/** Native UI/cloud/outbox host. Screenshot pixels always come from the Dart adapter. */
class KuePlugin : FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler {
    private val main = Handler(Looper.getMainLooper())
    private var channel: MethodChannel? = null
    private var activity: Activity? = null
    private var controller: KueController? = null
    private var sessionId: String? = null
    private var configuration: Map<String, Any?>? = null
    private var generation = 0
    private var reportOperation: String? = null
    private var pendingCount = 0
    private var readingPending = false
    private val stateEvents = KueStateEvents()
    private var worker = Executors.newSingleThreadExecutor()
    private val calls = mutableSetOf<KueBridgeCall<*>>()
    private val triggers = mutableMapOf<String, () -> Unit>()

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        if (worker.isShutdown) worker = Executors.newSingleThreadExecutor()
        channel = MethodChannel(binding.binaryMessenger, "dev.kue.qa/core").also { it.setMethodCallHandler(this) }
    }
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        releaseController(clearSession = true)
        channel?.setMethodCallHandler(null); channel = null; activity = null
        worker.shutdown()
    }
    override fun onAttachedToActivity(binding: ActivityPluginBinding) { activity = binding.activity; reinstall() }
    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) { activity = binding.activity; reinstall() }
    override fun onDetachedFromActivityForConfigChanges() { releaseController(clearSession = false); activity = null }
    override fun onDetachedFromActivity() { releaseController(clearSession = false); activity = null }

    private fun reinstall() {
        if (configuration == null || sessionId == null || controller != null) return
        val owner = activity ?: return
        owner.window.decorView.post {
            if (activity !== owner || sessionId == null || controller != null) return@post
            try { installController(); emitState() }
            catch (_: Exception) { event("error", mapOf("error" to errorDto(KueError("activity_unavailable", retryable = true)))) }
        }
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            val args = objectMap(call.arguments)
            if (call.method == "attach") { attach(args, result); return }
            val sid = identifier(args["sessionId"])
            if (call.method == "detach") {
                if (sessionId != null && sessionId != sid) throw KueError("inactive_session")
                releaseController(clearSession = true); result.success(ok()); return
            }
            if (sessionId != sid) throw KueError("inactive_session")
            if (call.method == "update") {
                optOutRequested(args["config"])
                update(objectMap(args["config"])); result.success(ok()); emitState(); return
            }
            val host = controller ?: throw KueError("activity_unavailable", retryable = true)
            when (call.method) {
                "reportIssue" -> {
                    val op = identifier(args["operationId"])
                    val memo = string(args, "memo", "")
                    val overrides = context(args["context"])
                    if (reportOperation != null) throw KueError("busy")
                    reportOperation = op
                    val accepted = try { host.reportIssue(memo, overrides) }
                    catch (error: Exception) { reportOperation = null; throw error }
                    if (!accepted) { reportOperation = null; throw KueError(if (host.state.enabled) "busy" else "disabled") }
                    result.success(ok())
                }
                "trigger" -> { triggers[identifier(args["subscriptionId"])]?.invoke(); result.success(ok()) }
                "openSavedFindings" -> command(host.openSavedFindings(), host, result)
                "openOutbox" -> command(host.openOutbox(), host, result)
                "beginRecording" -> command(host.recordScreen(), host, result)
                "stopRecording" -> { host.stopRecording(); result.success(ok()) }
                "state" -> { result.success(stateDto(host.state)) }
                "features" -> incoming(result) { done -> host.refreshProjectFeatures { done(it.map(::featuresDto)) } }
                "status" -> incoming(result) { done -> host.readReportStatus(receipt(args["receipt"])) { done(it.map(::statusDto)) } }
                "pendingReports" -> incoming(result) { done -> host.pendingReports(boolean(args, "includeOtherDestinations", false)) { done(it.map { rows -> rows.map(::pendingDto) }) } }
                "retryPendingReports" -> incoming(result) { done -> host.retryPendingReports(boolean(args, "force", false)) { reply -> refreshPending(); done(reply) } }
                "discardPendingReport" -> incoming(result) { done -> host.discardPendingReport(identifier(args["clientReportId"] ?: args["id"]), boolean(args, "includeOtherDestinations", false)) { reply -> refreshPending(); done(reply.map { ok() }) } }
                else -> result.notImplemented()
            }
        } catch (error: Exception) { fail(result, error as? KueError ?: KueError("invalid_config")) }
    }

    private fun attach(args: Map<String, Any?>, result: MethodChannel.Result) {
        val sid = identifier(args["sessionId"])
        if (sessionId != null) {
            if (sessionId != sid) throw KueError("session_in_use")
            optOutRequested(args["config"]); update(objectMap(args["config"])); result.success(ok()); return
        }
        val config = objectMap(args["config"])
        if (activity == null) throw KueError("activity_unavailable", retryable = true)
        configuration = config.toMap(); sessionId = sid
        try { installController(); result.success(ok()); emitState(); refreshPending() }
        catch (error: Exception) { releaseController(clearSession = true); throw error }
    }

    private fun disableRequested(raw: Any?) {
        if ((raw as? Map<*, *>)?.get("enabled") != false) return
        val old = configuration ?: return
        if (!boolean(old, "enabled", true)) return
        releaseController(clearSession = false)
        configuration = old + ("enabled" to false)
        if (activity != null) installController()
        emitState()
    }
    private fun optOutRequested(raw: Any?) {
        disableRequested(raw)
        if ((raw as? Map<*, *>)?.get("recording") != "off") return
        val old = configuration ?: return
        if (old["recording"] == "off") return
        controller?.setRecordingMode(KueRecordingMode.OFF)
        configuration = old + ("recording" to "off")
        emitState()
    }

    private fun installController() {
        val owner = activity ?: throw KueError("activity_unavailable", retryable = true)
        val config = configuration ?: throw KueError("inactive_session")
        val sid = sessionId ?: throw KueError("inactive_session")
        val epoch = generation
        fun active() = sessionId == sid && generation == epoch && activity === owner
        val hasSubmit = boolean(config, "hasOnSubmit", false)
        val hasGroup = boolean(config, "hasOnSubmitGroup", false)
        val handlerId = if (hasSubmit) identifier(config["handlerId"]) else null
        val groupHandlerId = if (hasGroup) identifier(config["groupHandlerId"]) else null
        val callbackTimeout = integer(config, "callbackTimeoutMs", 30000).also { require(it in 1..120000) }.toLong()
        val triggerIds = (config["triggerIds"] as? List<*>)?.map(::identifier).orEmpty()
        require(triggerIds.size <= 32 && triggerIds.distinct().size == triggerIds.size)
        val cloud = config["cloud"]?.let { value -> objectMap(value).let {
            KueCloudConfig(string(it, "apiBaseUrl"), string(it, "projectKey"), integer(it, "timeoutMs", 15000), boolean(it, "allowDevelopmentLocalhostHttp", false))
        } }
        val native = KueConfig(
            enabled = config["enabled"]?.let { boolean(config, "enabled", false) }, locale = locale(config["locale"]),
            buttonDesign = design(config["buttonDesign"]), context = context(config["context"]),
            recording = recording(config["recording"]), offlineQueue = boolean(config, "offlineQueue", false),
            floatingButton = boolean(config, "floatingButton", true), shakeTrigger = boolean(config, "shakeTrigger", false),
            systemScreenshotTrigger = boolean(config, "systemScreenshotTrigger", false), cloud = cloud,
            submitLabel = optionalString(config, "submitLabel"), groupSubmitLabel = optionalString(config, "groupSubmitLabel"),
            captureImage = { _, complete ->
                val op = reportOperation ?: UUID.randomUUID().toString()
                dart("capture", mapOf("sessionId" to sid, "operationId" to op), callbackTimeout) { reply ->
                    if (reply.isFailure) { complete(Result.failure(reply.exceptionOrNull()!!)); return@dart }
                    try {
                        val image = objectMap(reply.getOrThrow())
                        require(string(image, "mimeType", "image/png") == "image/png")
                        val bytes = image["mediaBytes"] as? ByteArray ?: throw KueError("capture_unavailable")
                        require(bytes.size in 1..(10 * 1024 * 1024))
                        val at = string(image, "capturedAt"); require(at.length <= 64); Instant.parse(at)
                        val captureContext = context(image["context"])
                        worker.execute {
                            val decoded = runCatching {
                                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                                require(options.outMimeType == "image/png" && options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 16_000_000)
                                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw KueError("capture_unavailable")
                                KueCapturedImage(bitmap, at, captureContext)
                            }
                            main.post {
                                if (!active()) decoded.getOrNull()?.bitmap?.recycle()
                                else complete(decoded.fold(onSuccess = { Result.success(it) }, onFailure = { Result.failure(KueError("capture_unavailable")) }))
                            }
                        }
                    } catch (_: Exception) { complete(Result.failure(KueError("capture_unavailable"))) }
                }
            },
            onSubmit = if (!hasSubmit) null else { report, complete ->
                dart("submit", mapOf("sessionId" to sid, "operationId" to UUID.randomUUID().toString(), "handlerId" to handlerId, "report" to findingDto(report)), callbackTimeout) { response -> complete(ack(response)) }
            },
            onSubmitGroup = if (!hasGroup) null else { group, complete ->
                dart("submitGroup", mapOf("sessionId" to sid, "operationId" to UUID.randomUUID().toString(), "handlerId" to groupHandlerId, "group" to groupDto(group)), callbackTimeout) { response -> complete(ack(response)) }
            },
            asyncTriggers = triggerIds.map { id -> KueAsyncTriggerSource { open, complete ->
                val subscription = UUID.randomUUID().toString()
                triggers[subscription] = { if (active()) open() }
                fun cleanup() { triggers.remove(subscription); unsubscribe(sid, id, subscription) }
                dart("subscribeTrigger", mapOf("sessionId" to sid, "triggerId" to id, "subscriptionId" to subscription), callbackTimeout,
                    lateSuccess = { cleanup() }) { reply ->
                    val accepted = ack(reply)
                    if (accepted.isSuccess) complete(Result.success { cleanup() })
                    else { cleanup(); complete(Result.failure(accepted.exceptionOrNull()!!)) }
                }
            } },
            onDraftChanged = { if (active()) emitState() },
            onReceipt = { if (active()) { event("receipt", mapOf("receipt" to receiptDto(it))); refreshPending() } },
            onQueued = { if (active()) { event("queued", mapOf("clientReportId" to it)); refreshPending() } },
            onError = { if (active()) event("error", mapOf("error" to errorDto(it))) },
            onReportOutcome = { outcome, error -> if (active()) {
                val operation = reportOperation; reportOperation = null
                if (operation != null) event("outcome", mapOf("operationId" to operation, "outcome" to when (outcome) {
                    KueReportOutcome.CANCELLED -> "cancelled"; KueReportOutcome.SUBMITTED -> "submitted"; KueReportOutcome.QUEUED -> "queued";
                    KueReportOutcome.FINDING_ADDED -> "findingAdded"; KueReportOutcome.FAILED -> "failed"
                }, "error" to error?.let(::errorDto)))
            } },
            onStateChanged = { if (active()) event("state", mapOf("state" to stateDto(it))) },
        )
        controller = Kue.install(owner, native)
    }

    private fun update(config: Map<String, Any?>) {
        var old = configuration ?: throw KueError("inactive_session")
        val requestedEnabled = boolean(config, "enabled", boolean(old, "enabled", true))
        // Disabling wins even when another immutable change must be rejected. Keep the old
        // destination and handler snapshot; only an explicit remount may replace them.
        if (!requestedEnabled && boolean(old, "enabled", true)) { disableRequested(config); old = configuration!! }
        val immutable = setOf("cloud", "hasOnSubmit", "hasOnSubmitGroup", "handlerId", "groupHandlerId", "offlineQueue", "triggerIds", "callbackTimeoutMs")
        if (immutable.any { old[it] != config[it] }) throw KueError("configuration_changed")
        if (requestedEnabled && !boolean(old, "enabled", true)) {
            releaseController(clearSession = false)
            configuration = old + ("enabled" to true)
            if (activity != null) installController()
        }
        val host = controller ?: throw KueError("activity_unavailable")
        host.setRecordingMode(recording(config["recording"]))
        locale(config["locale"])?.let(host::setLocale)
        host.setButtonDesign(design(config["buttonDesign"]))
        optionalString(config, "submitLabel")?.let(host::setSubmitLabel)
        optionalString(config, "groupSubmitLabel")?.let(host::setGroupSubmitLabel)
        host.setContext(context(config["context"]))
        host.setFloatingButtonVisible(boolean(config, "floatingButton", true))
        if (old["shakeTrigger"] != config["shakeTrigger"]) host.setShakeTriggerEnabled(boolean(config, "shakeTrigger", false))
        if (old["systemScreenshotTrigger"] != config["systemScreenshotTrigger"]) host.setSystemScreenshotTriggerEnabled(boolean(config, "systemScreenshotTrigger", false))
        configuration = config.toMap()
    }

    private fun releaseController(clearSession: Boolean) {
        reportOperation?.let { event("outcome", mapOf("operationId" to it, "outcome" to "cancelled")) }; reportOperation = null
        generation++; readingPending = false; stateEvents.reset()
        controller?.uninstall(); controller = null
        triggers.clear()
        calls.toList().forEach { call -> @Suppress("UNCHECKED_CAST") (call as KueBridgeCall<Any?>).resolve(Result.failure(KueError("request_cancelled", retryable = true))) }
        calls.clear()
        if (clearSession) { configuration = null; sessionId = null; pendingCount = 0 }
    }

    private fun dart(method: String, arguments: Map<String, Any?>, timeout: Long,
                     lateSuccess: (Any?) -> Unit = {}, completion: (Result<Any?>) -> Unit) {
        val endpoint = channel
        if (endpoint == null) { completion(Result.failure(KueError("request_cancelled", retryable = true))); return }
        lateinit var ticket: KueBridgeCall<Any?>
        lateinit var timer: Runnable
        ticket = KueBridgeCall(completion = { reply -> calls.remove(ticket); main.removeCallbacks(timer); completion(reply) }, lateSuccess = lateSuccess)
        timer = Runnable { ticket.resolve(Result.failure(KueError("request_timeout", retryable = true))) }
        calls.add(ticket); main.postDelayed(timer, timeout)
        endpoint.invokeMethod(method, arguments, object : MethodChannel.Result {
            override fun success(value: Any?) { ticket.resolve(Result.success(value)) }
            override fun error(code: String, message: String?, details: Any?) { ticket.resolve(Result.failure(callbackError(code, details))) }
            override fun notImplemented() { ticket.resolve(Result.failure(KueError(if (method == "capture") "capture_unavailable" else "local_save_failed", retryable = true))) }
        })
    }
    private fun unsubscribe(sid: String, triggerId: String, subscriptionId: String) {
        channel?.invokeMethod("unsubscribeTrigger", mapOf("sessionId" to sid, "triggerId" to triggerId, "subscriptionId" to subscriptionId))
    }
    private fun incoming(result: MethodChannel.Result, launch: ((Result<Any?>) -> Unit) -> Unit) {
        lateinit var ticket: KueBridgeCall<Any?>
        ticket = KueBridgeCall(completion = { reply -> calls.remove(ticket); reply.fold(onSuccess = result::success, onFailure = { fail(result, it as? KueError ?: KueError("unexpected_response")) }) })
        calls.add(ticket)
        try { launch { ticket.resolve(it) } } catch (error: Exception) { ticket.resolve(Result.failure(error)) }
    }
    private fun refreshPending() {
        if (readingPending) return
        val host = controller ?: return
        val epoch = generation; readingPending = true
        host.pendingReports { result ->
            if (generation != epoch) return@pendingReports
            readingPending = false
            result.onSuccess { pendingCount = it.size; emitState() }
        }
    }
    private fun emitState() {
        val host = controller
        if (host != null) event("state", mapOf("state" to stateDto(host.state)))
        else if (configuration?.get("enabled") == false) event("state", mapOf("state" to mapOf("enabled" to false, "savedCount" to 0,
            "pendingCount" to pendingCount, "groupLocked" to false, "groupFull" to false, "recordingActive" to false)))
    }
    private fun event(type: String, values: Map<String, Any?>) {
        val sid = sessionId ?: return
        if (type == "state") {
            val state = values["state"] as? Map<*, *> ?: return
            if (!stateEvents.accept(state)) return
        }
        channel?.invokeMethod("event", mapOf("sessionId" to sid, "type" to type) + values)
    }
    private fun command(accepted: Boolean, host: KueController, result: MethodChannel.Result) {
        if (!accepted) throw KueError(if (host.state.enabled) "busy" else "disabled")
        result.success(ok())
    }
    private fun stateDto(value: KueControllerState) = mapOf("savedCount" to value.savedFindingCount, "pendingCount" to pendingCount,
        "groupLocked" to value.groupLocked, "groupFull" to value.groupFull, "recordingAvailability" to value.recordingAvailability.name.lowercase(),
        "enabled" to value.enabled, "recordingActive" to value.recording, "capturing" to value.capturing, "busy" to value.busy,
        "recorderIncluded" to runCatching { Class.forName("dev.ischca.kue.recorder.KueNativeRecorder") }.isSuccess)

    private fun findingDto(report: KueFinding): Map<String, Any?> {
        require(report.byteSize in 1..(if (report.mimeType == "video/mp4") 20 else 10) * 1024 * 1024)
        return mapOf("clientReportId" to report.clientReportId, "memo" to report.memo, "metadataJson" to report.metadataJson,
            "mediaBytes" to report.mediaBytes, "mimeType" to report.mimeType)
    }
    private fun groupDto(group: KueReportGroup): Map<String, Any?> {
        require(group.findings.size in 1..10 && group.findings.sumOf { it.byteSize.toLong() } <= 20 * 1024 * 1024)
        return mapOf("clientReportId" to group.clientReportId, "title" to group.title, "findings" to group.findings.map(::findingDto))
    }
    private fun featuresDto(value: KueProjectFeatures) = mapOf("schemaVersion" to 1, "groups" to value.groups,
        "recording" to mapOf("entitled" to value.recordingEntitled, "available" to value.recordingAvailable))
    private fun receiptDto(value: KueReceipt) = mapOf("clientReportId" to value.clientReportId, "id" to value.id, "status" to value.status, "receiptToken" to value.receiptToken)
    private fun statusDto(value: KueReportStatus) = mapOf("id" to value.id, "status" to value.status,
        "githubIssue" to value.githubIssue?.let { mapOf("number" to it.number, "url" to it.url) }) +
        (value.errorCode?.let { mapOf("error" to mapOf("code" to it)) } ?: emptyMap())
    private fun pendingDto(value: KuePendingReport) = kuePendingDto(value)
    private fun receipt(value: Any?): KueReceipt = objectMap(value).let { KueReceipt(string(it, "clientReportId", "receipt_00000000"), string(it, "id"), string(it, "status", "queued"), optionalString(it, "receiptToken")) }
    private fun errorDto(value: KueError) = kueErrorDto(value)
    private fun fail(result: MethodChannel.Result, error: KueError) = result.error(error.code, "KUE operation failed.", errorDto(error))
    private fun callbackError(code: String, details: Any?): KueError {
        val safe = code.takeIf { it in setOf("local_save_failed", "request_cancelled", "request_timeout", "capture_unavailable", "invalid_report") } ?: "local_save_failed"
        val values = details as? Map<*, *>
        return KueError(safe, values?.get("retryable") as? Boolean ?: true)
    }
    private fun ack(reply: Result<Any?>): Result<Unit> = reply.fold(onSuccess = {
        if ((it as? Map<*, *>)?.get("ok") == true) Result.success(Unit) else Result.failure(KueError("unexpected_response", retryable = true))
    }, onFailure = { Result.failure(it) })
    private fun ok() = mapOf("ok" to true)
    private fun objectMap(value: Any?): Map<String, Any?> {
        val map = value as? Map<*, *> ?: throw KueError("invalid_config")
        require(map.keys.all { it is String }); @Suppress("UNCHECKED_CAST") return map as Map<String, Any?>
    }
    private fun identifier(value: Any?): String = (value as? String)?.takeIf { it.length in 1..128 && Regex("^[A-Za-z0-9._:-]+$").matches(it) } ?: throw KueError("invalid_config")
    private fun string(map: Map<String, Any?>, key: String, default: String? = null): String = optionalString(map, key) ?: default ?: throw KueError("invalid_config")
    private fun optionalString(map: Map<String, Any?>, key: String): String? = map[key]?.let { it as? String ?: throw KueError("invalid_config") }
    private fun boolean(map: Map<String, Any?>, key: String, default: Boolean): Boolean = map[key]?.let { it as? Boolean ?: throw KueError("invalid_config") } ?: default
    private fun integer(map: Map<String, Any?>, key: String, default: Int): Int = map[key]?.let { value ->
        val number = value as? Number ?: throw KueError("invalid_config"); val result = number.toInt(); require(number.toDouble() == result.toDouble()); result
    } ?: default
    private fun locale(value: Any?): KueLocale? = when (value) { null -> null; "ja" -> KueLocale.JA; "en" -> KueLocale.EN; else -> throw KueError("invalid_config") }
    private fun design(value: Any?): KueButtonDesign = when (value) { null, "classic" -> KueButtonDesign.CLASSIC; "mascot" -> KueButtonDesign.MASCOT; else -> throw KueError("invalid_config") }
    private fun recording(value: Any?): KueRecordingMode = when (value) { null, "auto" -> KueRecordingMode.AUTO; "off" -> KueRecordingMode.OFF; else -> throw KueError("invalid_config") }
    private fun context(value: Any?): KueContextOverrides {
        if (value == null) return KueContextOverrides()
        val map = objectMap(value)
        fun number(key: String): Double? = map[key]?.let { (it as? Number)?.toDouble()?.takeIf(Double::isFinite) ?: throw KueError("invalid_config") }
        return KueContextOverrides(optionalString(map, "osVersion"), optionalString(map, "deviceModel"), optionalString(map, "appVersion"), optionalString(map, "buildNumber"), number("screenWidth"), number("screenHeight"), optionalString(map, "route"))
    }
}
