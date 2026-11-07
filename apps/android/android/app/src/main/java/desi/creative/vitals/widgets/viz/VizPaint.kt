package desi.creative.vitals.widgets.viz

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.core.graphics.ColorUtils
import desi.creative.vitals.widgets.design.HueColors

/** Shared bits of the painters: strokes and fills with the app's marks, and a colour with its alpha changed. */
internal object VizPaint {
    fun stroke(color: Int, width: Float, round: Boolean = true): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = width
        this.color = color
        if (round) {
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
    }

    fun fill(color: Int): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        this.color = color
    }

    /** `color` at `alpha` (0..1) of its own alpha. */
    fun alpha(color: Int, alpha: Float): Int = ColorUtils.setAlphaComponent(color, (android.graphics.Color.alpha(color) * alpha.coerceIn(0f, 1f)).toInt())

    /** A rectangle with only its top corners rounded (a bar's cap, square at the base). */
    fun topRounded(c: Canvas, r: RectF, radius: Float, paint: Paint) {
        val rr = minOf(radius, r.width() / 2f, r.height())
        val p = Path().apply { addRoundRect(r, floatArrayOf(rr, rr, rr, rr, 0f, 0f, 0f, 0f), Path.Direction.CW) }
        c.drawPath(p, paint)
    }
}

/** What a painter needs besides the spec: the box, the pixel density (one dp is this many pixels) and the hue. */
internal class PaintBox(val w: Float, val h: Float, val dp: Float, val hue: HueColors, val lit: Int)
