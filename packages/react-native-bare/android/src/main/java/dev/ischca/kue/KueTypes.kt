package dev.ischca.kue

import org.json.JSONObject
import java.net.URI
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.Collections

enum class KueLocale { JA, EN }
enum class KueButtonDesign { CLASSIC, MASCOT }
enum class KueRecordingMode { AUTO, OFF }
enum class KueRecordingAvailability { OFF, CLOUD_REQUIRED, CHECKING, CHECK_FAILED, UPGRADE, UNAVAILABLE, REBUILD, READY }
enum class KueReportOutcome { CANCELLED, SUBMITTED, QUEUED, FINDING_ADDED, FAILED }

/** Lightweight lifecycle state. Media and receipt capabilities are deliberately excluded. */
data class KueControllerState(val enabled: Boolean, val foreground: Boolean, val reporterOpen: Boolean,
    val capturing: Boolean, val recording: Boolean, val busy: Boolean, val savedFindingCount: Int,
    val recordingAvailability: KueRecordingAvailability, val groupLocked: Boolean, val groupFull: Boolean)

/** Capture-derived context is a fallback below installed and per-report overrides. */
class KueCapturedImage(val bitmap: android.graphics.Bitmap, val capturedAt: String,
                       val context: KueContextOverrides = KueContextOverrides()) {
    init { require(capturedAt.length <= 64 && runCatching { java.time.Instant.parse(capturedAt) }.isSuccess) }
}

data class KueProjectFeatures(val groups: Boolean, val recordingEntitled: Boolean, val recordingAvailable: Boolean)
data class KueIssue(val number: Int, val url: String)
data class KueReportStatus(val id: String, val status: String, val githubIssue: KueIssue?, val errorCode: String?)

/** Platform remains Android. Automatic values < install context < reportIssue context. */
data class KueContextOverrides(
    val osVersion: String? = null, val deviceModel: String? = null, val appVersion: String? = null,
    val buildNumber: String? = null, val screenWidth: Double? = null, val screenHeight: Double? = null, val route: String? = null,
) {
    internal fun withFallback(value: KueContextOverrides) = KueContextOverrides(
        osVersion ?: value.osVersion, deviceModel ?: value.deviceModel, appVersion ?: value.appVersion,
        buildNumber ?: value.buildNumber, screenWidth ?: value.screenWidth,
        screenHeight ?: value.screenHeight, route ?: value.route)
}

/** Subscribe only while the attached controller is foregrounded and idle; return cleanup. */
fun interface KueTriggerSource { fun subscribe(open: () -> Unit): () -> Unit }

/** Setup may finish on any thread. KUE owns and releases a successful cleanup, even after detach. */
fun interface KueAsyncTriggerSource {
    fun subscribe(open: () -> Unit, complete: (Result<() -> Unit>) -> Unit)
}

sealed interface KueFinding {
    val clientReportId: String
    val memo: String
    val context: KueContext
    val capturedAt: String
    val outputSize: KueSize
    val mimeType: String
    val byteSize: Int
    val mediaBytes: ByteArray
    val metadataJson: String
}

/** Coordinates relative to the original screenshot, in 0..1. */
data class KueCrop(val x: Double, val y: Double, val width: Double, val height: Double) {
    init {
        require(listOf(x, y, width, height).all(Double::isFinite) && x >= 0 && y >= 0 &&
            width > 0 && height > 0 && x + width <= 1 && y + height <= 1) { "Invalid normalized crop." }
    }
    internal fun json() = JSONObject().put("x", x).put("y", y).put("width", width).put("height", height)
}

data class KueSize(val width: Int, val height: Int) {
    init { require(width in 1..100000 && height in 1..100000) }
    internal fun json() = JSONObject().put("width", width).put("height", height)
}

/** Caller-owned report context preserves supplied fields; host capture separately fills automatic values. */
data class KueContext @JvmOverloads constructor(
    val osVersion: String? = null,
    val deviceModel: String? = null,
    val appVersion: String? = null,
    val buildNumber: String? = null,
    val screenWidth: Double? = null,
    val screenHeight: Double? = null,
    val route: String? = null,
    val platform: String = "android",
) {
    constructor(osVersion: String, deviceModel: String, appVersion: String?, buildNumber: String?, screenWidth: Double, screenHeight: Double, route: String? = null) :
        this(osVersion, deviceModel, appVersion, buildNumber, screenWidth, screenHeight, route, "android")
    constructor(osVersion: String, deviceModel: String, appVersion: String?, buildNumber: String?, screenWidth: Int, screenHeight: Int, route: String? = null) :
        this(osVersion, deviceModel, appVersion, buildNumber, screenWidth.toDouble(), screenHeight.toDouble(), route, "android")
    init {
        require(platform in setOf("ios", "android"))
        require((osVersion?.toByteArray()?.size ?: 0) <= 128 && (deviceModel?.toByteArray()?.size ?: 0) <= 256)
        require((appVersion?.toByteArray()?.size ?: 0) <= 128 && (buildNumber?.toByteArray()?.size ?: 0) <= 128)
        require((route?.toByteArray()?.size ?: 0) <= 2048)
        require(listOf(screenWidth, screenHeight).all { it == null || (it.isFinite() && it > 0 && it <= 100000) })
    }
    internal fun json() = JSONObject().put("platform", platform).put("osVersion", osVersion)
        .put("deviceModel", deviceModel).put("appVersion", appVersion).put("buildNumber", buildNumber)
        .put("screenWidth", screenWidth).put("screenHeight", screenHeight).put("route", route)
}

