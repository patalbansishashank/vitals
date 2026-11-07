package desi.creative.vitals.widgets.viz

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Path
import desi.creative.vitals.widgets.viz.GlowLineGeometry.Insets
import desi.creative.vitals.widgets.viz.GlowLineGeometry.Pt
import kotlin.math.max
import kotlin.math.min

/**
 * The smooth line with its live end (the web's `GlowLine`): a Catmull-Rom curve through the readings that never overshoots
 * between two of them (a running total must not wiggle), a soft glow under it in the hue, an ivory stroke, a dotted
 * forecast tail and the end dot with its two halos as the end frame of the animation. A gap breaks the line.
 */
internal object GlowLinePainter {
    fun draw(canvas: Canvas, box: PaintBox, spec: VizSpec.Line) {
        val s = spec.series
        val d = box.dp
        val inset = Insets(left = 7f * d, top = 9f * d, right = 9f * d, bottom = 9f * d)
        val glow = VizPaint.stroke(VizPaint.alpha(box.hue.solid, 0.34f), 6f * d).apply { maskFilter = BlurMaskFilter(5f * d, BlurMaskFilter.Blur.NORMAL) }
        val line = VizPaint.stroke(box.lit, 2.25f * d)
        for (run in GlowLineGeometry.runs(s.y, box.w, box.h, inset)) {
            val path = smooth(run)
            canvas.drawPath(path, glow)
            canvas.drawPath(path, line)
        }
        // the forecast: from the live end on, dotted, quieter
        s.ahead?.let { ahead ->
            val dots = VizPaint.stroke(VizPaint.alpha(box.lit, 0.42f), 2.2f * d).apply { pathEffect = DashPathEffect(floatArrayOf(0.01f, 5f * d), 0f) }
            for (run in GlowLineGeometry.runs(ahead, box.w, box.h, inset)) canvas.drawPath(smooth(run), dots)
        }
        GlowLineGeometry.end(s, box.w, box.h, inset)?.let { p ->
            canvas.drawCircle(p.x, p.y, 8.5f * d, VizPaint.stroke(VizPaint.alpha(box.lit, 0.34f), 1f * d))
            canvas.drawCircle(p.x, p.y, 4.5f * d, VizPaint.fill(box.lit))
        }
    }

    /** Through the points with Catmull-Rom tangents, the controls held between the neighbours' heights (no overshoot). */
    fun smooth(pts: List<Pt>): Path {
        val path = Path()
        if (pts.isEmpty()) return path
        path.moveTo(pts[0].x, pts[0].y)
        if (pts.size == 1) {
            path.lineTo(pts[0].x + 0.01f, pts[0].y)
            return path
        }
        for (i in 0 until pts.size - 1) {
            val p0 = pts[max(0, i - 1)]
            val p1 = pts[i]
            val p2 = pts[i + 1]
            val p3 = pts[min(pts.size - 1, i + 2)]
            val lo = min(p1.y, p2.y)
            val hi = max(p1.y, p2.y)
            val c1y = (p1.y + (p2.y - p0.y) / 6f).coerceIn(lo, hi)
            val c2y = (p2.y - (p3.y - p1.y) / 6f).coerceIn(lo, hi)
            path.cubicTo(p1.x + (p2.x - p0.x) / 6f, c1y, p2.x - (p3.x - p1.x) / 6f, c2y, p2.x, p2.y)
        }
        return path
    }
}
