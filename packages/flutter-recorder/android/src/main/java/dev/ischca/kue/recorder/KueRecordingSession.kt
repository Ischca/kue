package dev.ischca.kue.recorder

import dev.ischca.kue.*

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import java.io.File

internal object KueRecordingSession {
    val liveFiles = mutableSetOf<String>()
    var id: String? = null
    var locale = KueLocale.EN
    var completion: ((Result<KueRecordedVideo>) -> Unit)? = null
    var onStarted: (() -> Unit)? = null
    var service: KueRecordingService? = null
    var stopping = false
    var cancelled = false
    fun directory(context: Context) = File(context.cacheDir, "kue-recordings-native")
    fun finish(result: Result<KueRecordedVideo>) {
        result.getOrNull()?.let { liveFiles.add(it.file.absolutePath) }
        val callback = completion
        id = null; completion = null; onStarted = null; service = null; stopping = false; cancelled = false
        callback?.invoke(result)
    }
    fun stop(cancel: Boolean) {
        if (id == null) return
        stopping = true; cancelled = cancelled || cancel
        service?.finish(cancel) ?: finish(Result.failure(KueError("recording_cancelled")))
    }
}

class KueNativeRecorder : KueRecorder {
    override fun cleanupOrphans(context: Context) {
        val root = KueRecordingSession.directory(context)
        if (java.nio.file.Files.isSymbolicLink(root.toPath()) || !root.isDirectory) return
        KueRecordingSession.liveFiles.removeAll { !File(it).exists() }
        if (KueRecordingSession.id != null) return
        root.listFiles().orEmpty().filter { it.name.matches(Regex("^[A-Fa-f0-9-]{36}\\.mp4$")) && it.absolutePath !in KueRecordingSession.liveFiles }.forEach { it.delete() }
    }
    override fun release(video: KueRecordedVideo) { video.file.delete(); KueRecordingSession.liveFiles.remove(video.file.absolutePath) }
    override fun start(activity: Activity, locale: KueLocale, onStarted: () -> Unit,
                       completion: (Result<KueRecordedVideo>) -> Unit): KueRecordingHandle {
        if (KueRecordingSession.id != null) throw KueError("recording_busy")
        cleanupOrphans(activity)
        val id = java.util.UUID.randomUUID().toString()
        KueRecordingSession.id = id; KueRecordingSession.locale = locale
        KueRecordingSession.onStarted = onStarted; KueRecordingSession.completion = completion
        try { activity.startActivity(Intent(activity, KueRecordingConsentActivity::class.java).putExtra("session", id)) }
        catch (_: Exception) { KueRecordingSession.finish(Result.failure(KueError("recording_unavailable"))) }
        return object : KueRecordingHandle {
            override fun stop(cancel: Boolean) { if (KueRecordingSession.id == id) KueRecordingSession.stop(cancel) }
        }
    }
}

/** Owns a fresh platform consent request per session; host activities need no onActivityResult hook. */
class KueRecordingConsentActivity : Activity() {
    private var handedOff = false
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (state != null || intent.getStringExtra("session") != KueRecordingSession.id || KueRecordingSession.id == null) { finish(); return }
        try {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            // The app picker can relaunch a standard host Activity in a new task. In-app QA
            // records the default display and stops as soon as its own host loses foreground.
            val consent = if (Build.VERSION.SDK_INT >= 34)
                manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            else manager.createScreenCaptureIntent()
            @Suppress("DEPRECATION")
            startActivityForResult(consent, 0x4b5545)
        } catch (_: Exception) { KueRecordingSession.finish(Result.failure(KueError("recording_unavailable"))); finish() }
    }
    @Deprecated("Platform consent handoff")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 0x4b5545) return
        if (resultCode != RESULT_OK || data == null || KueRecordingSession.id == null || KueRecordingSession.stopping) {
            KueRecordingSession.finish(Result.failure(KueError("recording_cancelled")))
        } else {
            try {
                startForegroundService(Intent(this, KueRecordingService::class.java).putExtra("session", KueRecordingSession.id)
                    .putExtra("result", resultCode).putExtra("consent", data))
                handedOff = true
            } catch (_: Exception) { KueRecordingSession.finish(Result.failure(KueError("recording_unavailable"))) }
        }
        finish()
    }
    override fun onDestroy() {
        if (!handedOff && KueRecordingSession.id != null) KueRecordingSession.stop(true)
        super.onDestroy()
    }
}
