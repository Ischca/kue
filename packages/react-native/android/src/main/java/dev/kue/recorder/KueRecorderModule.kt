package dev.kue.recorder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class KueRecorderModule : Module() {
  private var session: String? = null
  private var requestCode = 0x4b00
  override fun definition() = ModuleDefinition {
    Name("KueRecorder")
    AsyncFunction("record") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || RecordingSession.id != null) {
        promise.reject("ERR_KUE_RECORDING", "Recording is unavailable or already in progress.", null)
      } else {
        requestCode = 0x4b00 + ((requestCode + 1) and 0xff)
        session = UUID.randomUUID().toString(); RecordingSession.id = session
        RecordingSession.completion = { result ->
          session = null
          result.fold({ promise.resolve(it) }, { promise.reject("ERR_KUE_RECORDING", it.message, it) })
        }
        try {
          val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
          activity.startActivityForResult(manager.createScreenCaptureIntent(), requestCode)
        } catch (error: Exception) { RecordingSession.finish(Result.failure(error)) }
      }
    }.runOnQueue(Queues.MAIN)
    OnActivityResult { activity, result ->
      if (result.requestCode == requestCode && session != null && RecordingSession.id == session) {
        if (result.resultCode != Activity.RESULT_OK || result.data == null || RecordingSession.stopping) {
          RecordingSession.finish(Result.failure(IllegalStateException("Screen recording was cancelled.")))
        } else {
          val intent = Intent(activity, KueRecordingService::class.java).putExtra("session", session)
            .putExtra("result", result.resultCode).putExtra("consent", result.data)
          try {
            if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
          } catch (error: Exception) { RecordingSession.finish(Result.failure(error)) }
        }
      }
    }
    AsyncFunction("stop") { stop(false) }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancel") { stop(true) }.runOnQueue(Queues.MAIN)
    AsyncFunction("preview") { uri: String ->
      val activity = requireNotNull(appContext.currentActivity) { "No current activity." }
      val file = RecordingSession.ownedFile(activity, uri)
      activity.startActivity(Intent(activity, KueVideoPreviewActivity::class.java).putExtra("uri", android.net.Uri.fromFile(file).toString()))
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground {
      // The consent activity also backgrounds the app, before the service exists.
      if (RecordingSession.service != null) stop(false)
    }
    OnDestroy { Handler(Looper.getMainLooper()).post { stop(true) } }
  }
  private fun stop(cancel: Boolean) {
    if (session == null || RecordingSession.id != session) return
    RecordingSession.stopping = true; RecordingSession.cancelled = RecordingSession.cancelled || cancel
    val service = RecordingSession.service
    if (service != null) service.finish(cancel)
    else RecordingSession.finish(Result.failure(IllegalStateException("Screen recording was cancelled.")))
  }
}
