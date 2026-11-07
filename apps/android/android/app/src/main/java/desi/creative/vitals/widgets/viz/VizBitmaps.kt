package desi.creative.vitals.widgets.viz

import android.graphics.Bitmap
import android.graphics.Canvas
import desi.creative.vitals.widgets.design.HueColors
import desi.creative.vitals.widgets.design.Tokens
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A widget's picture as a bitmap for an ImageView: the one thing a RemoteViews cannot draw itself. Sized from the zone the
 * instance really has (dp, from its own options), capped, drawn by the pure painters (no text) and kept for a few
 * draws: an unchanged snapshot draws nothing new on the 30-minute update. Bitmaps in a RemoteViews count against a
 * budget of `6 * screenW * screenH` bytes (the Android 17 behaviour change: a warning at targetSdk 36, an exception from
 * 37), so `BitmapBudget` keeps the sum of a widget's far below it.
 */
object VizBitmaps {
    /** The longest side of a picture, pixels. */
    const val MAX_SIDE = 720

    /** What the process keeps of drawn pictures between redraws, bytes: a handful of small ones, never a screenful. */
    const val CACHE_BYTES = 4 * 1024 * 1024

    private data class Key(val spec: VizSpec, val hue: HueColors, val lit: Int, val w: Int, val h: Int)

    /** Least recently used first. */
    private val cache = LinkedHashMap<Key, Bitmap>(8, 0.75f, true)

    private fun keep(key: Key, bmp: Bitmap) {
        cache[key] = bmp
        var bytes = cache.values.sumOf { it.allocationByteCount.toLong() }
        val it = cache.entries.iterator()
        // evict the oldest until the rest fits (the newest picture always stays)
        while (bytes > CACHE_BYTES && cache.size > 1 && it.hasNext()) {
            val e = it.next()
            if (e.key == key) break
            bytes -= e.value.allocationByteCount
            it.remove()
        }
    }

    /** The painted bitmap of `spec` for a zone of `wDp` by `hDp` at `density`, scaled by `scale` (the budget's say). */
    fun render(spec: VizSpec, hue: HueColors, wDp: Float, hDp: Float, density: Float, scale: Float = 1f, lit: Int = Tokens.INK): Bitmap {
        val (w, h) = pixels(wDp, hDp, density, scale)
        val key = Key(spec, hue, lit, w, h)
        synchronized(cache) { cache[key]?.let { if (!it.isRecycled) return it } }
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val box = PaintBox(w.toFloat(), h.toFloat(), density * scale, hue, lit)
        val c = Canvas(bmp)
        when (spec) {
            is VizSpec.Ring -> RadialTicksPainter.draw(c, box, spec)
            is VizSpec.Line -> GlowLinePainter.draw(c, box, spec)
            is VizSpec.Bars -> HighlightBarsPainter.draw(c, box, spec)
            is VizSpec.Hypnogram -> HypnogramPainter.draw(c, box, spec)
        }
        synchronized(cache) { keep(key, bmp) }
        return bmp
    }

    /** The pixel size of a zone: no side over `MAX_SIDE` (the aspect kept), then scaled by the budget's say, at least 2 a side. */
    fun pixels(wDp: Float, hDp: Float, density: Float, scale: Float = 1f): Pair<Int, Int> {
        var w = wDp * density
        var h = hDp * density
        val over = max(w, h) / MAX_SIDE
        if (over > 1f) {
            w /= over
            h /= over
        }
        return max(2, (w * scale).roundToInt()) to max(2, (h * scale).roundToInt())
    }

    fun clearCache() = synchronized(cache) { cache.clear() }

    /** Bytes of the pictures kept now (tests, diagnostics). */
    fun cachedBytes(): Long = synchronized(cache) { cache.values.sumOf { it.allocationByteCount.toLong() } }
}

/**
 * The bitmap memory a RemoteViews may hold (the Android 17 behaviour change): `6 * width * height` bytes of the display.
 * A widget keeps its pictures under a quarter of that; past it the pictures are drawn at half the resolution, again as
 * needed, and below a quarter of the resolution not at all (the widget then shows its numbers and words only).
 */
object BitmapBudget {
    /** The system's limit for one RemoteViews, bytes. */
    fun limit(screenW: Int, screenH: Int): Long = 6L * screenW * screenH

    /** What one widget may spend: a quarter of the limit. */
    fun allowance(screenW: Int, screenH: Int): Long = limit(screenW, screenH) / 4

    /** Bytes of an ARGB_8888 bitmap. */
    fun bytes(w: Int, h: Int): Long = 4L * w * h

    /**
     * The scale (1, 1/2, 1/4) at which these zones (dp, at `density`) fit the allowance together, or null when even a
     * quarter of the resolution does not: draw no picture.
     */
    fun scaleFor(zonesDp: List<Pair<Float, Float>>, density: Float, screenW: Int, screenH: Int): Float? {
        for (scale in listOf(1f, 0.5f, 0.25f)) {
            val total = zonesDp.sumOf { (w, h) -> VizBitmaps.pixels(w, h, density, scale).let { bytes(it.first, it.second) } }
            if (total <= allowance(screenW, screenH)) return scale
        }
        return null
    }

    /** Never below 2 px a side. */
    internal fun side(x: Float): Int = max(2, min(VizBitmaps.MAX_SIDE, x.roundToInt()))
}
