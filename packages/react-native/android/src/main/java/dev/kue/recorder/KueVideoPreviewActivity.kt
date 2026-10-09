package dev.kue.recorder

import android.app.Activity
import android.os.Bundle
import android.widget.MediaController
import android.widget.VideoView

class KueVideoPreviewActivity : Activity() {
  private var video: VideoView? = null
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    try {
      val file = RecordingSession.ownedFile(this, requireNotNull(intent.getStringExtra("uri")))
      video = VideoView(this).also {
        setContentView(it); it.setVideoPath(file.absolutePath)
        it.setMediaController(MediaController(this).apply { setAnchorView(it) })
        it.setOnPreparedListener { _ -> it.start() }
      }
    } catch (_: Exception) { finish() }
  }
  override fun onPause() { video?.pause(); super.onPause() }
  override fun onDestroy() { video?.stopPlayback(); super.onDestroy() }
}
