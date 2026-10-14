package dev.ischca.kue

import android.app.Activity
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper

internal class KueShakeDetector(private val now: () -> Long = System::currentTimeMillis) {
    private var first = Long.MIN_VALUE / 2
    private var last = Long.MIN_VALUE / 2
    private var high = false
    fun sample(x: Double, y: Double, z: Double): Boolean {
        val strength = kotlin.math.sqrt(x * x + y * y + z * z)
        if (!strength.isFinite()) return false
        if (strength < 1.5) { high = false; return false }
        if (strength < 2.3 || high) return false
        high = true
        val time = now()
        if (time - last < 2500) return false
        if (time - first in 100..900) { first = Long.MIN_VALUE / 2; last = time; return true }
        first = time; return false
    }
}

/** Explicit opt-in accelerometer source. Does not change application sensor settings. */
class KueShakeTrigger(private val activity: Activity) : KueTriggerSource {
    override fun subscribe(open: () -> Unit): () -> Unit {
        val manager = activity.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return {}
        val detector = KueShakeDetector { android.os.SystemClock.elapsedRealtime() }
        val listener = object : SensorEventListener {
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
            override fun onSensorChanged(event: SensorEvent) {
                if (event.values.size >= 3 && detector.sample(event.values[0] / 9.80665, event.values[1] / 9.80665, event.values[2] / 9.80665)) open()
            }
        }
        manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME, Handler(Looper.getMainLooper()))
        return { manager.unregisterListener(listener) }
    }
}

/** Android14+ screenshot event only. Never reads a screenshot/photo-library file. */
class KueSystemScreenshotTrigger(private val activity: Activity) : KueTriggerSource {
    override fun subscribe(open: () -> Unit): () -> Unit {
        if (Build.VERSION.SDK_INT < 34) throw KueError("system_screenshot_unavailable")
        val callback = Activity.ScreenCaptureCallback { open() }
        activity.registerScreenCaptureCallback(activity.mainExecutor, callback)
        return { activity.unregisterScreenCaptureCallback(callback) }
    }
}
