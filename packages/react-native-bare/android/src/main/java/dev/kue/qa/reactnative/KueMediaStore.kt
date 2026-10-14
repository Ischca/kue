package dev.kue.qa.reactnative

import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardOpenOption
import java.util.UUID

/** Files exposed to JS are leases, not arbitrary paths. Persistent copies have a separate root. */
internal class KueMediaStore(private val root: File, private val callerRoots: List<File>) {
    private val callbacks = File(root, "callbacks")
    private val exports = File(root, "exports")
    private val leases = mutableMapOf<String, MutableSet<File>>()
    private var closed = false

    @Synchronized fun write(requestId: String, bytes: ByteArray, mime: String): String {
        check(!closed)
        require(bytes.size in 1..(20 * 1024 * 1024))
        directory(callbacks)
        val extension = when (mime) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "video/mp4" -> "mp4"; else -> error("invalid media") }
        val file = File(callbacks, "${UUID.randomUUID()}.$extension")
        Files.write(file.toPath(), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        leases.getOrPut(requestId) { mutableSetOf() }.add(file)
        return file.toPath().toUri().toASCIIString()
    }

    @Synchronized fun copy(requestId: String, uri: String): String {
        check(!closed)
        val file = parse(uri)
        require(leases[requestId]?.contains(file) == true)
        regular(file)
        directory(exports)
        val output = File(exports, "${UUID.randomUUID()}.${file.extension}")
        val bytes = readCaller(uri, 20 * 1024 * 1024)
        Files.write(output.toPath(), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        try { Files.write(File(exports, output.name + ".owned").toPath(), OWNED_MARKER.toByteArray(), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE) }
        catch (error: Exception) { Files.deleteIfExists(output.toPath()); throw error }
        return output.toPath().toUri().toASCIIString()
    }

    @Synchronized fun removeCopy(uri: String) {
        val file = parse(uri)
        directory(exports)
        require(file.parentFile == exports.absoluteFile && OWNED_NAME.matches(file.name))
        val marker = File(exports, file.name + ".owned")
        regular(marker)
        require(Files.size(marker.toPath()) == OWNED_MARKER.toByteArray().size.toLong())
        require(Files.newInputStream(marker.toPath(), LinkOption.NOFOLLOW_LINKS).use { it.readBytes().toString(Charsets.UTF_8) } == OWNED_MARKER)
        if (Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) { regular(file); Files.delete(file.toPath()) }
        Files.delete(marker.toPath())
    }

    /** Caller keeps ownership. No URI returned by a custom adapter or standalone caller is deleted. */
    @Synchronized fun readCaller(uri: String, limit: Int): ByteArray {
        check(!closed)
        val file = parse(uri)
        require(callerRoots.any { allowed ->
            val base = allowed.absoluteFile.toPath().normalize()
            file.toPath().startsWith(base) && file.toPath() != base
        })
        regular(file)
        require(Files.size(file.toPath()) in 1..limit.toLong())
        return Files.newInputStream(file.toPath(), LinkOption.NOFOLLOW_LINKS).use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) { val count = input.read(buffer); if (count < 0) break
                require(output.size() + count <= limit); output.write(buffer, 0, count) }
            output.toByteArray()
        }
    }

    @Synchronized fun release(requestId: String) { leases.remove(requestId)?.forEach { runCatching { noLinks(it); Files.deleteIfExists(it.toPath()) } } }
    @Synchronized fun close() { closed = true; leases.keys.toList().forEach(::release) }

    private fun parse(uri: String): File {
        require(uri.toByteArray().size <= 4096)
        val parsed = URI(uri)
        require(parsed.scheme == "file" && parsed.rawAuthority.isNullOrEmpty() && parsed.query == null && parsed.fragment == null)
        val file = File(parsed).absoluteFile
        require(file.toPath().normalize() == file.toPath())
        noLinks(file)
        return file
    }
    private fun noLinks(file: File) {
        val target = file.toPath()
        // Context supplies these trusted app-private roots. Android may expose them through
        // system-managed aliases; check the root itself and every descendant, not OS ancestors.
        val base = callerRoots.map { it.absoluteFile.toPath().normalize() }.filter { target.startsWith(it) }.maxByOrNull { it.nameCount }
        var path = base ?: target.root
        require(!Files.isSymbolicLink(path))
        val relative = if (base == null) target else base.relativize(target)
        for (part in relative) { path = path.resolve(part)
            require(!Files.isSymbolicLink(path)) }
    }
    private fun regular(file: File) { noLinks(file); require(Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS)) }
    private fun directory(file: File) {
        noLinks(file)
        Files.createDirectories(file.toPath())
        require(Files.isDirectory(file.toPath(), LinkOption.NOFOLLOW_LINKS))
    }
    companion object {
        private val OWNED_NAME = Regex("^[a-f0-9-]{36}\\.(jpg|png|mp4)$")
        private const val OWNED_MARKER = "kue-owned-copy-v1"
    }
}
