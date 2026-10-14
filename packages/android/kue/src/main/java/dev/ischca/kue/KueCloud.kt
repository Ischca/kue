package dev.ischca.kue

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InterruptedIOException
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request as HttpRequest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import java.security.MessageDigest
import android.content.Context

/** No automatic retries, redirects, cookies, background work, or receipt polling. */
internal object KueCloud {

    internal fun multipart(report: KueReport): Pair<String, ByteArray> {
        // The identifier is URL-safe; a boundary derived from it stays stable across retries.
        val boundary = boundary(report.clientReportId)
        val body = ByteArrayOutputStream()
        fun write(value: String) { body.write(value.toByteArray(Charsets.UTF_8)) }
        fun field(name: String, value: String) {
            write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n")
        }
        val extension = if (report.mimeType == "image/png") "png" else "jpg"
        write("--$boundary\r\nContent-Disposition: form-data; name=\"screenshot\"; filename=\"capture.$extension\"\r\nContent-Type: ${report.mimeType}\r\n\r\n")
        body.write(report.screenshotBytes)
        write("\r\n")
        field("memo", report.memo)
        field("metadata", report.metadataJson)
        write("--$boundary--\r\n")
        return boundary to body.toByteArray()
    }

    internal fun boundary(id: String) = "KUE-" + MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).take(20).joinToString("") { "%02x".format(it) }

    internal fun multipart(group: KueReportGroup): Pair<String, ByteArray> {
        val boundary = boundary(group.clientReportId)
        val body = ByteArrayOutputStream()
        fun write(value: String) { body.write(value.toByteArray(Charsets.UTF_8)) }
        write("--$boundary\r\nContent-Disposition: form-data; name=\"manifest\"\r\n\r\n${group.manifest}\r\n")
        group.findings.forEachIndexed { index, finding ->
            val extension = when (finding.mimeType) { "video/mp4" -> "mp4"; "image/png" -> "png"; else -> "jpg" }
            write("--$boundary\r\nContent-Disposition: form-data; name=\"capture_$index\"; filename=\"capture.$extension\"\r\nContent-Type: ${finding.mimeType}\r\n\r\n")
            body.write(finding.mediaBytes); write("\r\n")
        }
        write("--$boundary--\r\n")
        return boundary to body.toByteArray()
    }

    internal class Request {
        @Volatile var call: Call? = null
        @Volatile var cancelled: Boolean = false
        fun cancel() { cancelled = true; call?.cancel() }
    }

    fun submit(report: KueReport, config: KueCloudConfig, development: Boolean, request: Request): KueReceipt {
        return upload(report.clientReportId, multipart(report), config, development, request, "/v1/reports")
    }

    fun submitGroup(group: KueReportGroup, config: KueCloudConfig, development: Boolean, request: Request): KueReceipt {
        return upload(group.clientReportId, multipart(group), config, development, request, "/v1/report-groups")
    }

    private fun upload(id: String, multipart: Pair<String, ByteArray>, config: KueCloudConfig, development: Boolean, request: Request, path: String): KueReceipt {
        val (boundary, bytes) = multipart
        val response = execute(config, development, request, path, config.projectKey.trim(), id, boundary, bytes)
        if (response.code != 202) throw rejection(response.code, response.body, response.retryAfter)
        return parseReceipt(id, response.body)
    }

    fun features(config: KueCloudConfig, development: Boolean, request: Request): KueProjectFeatures {
        val response = execute(config, development, request, "/v1/project/features", config.projectKey.trim())
        if (response.code !in 200..299) throw rejection(response.code, response.body, response.retryAfter)
        try {
            val body = JSONObject(response.body)
            val recording = body.getJSONObject("recording")
            if (body.opt("schemaVersion") != 1 || body.opt("groups") !is Boolean || recording.opt("entitled") !is Boolean || recording.opt("available") !is Boolean) throw KueError("unexpected_response")
            return KueProjectFeatures(body.getBoolean("groups"), recording.getBoolean("entitled"), recording.getBoolean("available"))
        } catch (_: Exception) { throw KueError("unexpected_response", retryable = true) }
    }

    fun status(receipt: KueReceipt, config: KueCloudConfig, development: Boolean, request: Request): KueReportStatus {
        val token = receipt.receiptToken
        if (!Regex("^report_[A-Za-z0-9_-]+$").matches(receipt.id) || token == null || !Regex("^[A-Za-z0-9_-]{43}$").matches(token)) throw KueError("invalid_report")
        val response = execute(config, development, request, "/v1/reports/${receipt.id}", token)
        if (response.code !in 200..299) throw KueError("unexpected_response", response.code == 429 || response.code >= 500, response.code, retryAfterMs = parseRetryAfter(response.retryAfter))
        try {
            val body = JSONObject(response.body)
            val id = body.opt("id") as? String
            val state = body.opt("status") as? String
            require(id == receipt.id && state in setOf("received", "queued", "creating_issue", "completed", "failed"))
            require(body.has("githubIssue"))
            val issue = if (body.isNull("githubIssue")) null else body.getJSONObject("githubIssue").let {
                val number = it.opt("number") as? Number ?: throw KueError("unexpected_response")
                val url = it.opt("url") as? String ?: throw KueError("unexpected_response")
                require(number.toDouble() == number.toInt().toDouble() && number.toInt() > 0 && Regex("^https://github\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/issues/[0-9]+$").matches(url))
                KueIssue(number.toInt(), url)
            }
            val code = if (body.has("error")) body.getJSONObject("error").opt("code") as? String ?: throw KueError("unexpected_response") else null
            return KueReportStatus(id!!, state!!, issue, code)
        } catch (_: Exception) { throw KueError("unexpected_response", retryable = true) }
    }

    private data class Response(val code: Int, val body: String, val retryAfter: String?)
    private fun execute(config: KueCloudConfig, development: Boolean, request: Request, path: String, token: String,
                        id: String? = null, boundary: String? = null, bytes: ByteArray? = null): Response {
        val endpoint = config.endpoint(development).toString()
        val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE)
            .proxyAuthenticator(Authenticator.NONE).followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).callTimeout(config.timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .connectTimeout(config.timeoutMs.toLong(), TimeUnit.MILLISECONDS).readTimeout(config.timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .writeTimeout(config.timeoutMs.toLong(), TimeUnit.MILLISECONDS).build()
        try {
            val builder = HttpRequest.Builder().url(endpoint.removeSuffix("/v1/reports") + path).header("Accept", "application/json")
                .header("Authorization", "Bearer $token")
            if (bytes != null) builder.header("Idempotency-Key", id!!).post(bytes.toRequestBody("multipart/form-data; boundary=$boundary".toMediaType())) else builder.get()
            val call = client.newCall(builder.build())
            request.call = call
            if (request.cancelled) { call.cancel(); throw KueError("request_cancelled", retryable = true) }
            call.execute().use { response ->
                if (response.code in 300..399) throw KueError("redirect_rejected", status = response.code)
                val body = readLimited(response.body?.byteStream())
                if (request.cancelled) throw KueError("request_cancelled", retryable = true)
                return Response(response.code, body, response.header("Retry-After"))
            }
        } catch (error: KueError) {
            throw error
        } catch (_: InterruptedIOException) {
            throw KueError(if (request.cancelled) "request_cancelled" else "request_timeout", retryable = true)
        } catch (_: Exception) {
            if (request.cancelled) throw KueError("request_cancelled", retryable = true)
            throw KueError("network_error", retryable = true)
        } finally {
            request.call = null
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
    }

    internal fun parseReceipt(clientReportId: String, body: String): KueReceipt {
        try {
            val json = JSONObject(body)
            val id = (json.opt("id") as? String)?.trim() ?: throw KueError("unexpected_response")
            val status = json.opt("status") as? String ?: throw KueError("unexpected_response")
            val token = if (json.has("receiptToken")) json.opt("receiptToken") as? String
                ?: throw KueError("unexpected_response") else null
            if (id.isEmpty() || status !in setOf("received", "queued") || (token != null && !Regex("^[A-Za-z0-9_-]{43}$").matches(token))) {
                throw KueError("unexpected_response", retryable = true, status = 202)
            }
            return KueReceipt(clientReportId, id, status, token)
        } catch (_: Exception) { throw KueError("unexpected_response", retryable = true, status = 202) }
    }

    private fun readLimited(stream: InputStream?): String {
        if (stream == null) return ""
        return stream.use {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (true) {
                val count = it.read(buffer)
                if (count < 0) break
                if (output.size() + count > 64 * 1024) throw KueError("unexpected_response", retryable = true)
                output.write(buffer, 0, count)
            }
            output.toString(Charsets.UTF_8.name())
        }
    }
}

/** Blocking transport API. Call on an application worker; the controller provides async UI operations. */
class KueCloudClient(context: Context, private val config: KueCloudConfig) {
    private val development = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
    init { config.endpoint(development) }
    @JvmOverloads fun getProjectFeatures(cancellation: KueCancellation = KueCancellation()): KueProjectFeatures = KueCloud.features(config, development, cancellation.request)
    @JvmOverloads fun getReportStatus(receipt: KueReceipt, cancellation: KueCancellation = KueCancellation()): KueReportStatus = KueCloud.status(receipt, config, development, cancellation.request)
    @JvmOverloads fun submitReport(report: KueReport, cancellation: KueCancellation = KueCancellation()): KueReceipt = KueCloud.submit(report, config, development, cancellation.request)
    @JvmOverloads fun submitGroup(group: KueReportGroup, cancellation: KueCancellation = KueCancellation()): KueReceipt = KueCloud.submitGroup(group, config, development, cancellation.request)
}

/** Cancels the actual HTTP call, including a call started after cancellation. Single operation only. */
class KueCancellation {
    internal val request = KueCloud.Request()
    val cancelled: Boolean get() = request.cancelled
    fun cancel() = request.cancel()
}
