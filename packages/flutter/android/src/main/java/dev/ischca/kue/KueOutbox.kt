package dev.ischca.kue

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

data class KuePendingReport(val clientReportId: String, val savedAt: Long, val state: String,
                            val attempts: Int, val nextAttemptAt: Long, val currentDestination: Boolean)

/** SDK-owned app-private, non-backup storage. No endpoint, project key or receipt token is persisted. */
internal class KueOutboxStore(private val root: File, private val now: () -> Long = System::currentTimeMillis) {
    data class Entry(val report: KueReport, val destination: String, val savedAt: Long, val attempts: Int = 0,
                     val nextAttemptAt: Long = 0, val blocked: Boolean = false)
    companion object {
        const val MAX_COUNT = 10
        const val MAX_BYTES = 50 * 1024 * 1024
        const val TTL_MS = 7L * 86400000
        private val lock = Any()
        private val running = mutableSetOf<String>()
        fun destination(config: KueCloudConfig, development: Boolean): String = digest(
            (config.endpoint(development).toString() + "\u0000" + config.projectKey.trim()).toByteArray(Charsets.UTF_8))
        private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    private fun directory(id: String): File {
        noLink(root)
        if (!Regex("^[A-Za-z0-9._~-]{16,128}$").matches(id)) throw KueError("invalid_report")
        val dir = File(root, "item-$id")
        noLink(dir)
        if (dir.canonicalFile.parentFile != root.canonicalFile) throw KueError("outbox_unreadable")
        return dir
    }

    fun list(): List<Entry> = synchronized(lock) {
        noLink(root)
        if (!root.exists()) return@synchronized emptyList()
        if (!root.isDirectory) throw KueError("outbox_unreadable")
        val entries = mutableListOf<Entry>()
        for (dir in root.listFiles().orEmpty()) {
            if (!dir.isDirectory || !dir.name.startsWith("item-")) continue
            noLink(dir)
            if (dir.canonicalFile.parentFile != root.canonicalFile) throw KueError("outbox_unreadable")
            val marker = File(dir, "report.json")
            noLink(marker)
            if (!marker.exists()) { deleteOwned(dir); continue }
            try {
                require(marker.length() in 1..65536)
                val original = JSONObject(readBounded(marker, 65536).toString(Charsets.UTF_8))
                val savedAt = original.getLong("savedAt")
                require(savedAt >= 0)
                if (now() - savedAt > TTL_MS && sendingKey(dir.name.removePrefix("item-")) !in running) { deleteOwned(dir); continue }
                val image = File(dir, "capture.jpg")
                noLink(image)
                require(image.canonicalFile.parentFile == dir.canonicalFile && image.length() in 1..10 * 1024 * 1024)
                val report = decode(original.getJSONObject("report"), readBounded(image, 10 * 1024 * 1024))
                require(report.clientReportId == dir.name.removePrefix("item-") && original.getString("fingerprint") == fingerprint(report))
                val destination = original.getString("destination")
                require(Regex("^[a-f0-9]{64}$").matches(destination))
                val stateFile = File(dir, "state.json")
                noLink(stateFile)
                val state = if (stateFile.exists() && stateFile.length() in 1..8192) runCatching { JSONObject(readBounded(stateFile, 8192).toString(Charsets.UTF_8)) }.getOrNull() else null
                val attempts = state?.optInt("attempts", 0) ?: 0
                val next = state?.optLong("nextAttemptAt", 0) ?: 0
                require(attempts >= 0 && next >= 0)
                entries.add(Entry(report, destination, savedAt, attempts, next, state?.optBoolean("blocked", false) ?: false))
            } catch (_: Exception) { throw KueError("outbox_unreadable") }
        }
        if (entries.size > MAX_COUNT || entries.sumOf { it.report.byteSize.toLong() } > MAX_BYTES) throw KueError("outbox_unreadable")
        entries.sortedBy { it.savedAt }
    }

    fun save(report: KueReport, destination: String): Entry = synchronized(lock) {
        val entries = list()
        entries.find { it.report.clientReportId == report.clientReportId }?.let {
            if (it.destination != destination || fingerprint(it.report) != fingerprint(report)) throw KueError("outbox_payload_changed")
            return@synchronized it
        }
        if (entries.size >= MAX_COUNT || entries.sumOf { it.report.byteSize.toLong() } + report.byteSize > MAX_BYTES) throw KueError("outbox_full")
        require(root.isDirectory || root.mkdirs())
        val dir = directory(report.clientReportId)
        require(dir.mkdirs())
        val entry = Entry(report, destination, now())
        try {
            writeAtomic(File(dir, "capture.jpg"), report.screenshotBytes)
            val marker = JSONObject().put("destination", destination).put("savedAt", entry.savedAt)
                .put("fingerprint", fingerprint(report)).put("report", snapshot(report))
            writeAtomic(File(dir, "report.json"), marker.toString().toByteArray(Charsets.UTF_8))
            entry
        } catch (error: Exception) { deleteOwned(dir); throw KueError("outbox_write_failed", retryable = true) }
    }

    fun failed(entry: Entry, error: KueError): Entry = synchronized(lock) {
        val attempt = entry.attempts.coerceIn(0, Int.MAX_VALUE - 2) + 1
        val backoff = (30000L * (1L shl (attempt - 1).coerceAtMost(7))).coerceAtMost(3600000)
        val timestamp = now().coerceAtLeast(0)
        val delay = maxOf(backoff, error.retryAfterMs ?: 0).coerceAtMost(Long.MAX_VALUE - timestamp)
        val updated = entry.copy(attempts = attempt, nextAttemptAt = timestamp + delay, blocked = !error.retryable)
        writeAtomic(File(directory(entry.report.clientReportId), "state.json"), JSONObject().put("attempts", attempt)
            .put("nextAttemptAt", updated.nextAttemptAt).put("blocked", updated.blocked).toString().toByteArray())
        updated
    }

    fun discard(id: String, destination: String? = null) = synchronized(lock) {
        val entry = list().find { it.report.clientReportId == id } ?: return@synchronized
        if (sendingKey(id) in running) throw KueError("outbox_sending")
        if (destination != null && entry.destination != destination) throw KueError("outbox_destination_mismatch")
        if (!deleteOwned(directory(id))) throw KueError("outbox_write_failed", retryable = true)
    }

    fun startSending(id: String) = synchronized(lock) { if (!running.add(sendingKey(id))) throw KueError("outbox_sending") }
    /** Recheck existence, destination and retry state immediately before owning an upload. */
    fun claimSending(id: String, destination: String, force: Boolean): Entry? = synchronized(lock) {
        if (sendingKey(id) in running) return@synchronized null
        val entry = list().find { it.report.clientReportId == id } ?: return@synchronized null
        if (entry.destination != destination || (!force && (entry.blocked || entry.nextAttemptAt > now()))) return@synchronized null
        running.add(sendingKey(id))
        entry
    }
    /** Cleanup after 202 retains ownership until deletion finishes; a failure leaves the same ID retryable. */
    fun accepted(id: String, destination: String) = synchronized(lock) {
        if (sendingKey(id) !in running) throw KueError("outbox_sending")
        val entry = list().find { it.report.clientReportId == id } ?: return@synchronized
        if (entry.destination != destination) throw KueError("outbox_destination_mismatch")
        if (!deleteOwned(directory(id))) throw KueError("outbox_write_failed", retryable = true)
    }
    fun stopSending(id: String) = synchronized(lock) { running.remove(sendingKey(id)); Unit }
    private fun sendingKey(id: String) = root.absolutePath + "/" + id

    private fun fingerprint(report: KueReport): String {
        val hash = MessageDigest.getInstance("SHA-256")
        listOf(report.clientReportId, report.memo, report.metadataJson).forEach { hash.update(it.toByteArray()); hash.update(0) }
        hash.update(report.screenshotBytes)
        return hash.digest().joinToString("") { "%02x".format(it) }
    }

    private fun snapshot(report: KueReport) = JSONObject().put("clientReportId", report.clientReportId).put("memo", report.memo)
        .put("metadata", JSONObject(report.metadataJson))

    private fun decode(snapshot: JSONObject, bytes: ByteArray): KueReport {
        val metadata = snapshot.getJSONObject("metadata")
        val capture = metadata.getJSONObject("capture")
        val context = metadata.getJSONObject("context")
        val crop = capture.getJSONObject("crop")
        fun size(name: String) = capture.getJSONObject(name).let { KueSize(it.getInt("width"), it.getInt("height")) }
        fun optional(name: String) = if (context.isNull(name)) null else context.opt(name) as? String ?: throw IllegalArgumentException()
        fun number(name: String) = if (context.isNull(name)) null else (context.opt(name) as? Number)?.toDouble() ?: throw IllegalArgumentException()
        val mimeType = capture.getString("mimeType")
        val platform = context.opt("platform") as? String ?: throw IllegalArgumentException()
        require(metadata.getInt("schemaVersion") == 1 && mimeType in setOf("image/jpeg", "image/png"))
        val capturedAt = capture.getString("capturedAt").also { java.time.Instant.parse(it) }
        return KueReport(snapshot.getString("clientReportId"), snapshot.getString("memo"), KueCrop(crop.getDouble("x"), crop.getDouble("y"), crop.getDouble("width"), crop.getDouble("height")),
            size("sourceSize"), size("outputSize"), KueContext(optional("osVersion"), optional("deviceModel"),
                optional("appVersion"), optional("buildNumber"), number("screenWidth"), number("screenHeight"), optional("route"), platform), capturedAt, bytes, mimeType)
    }

    private fun writeAtomic(file: File, bytes: ByteArray) {
        val temp = File(file.parentFile, file.name + ".tmp")
        noLink(file); noLink(temp)
        java.nio.channels.FileChannel.open(temp.toPath(), java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.WRITE,
            java.nio.file.StandardOpenOption.TRUNCATE_EXISTING, java.nio.file.LinkOption.NOFOLLOW_LINKS).use {
            val buffer = java.nio.ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) it.write(buffer); it.force(true)
        }
        try { Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING) }
        catch (_: java.nio.file.AtomicMoveNotSupportedException) { Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING) }
    }

    private fun noLink(file: File) { if (Files.isSymbolicLink(file.toPath())) throw KueError("outbox_unreadable") }
    private fun deleteOwned(dir: File): Boolean {
        noLink(root); noLink(dir)
        if (dir.canonicalFile.parentFile != root.canonicalFile) throw KueError("outbox_unreadable")
        // walkFileTree does not follow links: unexpected child links are removed, never traversed.
        Files.walkFileTree(dir.toPath(), object : java.nio.file.SimpleFileVisitor<java.nio.file.Path>() {
            override fun visitFile(file: java.nio.file.Path, attributes: java.nio.file.attribute.BasicFileAttributes): java.nio.file.FileVisitResult {
                Files.delete(file); return java.nio.file.FileVisitResult.CONTINUE
            }
            override fun postVisitDirectory(directory: java.nio.file.Path, error: java.io.IOException?): java.nio.file.FileVisitResult {
                if (error != null) throw error
                Files.delete(directory); return java.nio.file.FileVisitResult.CONTINUE
            }
        })
        return true
    }
    private fun readBounded(file: File, limit: Int): ByteArray {
        return Files.newInputStream(file.toPath(), java.nio.file.StandardOpenOption.READ, java.nio.file.LinkOption.NOFOLLOW_LINKS).use {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) { val count = it.read(buffer); if (count < 0) break; require(output.size() + count <= limit); output.write(buffer, 0, count) }
            output.toByteArray()
        }
    }
}