/** Prepared, immutable in-memory report. Reading screenshotBytes returns a defensive copy. */
class KueReport(
    override val clientReportId: String,
    override val memo: String,
    val crop: KueCrop,
    val sourceSize: KueSize,
    override val outputSize: KueSize,
    override val context: KueContext,
    override val capturedAt: String,
    screenshotBytes: ByteArray,
    override val mimeType: String = "image/jpeg",
) : KueFinding {
    private val image = screenshotBytes.copyOf()
    val screenshotBytes: ByteArray get() = image.copyOf()
    override val mediaBytes: ByteArray get() = image.copyOf()
    override val byteSize: Int get() = image.size
    override val metadataJson = JSONObject().put("schemaVersion", 1).put("context", context.json())
        .put("capture", JSONObject().put("capturedAt", capturedAt).put("crop", crop.json())
            .put("sourceSize", sourceSize.json()).put("outputSize", outputSize.json()).put("mimeType", mimeType)).toString()

    init {
        require(Regex("^[A-Za-z0-9._~-]{16,128}$").matches(clientReportId))
        require(memo.isNotBlank() && !memo.contains('\u0000') && memo.toByteArray(Charsets.UTF_8).size <= 4096)
        require(image.size in 1..(10 * 1024 * 1024))
        require(mimeType in setOf("image/jpeg", "image/png"))
        require(capturedAt.length <= 64 && runCatching { java.time.Instant.parse(capturedAt) }.isSuccess)
        require(metadataJson.toByteArray(Charsets.UTF_8).size <= 16 * 1024)
    }
    override fun toString() = "KueReport(imageBytes=$byteSize, outputSize=$outputSize)"
}

class KueVideoFinding(
    override val clientReportId: String = UUID.randomUUID().toString(), override val memo: String,
    override val outputSize: KueSize, override val context: KueContext, override val capturedAt: String,
    val durationMs: Int, videoBytes: ByteArray,
) : KueFinding {
    private val video = videoBytes.copyOf()
    override val mimeType = "video/mp4"
    override val byteSize get() = video.size
    override val mediaBytes get() = video.copyOf()
    override val metadataJson = JSONObject().put("schemaVersion", 2).put("context", context.json())
        .put("capture", JSONObject().put("kind", "video").put("capturedAt", capturedAt).put("durationMs", durationMs)
            .put("outputSize", outputSize.json()).put("mimeType", mimeType)).toString()
    init {
        require(Regex("^[A-Za-z0-9._~-]{16,128}$").matches(clientReportId))
        require(memo.isNotBlank() && !memo.contains('\u0000') && memo.toByteArray(Charsets.UTF_8).size <= 4096)
        require(durationMs in 1..60000 && video.size in 1..(20 * 1024 * 1024))
        require(capturedAt.length <= 64 && runCatching { java.time.Instant.parse(capturedAt) }.isSuccess)
        require(metadataJson.toByteArray(Charsets.UTF_8).size <= 16 * 1024)
    }
    override fun toString() = "KueVideoFinding(durationMs=$durationMs, byteSize=$byteSize)"
}

class KueReportGroup(val title: String, findings: List<KueFinding>, val clientReportId: String = UUID.randomUUID().toString()) {
    val findings: List<KueFinding> = Collections.unmodifiableList(findings.toList())
    internal val manifest: String
    init {
        require(title.isNotBlank() && title == title.trim() && !title.any { it == '\r' || it == '\n' || it == '\u0000' } && title.codePointCount(0, title.length) <= 200)
        require(Regex("^[A-Za-z0-9._~-]{16,128}$").matches(clientReportId))
        require(findings.size in 1..10 && findings.sumOf { it.byteSize.toLong() } <= 20 * 1024 * 1024)
        manifest = JSONObject().put("schemaVersion", 1).put("title", title).put("findings", org.json.JSONArray().apply {
            findings.forEach { put(JSONObject().put("memo", it.memo).put("metadata", JSONObject(it.metadataJson))) }
        }).toString()
        require(manifest.toByteArray(Charsets.UTF_8).size <= 48 * 1024)
    }
    override fun toString() = "KueReportGroup(findings=${findings.size})"
}

class KueReceipt(val clientReportId: String, val id: String, val status: String, val receiptToken: String?) {
    override fun toString() = "KueReceipt(status=$status)"
}

