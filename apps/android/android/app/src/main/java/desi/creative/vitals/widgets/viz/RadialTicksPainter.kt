package desi.creative.vitals.widgets.viz

import android.graphics.Canvas
import desi.creative.vitals.widgets.design.Tokens
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The ring of radial ticks (the web's `RadialTicks`): 72 ticks from 12 o'clock clockwise, every sixth longer, lit to the
 * ratio of the goal; past the goal every tick is lit and the first one becomes a bright cap in the hue. The number the
 * ring is about is a TextView laid over its middle, never part of this bitmap.
 */
internal object RadialTicksPainter {
    fun draw(canvas: Canvas, box: PaintBox, spec: VizSpec.Ring) {
        val cx = box.w / 2f
        val cy = box.h / 2f
        val r = min(box.w, box.h) / 2f - 2f * box.dp
        if (r <= 0f) return
        val width = max(1.4f * box.dp, r * 0.028f)
        val lit = VizPaint.stroke(box.lit, width)
        val unlit = VizPaint.stroke(Tokens.UNLIT, width)
        val cap = VizPaint.stroke(box.hue.solid, width * 1.25f)
        for (t in RadialTicksGeometry.ticks(spec.ratio)) {
            val a = Math.toRadians(t.angleDeg - 90.0)
            val len = when {
                t.cap -> r * 0.25f
                t.long -> r * 0.15f
                else -> r * 0.09f
            }
            val x0 = cx + cos(a).toFloat() * (r - len)
            val y0 = cy + sin(a).toFloat() * (r - len)
            val x1 = cx + cos(a).toFloat() * r
            val y1 = cy + sin(a).toFloat() * r
            canvas.drawLine(x0, y0, x1, y1, if (t.cap) cap else if (t.lit) lit else unlit)
        }
    }
}
