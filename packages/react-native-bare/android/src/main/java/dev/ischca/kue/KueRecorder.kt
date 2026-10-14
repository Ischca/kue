package dev.ischca.kue

import android.app.Activity
import java.io.File

/** Optional implementation lives in the separate android-recorder artifact. */
interface KueRecorder {
    fun cleanupOrphans(context: android.content.Context) {}
    fun release(video: KueRecordedVideo) { video.file.delete() }
    fun start(activity: Activity, locale: KueLocale, onStarted: () -> Unit,
              completion: (Result<KueRecordedVideo>) -> Unit): KueRecordingHandle
}
interface KueRecordingHandle { fun stop(cancel: Boolean = false) }
class KueRecordedVideo(val file: File, val durationMs: Int, val size: KueSize, val capturedAt: String) {
    override fun toString() = "KueRecordedVideo(durationMs=$durationMs, size=$size)"
}

internal fun optionalKueRecorder(): KueRecorder? = runCatching {
    Class.forName("dev.ischca.kue.recorder.KueNativeRecorder").getDeclaredConstructor().newInstance() as KueRecorder
}.getOrNull()
