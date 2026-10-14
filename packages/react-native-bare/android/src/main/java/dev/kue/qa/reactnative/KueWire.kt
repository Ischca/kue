package dev.kue.qa.reactnative

import dev.ischca.kue.*
import org.json.JSONArray
import org.json.JSONObject

/** Strict versioned JSON is bounded independently of media, which never enters the JS value graph. */
internal object KueWire {
    const val MAX_JSON = 128 * 1024
    fun parse(value: String): JSONObject {
        if (value.toByteArray(Charsets.UTF_8).size !in 1..MAX_JSON) throw KueError("invalid_config")
        val parsed = try { JSONObject(value) } catch (_: Exception) { throw KueError("invalid_config") }
        if (parsed.opt("schemaVersion") != 1) throw KueError("invalid_config")
        validate(parsed, 0)
        return parsed
    }
    private fun validate(value: Any?, depth: Int) {
        if (depth > 16) throw KueError("invalid_config")
        when (value) {
            is Number -> if (!value.toDouble().isFinite()) throw KueError("invalid_config")
            is JSONObject -> value.keys().forEach { validate(value.opt(it), depth + 1) }
            is JSONArray -> (0 until value.length()).forEach { validate(value.opt(it), depth + 1) }
        }
    }
    fun version(vararg fields: Pair<String, Any?>) = JSONObject().put("schemaVersion", 1).apply { fields.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
    fun ok() = success(null)
    fun success(value: Any?) = version("ok" to true, "value" to value)
    fun failure(error: KueError) = version("ok" to false, "error" to error(error))
    fun str(obj: JSONObject, key: String, default: String? = null): String = optional(obj, key) ?: default ?: throw KueError("invalid_config")
    fun optional(obj: JSONObject, key: String): String? = if (!obj.has(key) || obj.isNull(key)) null else obj.opt(key) as? String ?: throw KueError("invalid_config")
    fun objectOrNull(obj: JSONObject, key: String): JSONObject? = if (!obj.has(key) || obj.isNull(key)) null else obj.opt(key) as? JSONObject ?: throw KueError("invalid_config")
    fun bool(obj: JSONObject, key: String, default: Boolean) = if (!obj.has(key) || obj.isNull(key)) default else obj.opt(key) as? Boolean ?: throw KueError("invalid_config")
    fun int(obj: JSONObject, key: String, default: Int): Int {
        if (!obj.has(key) || obj.isNull(key)) return default
        val num = obj.opt(key) as? Number ?: throw KueError("invalid_config")
        return num.toInt().also { if (num.toDouble() != it.toDouble()) throw KueError("invalid_config") }
    }
    fun number(obj: JSONObject, key: String): Double = (obj.opt(key) as? Number)?.toDouble()?.takeIf(Double::isFinite) ?: throw KueError("invalid_config")
    fun id(value: String): String = value.takeIf { it.length in 1..128 && Regex("^[A-Za-z0-9._:~-]+$").matches(it) } ?: throw KueError("invalid_config")
    fun context(value: JSONObject?): KueContextOverrides {
        if (value == null) return KueContextOverrides()
        if (value.has("platform")) throw KueError("invalid_config")
        return fields(value)
    }
    /** Standalone reports are caller-owned: never fill automatic metadata or retarget their platform. */
    fun reportContext(value: JSONObject): KueContext {
        val fields = fields(value)
        val platform = str(value, "platform")
        if (platform !in setOf("ios", "android")) throw KueError("invalid_config")
        return KueContext(fields.osVersion, fields.deviceModel, fields.appVersion, fields.buildNumber,
            fields.screenWidth, fields.screenHeight, fields.route, platform)
    }
    private fun fields(value: JSONObject): KueContextOverrides {
        fun number(key: String): Double? = if (!value.has(key) || value.isNull(key)) null else
            (value.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 && it <= 100000 } ?: throw KueError("invalid_config")
        fun bounded(key: String, limit: Int) = optional(value, key)?.also { if (it.toByteArray().size > limit) throw KueError("invalid_config") }
        return KueContextOverrides(bounded("osVersion", 128), bounded("deviceModel", 256), bounded("appVersion", 128), bounded("buildNumber", 128), number("screenWidth"), number("screenHeight"), bounded("route", 2048))
    }
    fun cloud(value: JSONObject) = KueCloudConfig(str(value, "apiBaseUrl"), str(value, "projectKey"), int(value, "timeoutMs", 15000), bool(value, "allowDevelopmentLocalhostHttp", false))
    fun receipt(value: JSONObject) = KueReceipt(str(value, "clientReportId", "receipt_00000000"), str(value, "id"), str(value, "status", "queued"), optional(value, "receiptToken"))
    fun receiptDto(value: KueReceipt) = JSONObject().put("clientReportId", value.clientReportId).put("id", value.id).put("status", value.status).apply { value.receiptToken?.let { put("receiptToken", it) } }
    fun features(value: KueProjectFeatures) = JSONObject().put("schemaVersion", 1).put("groups", value.groups)
        .put("recording", JSONObject().put("entitled", value.recordingEntitled).put("available", value.recordingAvailable))
    fun status(value: KueReportStatus) = JSONObject().put("id", value.id).put("status", value.status)
        .put("githubIssue", value.githubIssue?.let { JSONObject().put("number", it.number).put("url", it.url) } ?: JSONObject.NULL)
        .apply { value.errorCode?.let { put("error", JSONObject().put("code", it)) } }
    fun pending(value: KuePendingReport) = JSONObject().put("clientReportId", value.clientReportId).put("savedAt", value.savedAt)
        .put("state", value.state).put("attempts", value.attempts).put("nextAttemptAt", value.nextAttemptAt).put("currentDestination", value.currentDestination)
    fun error(value: KueError): JSONObject {
        val delay = value.retryAfterMs
        val representable = delay == null || delay in 0..9007199254740991L
        return JSONObject().put("code", value.code).put("retryable", value.retryable && representable).apply {
            value.status?.let { put("httpStatus", it) }; value.serverCode?.let { put("serverCode", it) }
            if (delay != null && representable) put("retryAfterSeconds", delay / 1000.0)
        }
    }
    fun finding(value: KueFinding, uri: String): JSONObject {
        val metadata = JSONObject(value.metadataJson)
        val capture = metadata.getJSONObject("capture")
        return JSONObject().put("clientReportId", value.clientReportId).put("memo", value.memo)
            .put("context", metadata.getJSONObject("context")).put("capturedAt", value.capturedAt).apply {
                if (value is KueReport) {
                    put("crop", capture.getJSONObject("crop")); put("sourceSize", capture.getJSONObject("sourceSize"))
                    put("screenshot", JSONObject().put("uri", uri).put("width", value.outputSize.width).put("height", value.outputSize.height).put("mimeType", value.mimeType))
                } else if (value is KueVideoFinding) {
                    put("video", JSONObject().put("uri", uri).put("width", value.outputSize.width).put("height", value.outputSize.height)
                        .put("mimeType", "video/mp4").put("byteSize", value.byteSize).put("durationMs", value.durationMs).put("capturedAt", value.capturedAt))
                }
            }
    }
    fun group(value: KueReportGroup, store: KueMediaStore, requestId: String) = JSONObject()
        .put("clientReportId", value.clientReportId).put("title", value.title).put("findings", JSONArray().apply {
            value.findings.forEach { put(finding(it, store.write(requestId, it.mediaBytes, it.mimeType))) }
        })
}
