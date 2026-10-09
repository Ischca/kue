package dev.kue.recorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.WindowManager
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.math.roundToInt

/** Single-consent, foreground-only, silent surface recording. No microphone permission. */
class KueRecordingService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var recorder: MediaRecorder? = null
  private var file: File? = null
  private var started = false
  private var finished = false
  private var capturedAt = ""
  private var session: String? = null
  private val deadline = Runnable { finish(false) }
  private val callback = object : MediaProjection.Callback() {
    override fun onStop() { finish(false) }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "dev.kue.recorder.STOP") { finish(false); return START_NOT_STICKY }
    if (finished || started) return START_NOT_STICKY
    try {
      val token = intent?.getStringExtra("session")
      if (token == null || RecordingSession.id != token) { stopSelf(); return START_NOT_STICKY }
      session = token
      RecordingSession.service = this
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("kue-recording", "KUE screen recording", NotificationManager.IMPORTANCE_LOW))
      val stop = PendingIntent.getService(this, 0, Intent(this, KueRecordingService::class.java).setAction("dev.kue.recorder.STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "kue-recording") else Notification.Builder(this)
      val notification = builder.setContentTitle("KUE · Recording screen")
        .setContentText("Tap Stop to review. Audio is not recorded.")
        .setSmallIcon(android.R.drawable.presence_video_online).setOngoing(true)
        .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(0x4b5545, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      else startForeground(0x4b5545, notification)
      if (RecordingSession.stopping) { finish(RecordingSession.cancelled); return START_NOT_STICKY }
      @Suppress("DEPRECATION")
      val consent = requireNotNull(intent.getParcelableExtra<Intent>("consent"))
      val mediaManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      projection = requireNotNull(mediaManager.getMediaProjection(intent.getIntExtra("result", 0), consent))
      projection!!.registerCallback(callback, handler)
      val window = getSystemService(Context.WINDOW_SERVICE) as WindowManager
      @Suppress("DEPRECATION")
      val metrics = android.util.DisplayMetrics().also { window.defaultDisplay.getRealMetrics(it) }
      val scale = minOf(1.0, 1920.0 / maxOf(metrics.widthPixels, metrics.heightPixels))
      val width = ((metrics.widthPixels * scale).roundToInt() / 2 * 2).coerceAtLeast(2)
      val height = ((metrics.heightPixels * scale).roundToInt() / 2 * 2).coerceAtLeast(2)
      val directory = RecordingSession.directory(this).also { check(it.isDirectory || it.mkdirs()) }
      file = File(directory, "${UUID.randomUUID()}.mp4")
      @Suppress("DEPRECATION")
      val output = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else MediaRecorder()
      recorder = output
      output.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      output.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      output.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      output.setVideoSize(width, height); output.setVideoFrameRate(30); output.setVideoEncodingBitRate(1_600_000)
      output.setMaxDuration(59_500); output.setMaxFileSize(18L * 1024 * 1024)
      output.setOutputFile(file!!.absolutePath)
      output.setOnInfoListener { _, what, _ ->
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) handler.post { finish(false) }
      }
      output.setOnErrorListener { _, _, _ -> handler.post { finish(true) } }
      output.prepare()
      display = projection!!.createVirtualDisplay("KUE", width, height, metrics.densityDpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, output.surface, null, handler)
      output.start(); started = true
      capturedAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
      handler.postDelayed(deadline, 59_500)
    } catch (_: Exception) { finish(true) }
    return START_NOT_STICKY
  }

  internal fun finish(cancel: Boolean) {
    if (finished) return
    finished = true; handler.removeCallbacks(deadline)
    var valid = started && !cancel && !RecordingSession.cancelled
    try { if (started) recorder?.stop() } catch (_: Exception) { valid = false }
    started = false
    try { recorder?.reset(); recorder?.release() } catch (_: Exception) { valid = false }
    recorder = null
    display?.release(); display = null
    projection?.unregisterCallback(callback); projection?.stop(); projection = null
    val result = runCatching {
      check(valid) { "Recording was cancelled or could not be completed." }
      val output = requireNotNull(file)
      check(output.length() in 1..20L * 1024 * 1024) { "Recording exceeds 20 MiB." }
      val metadata = MediaMetadataRetriever()
      try {
        metadata.setDataSource(output.absolutePath)
        val duration = requireNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)).toInt()
        check(duration in 1..60_000) { "Recording exceeds 60 seconds." }
        mapOf<String, Any>("uri" to Uri.fromFile(output).toString(), "mimeType" to "video/mp4", "durationMs" to duration,
          "byteSize" to output.length(), "capturedAt" to capturedAt,
          "width" to requireNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)).toInt(),
          "height" to requireNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)).toInt())
      } finally { metadata.release() }
    }
    if (result.isFailure) file?.delete()
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    if (session != null && RecordingSession.id == session) RecordingSession.finish(result)
  }
  override fun onDestroy() { finish(true); super.onDestroy() }
}
