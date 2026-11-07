package desi.creative.vitals.widgets.viz

import android.graphics.Canvas
import android.graphics.RectF
import desi.creative.vitals.widgets.design.Tokens
import kotlin.math.max

/**
 * The night on four levels (the web's `Hypnogram`): each stage run a rounded block in its stage colour on its row, awake on
 * top, a hairline stepping between the levels. A night the ring did not stage is one band, never a stage.
 */
internal object HypnogramPainter {
    private fun colour(stage: Int): Int = when (stage) {
        0 -> Tokens.STAGE_AWAKE
        1 -> Tokens.STAGE_REM
        2 -> Tokens.STAGE_LIGHT
        3 -> Tokens.STAGE_DEEP
        else -> Tokens.STAGE_UNSPECIFIED
    }

    fun draw(canvas: Canvas, box: PaintBox, spec: VizSpec.Hypnogram) {
        val d = box.dp
        val bh = max(4f * d, box.h / 4f * 0.46f)
        // a short run is a round dot, never a sliver: a block is at least as wide as 0.8 of its height
        val blocks = HypnogramGeometry.blocks(spec.spans, box.w, box.h, minWidth = bh * 0.8f)
        val link = VizPaint.stroke(VizPaint.alpha(box.lit, 0.28f), 1f * d)
        // the hairline first, so the blocks sit on it
        for (i in 0 until blocks.size - 1) {
            val a = blocks[i]
            val b = blocks[i + 1]
            if (a.centerY != b.centerY) canvas.drawLine(b.x, a.centerY, b.x, b.centerY, link)
        }
        for (b in blocks) {
            val r = RectF(b.x, b.centerY - bh / 2f, b.x + b.width, b.centerY + bh / 2f)
            val radius = minOf(r.width(), r.height()) / 2f
            canvas.drawRoundRect(r, radius, radius, VizPaint.fill(colour(b.stage)))
        }
    }
}
