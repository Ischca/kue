package dev.kue.recorder

import android.content.Context
import android.net.Uri
import java.io.File

/** In-process ownership only. Contains no account, Expo, network or credential state. */
internal object RecordingSession {
  var id: String? = null
  var completion: ((Result<Map<String, Any>>) -> Unit)? = null
  var service: KueRecordingService? = null
  var stopping = false
  var cancelled = false

  fun finish(result: Result<Map<String, Any>>) {
    val callback = completion
    id = null; completion = null; service = null; stopping = false; cancelled = false
    callback?.invoke(result)
  }

  fun directory(context: Context) = File(context.cacheDir, "kue-recordings")
  fun ownedFile(context: Context, uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Invalid recording URI." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    val parent = file.parentFile
    val owned = parent == directory(context).canonicalFile || (parent?.parentFile == context.cacheDir.canonicalFile &&
      Regex("^kue-group-[A-Za-z0-9_-]+$").matches(parent.name))
    require(owned && file.extension == "mp4" && file.isFile) {
      "Recording is unavailable."
    }
    return file
  }
}
