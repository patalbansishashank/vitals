package desi.creative.vitals.widgets.viz

import android.graphics.Canvas
import android.graphics.RectF

/**
 * Bars with the current one bright (the web's `HighlightBars`): the others in the hue's soft tint at 40 %, the current one
 * in the hue itself; round tops, a square base; an hour with no reading is no bar (never a zero bar).
 */
internal object HighlightBarsPainter {
    fun draw(canvas: Canvas, box: PaintBox, spec: VizSpec.Bars) {
        val d = box.dp
        val others = VizPaint.fill(VizPaint.alpha(box.hue.ink, 0.4f))
        val now = VizPaint.fill(box.hue.solid)
        val top = 2f * d
        for (b in BarsGeometry.bars(spec.series.y, spec.series.now, box.w, box.h - top, minHeight = 2f * d)) {
            VizPaint.topRounded(canvas, RectF(b.x, top + b.top, b.x + b.width, top + b.top + b.height), 3f * d, if (b.now) now else others)
        }
    }
}
