package dev.ischca.kue

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** No font/emoji substitution: the same check, recording circle and upload arrow as Expo. */
internal class KueMenuIcon(context: Context, private val kind: String) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save(); canvas.translate(width / 2f, height / 2f); canvas.scale(resources.displayMetrics.density, resources.displayMetrics.density)
        paint.color = Color.WHITE; paint.strokeWidth = 2.5f; paint.style = Paint.Style.STROKE
        paint.strokeJoin = Paint.Join.ROUND; paint.strokeCap = Paint.Cap.ROUND
        when (kind) {
            "issue" -> canvas.drawPath(Path().apply { moveTo(-6f, 0f); lineTo(-1f, 5f); lineTo(8f, -8f) }, paint)
            "recording" -> {
                canvas.drawCircle(0f, 0f, 9f, paint); paint.style = Paint.Style.FILL
                paint.color = if (isSelected) Color.WHITE else Color.rgb(255, 91, 152); canvas.drawCircle(0f, 0f, 4f, paint)
            }
            else -> canvas.drawPath(Path().apply { moveTo(-6f, -1f); lineTo(0f, -7f); lineTo(6f, -1f); moveTo(0f, -7f); lineTo(0f, 8f) }, paint)
        }
        canvas.restore()
    }
}