class KueError(
    val code: String,
    val retryable: Boolean = false,
    val status: Int? = null,
    val serverCode: String? = null,
    val retryAfterMs: Long? = null,
) : Exception(code)

/** Origin only. HTTP is accepted only for explicit loopback development configurations. */
class KueCloudConfig(
    val apiBaseUrl: String,
    val projectKey: String,
    val timeoutMs: Int = 15000,
    val allowDevelopmentLocalhostHttp: Boolean = false,
) {
    internal fun endpoint(development: Boolean): URI {
        val base = try { URI(apiBaseUrl.trim()) } catch (_: Exception) { throw KueError("invalid_config") }
        val localHost = base.host?.lowercase() in setOf("localhost", "127.0.0.1", "[::1]", "::1", "10.0.2.2")
        if (!Regex("^pk_[A-Za-z0-9_-]{8,128}$").matches(projectKey.trim()) || timeoutMs !in 1..120000 ||
            base.host.isNullOrBlank() || base.userInfo != null || base.rawQuery != null || base.rawFragment != null ||
            base.path !in listOf("", "/") || base.port < -1 || base.port > 65535 ||
            !(base.scheme == "https" || (base.scheme == "http" && development && allowDevelopmentLocalhostHttp && localHost))) {
            throw KueError("invalid_config")
        }
        return URI(base.toString().trimEnd('/') + "/v1/reports")
    }
    override fun toString() = "KueCloudConfig(timeoutMs=$timeoutMs)"
}

/** Local completion runs on the UI thread. Return failure to retain the same prepared payload for retry. */
class KueConfig(
    val enabled: Boolean? = null,
    val locale: KueLocale? = null,
    val buttonDesign: KueButtonDesign = KueButtonDesign.CLASSIC,
    val route: String? = null,
    val context: KueContextOverrides = KueContextOverrides(),
    val recording: KueRecordingMode = KueRecordingMode.AUTO,
    val recorder: KueRecorder? = null,
    val offlineQueue: Boolean = false,
    val floatingButton: Boolean = true,
    val shakeTrigger: Boolean = false,
    val systemScreenshotTrigger: Boolean = false,
    val triggers: List<KueTriggerSource> = emptyList(),
    val asyncTriggers: List<KueAsyncTriggerSource> = emptyList(),
    /** Callback transfers ownership of the returned Bitmap to KUE. No protected-window bypass. */
    val capture: ((android.app.Activity, (Result<android.graphics.Bitmap>) -> Unit) -> Unit)? = null,
    val captureImage: ((android.app.Activity, (Result<KueCapturedImage>) -> Unit) -> Unit)? = null,
    val cloud: KueCloudConfig? = null,
    val onSubmit: ((KueReport, (Result<Unit>) -> Unit) -> Unit)? = null,
    val onSubmitGroup: ((KueReportGroup, (Result<Unit>) -> Unit) -> Unit)? = null,
    val submitLabel: String? = null,
    val groupSubmitLabel: String? = null,
    val onQueued: ((String) -> Unit)? = null,
    val onDraftChanged: ((List<KueFinding>) -> Unit)? = null,
    val onReceipt: ((KueReceipt) -> Unit)? = null,
    val onError: ((KueError) -> Unit)? = null,
    /** A screenshot flow ends here; background outbox receipts never complete this flow. */
    val onReportOutcome: ((KueReportOutcome, KueError?) -> Unit)? = null,
    val onStateChanged: ((KueControllerState) -> Unit)? = null,
) {
    init {
        require(capture == null || captureImage == null) { "Choose one capture adapter." }
        require(cloud != null || onSubmit != null) { "Choose cloud or onSubmit." }
        require(onSubmit == null || !submitLabel.isNullOrBlank()) { "A local handler requires submitLabel." }
        require(onSubmitGroup == null || !(groupSubmitLabel ?: submitLabel).isNullOrBlank()) { "A local group handler requires groupSubmitLabel or submitLabel." }
        require((route?.toByteArray(Charsets.UTF_8)?.size ?: 0) <= 2048)
    }
}

internal fun parseRetryAfter(value: String?, nowMs: Long = System.currentTimeMillis()): Long? {
    if (value.isNullOrBlank()) return null
    value.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 && it <= Long.MAX_VALUE / 1000.0 }
        ?.let { return (it * 1000).toLong() }
    return try { (ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - nowMs).coerceAtLeast(0) }
    catch (_: Exception) { null }
}

internal fun rejection(status: Int, body: String, retryAfter: String?): KueError {
    val serverCode = try { JSONObject(body).optJSONObject("error")?.optString("code")?.takeIf { Regex("^[A-Za-z0-9._-]{1,64}$").matches(it) } }
    catch (_: Exception) { null }
    return KueError("upload_rejected", (status == 429 && serverCode != "quota_exceeded") || status >= 500,
        status, serverCode, parseRetryAfter(retryAfter))
}
