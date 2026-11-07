package desi.creative.vitals.widgets

import kotlin.math.max
import kotlin.math.min

/**
 * How much room each part of a card has, from the widget's own size (dp). The layouts (res/layout/widget_card_*.xml) put
 * the same slots in the same places at every size: padding, a head row, a foot row, and the body between them. The
 * picture's bitmap and the hero's size are cut to these zones, so nothing is drawn for a space the widget does not have.
 */
object CardGeometry {
    const val PAD = 14f
    const val HEAD = 20f
    const val FOOT = 16f
    const val GAP = 4f

    /** Of the body's width the hero side takes in the wide card; the picture takes the rest. */
    const val SIDE_LEFT = 0.46f

    /** The hero row of the stacked card (the hero above its picture). */
    const val STACK_HERO = 46f

    /** A ring smaller than this is not drawn (a widget that small at a large system font): the figure takes the body instead. */
    const val MIN_RING = 36f

    /** A ring smaller than this has no room for its unit under the figure. */
    const val COMPACT_RING = 70f

    data class Zone(val w: Float, val h: Float)

    /** The head and the foot are rows of text: they grow with the system font (a line of 14 sp and one of 12 sp). */
    private fun chrome(fontScale: Float): Float = (HEAD + FOOT) * maxOf(1f, fontScale)

    fun bodyW(size: WidgetSize): Float = max(0f, size.widthDp - 2 * PAD)
    fun bodyH(size: WidgetSize, fontScale: Float = 1f): Float = max(0f, size.heightDp - 2 * PAD - chrome(fontScale) - 2 * GAP)

    /** The ring card's picture: a circle as large as the body allows. */
    fun ring(size: WidgetSize, fontScale: Float = 1f): Zone = min(bodyW(size), bodyH(size, fontScale)).let { Zone(it, it) }

    /** Is the ring big enough to draw? */
    fun ringShown(size: WidgetSize, fontScale: Float = 1f): Boolean = ring(size, fontScale).w >= MIN_RING

    /** The wide card's picture, beside the hero. */
    fun side(size: WidgetSize, fontScale: Float = 1f): Zone = Zone(max(0f, bodyW(size) * (1f - SIDE_LEFT) - 6f), bodyH(size, fontScale))

    /** The stacked card's picture, under the hero row. */
    fun stack(size: WidgetSize, fontScale: Float = 1f): Zone = Zone(bodyW(size), max(0f, bodyH(size, fontScale) - STACK_HERO * maxOf(1f, fontScale) - GAP))

    /** The picture's zone for a layout. */
    fun viz(layout: CardLayout, size: WidgetSize, fontScale: Float = 1f): Zone = when (layout) {
        CardLayout.RING -> ring(size, fontScale)
        CardLayout.SIDE -> side(size, fontScale)
        CardLayout.STACK -> stack(size, fontScale)
    }

    /** The width the hero may take: inside the ring (its inner two thirds; the whole body when the ring is too small to draw), beside the picture, or the whole stacked row. */
    fun heroWidth(layout: CardLayout, size: WidgetSize, fontScale: Float = 1f, ringUsed: Boolean = true): Float = when (layout) {
        CardLayout.RING -> if (ringUsed && ringShown(size, fontScale)) ring(size, fontScale).w * 0.64f else bodyW(size) * 0.9f
        CardLayout.SIDE -> bodyW(size) * SIDE_LEFT - 4f
        CardLayout.STACK -> bodyW(size) * 0.6f
    }

    /** The Today glance: does a cell keep the label under its ring (a short widget gives the room to the ring instead)? */
    fun trioLabels(size: WidgetSize, fontScale: Float = 1f): Boolean = size.heightDp - 2 * PAD - HEAD * maxOf(1f, fontScale) - 3 * GAP - 14f * maxOf(1f, fontScale) >= 56f

    /** The Today glance: three equal cells with a gap between them; each ring as large as its cell's body allows. */
    fun trioRing(size: WidgetSize, cells: Int, fontScale: Float = 1f): Float {
        val gap = 8f
        val cellW = (bodyW(size) - gap * (cells - 1)) / cells
        val label = if (trioLabels(size, fontScale)) (14f * maxOf(1f, fontScale) + GAP) else 0f
        val bodyH = max(0f, size.heightDp - 2 * PAD - HEAD * maxOf(1f, fontScale) - 2 * GAP - label)
        return min(cellW, bodyH)
    }

    /** The width a quiet word may take: inside the ring, beside the picture, or the whole stacked row. */
    fun wordWidth(layout: CardLayout, size: WidgetSize, fontScale: Float = 1f, ringUsed: Boolean = true): Float = heroWidth(layout, size, fontScale, ringUsed)
}

/** Fits a figure to the room it has: the largest size in sp, within a range, at which its measured width still fits. */
object TextFit {
    /** Does `text` wrap into at most `maxLines` lines of `widthPx` at `sp`, no word wider than a line, the lines fitting the height? */
    fun wordFits(text: String, sp: Float, widthPx: Float, maxLines: Int, measure: (String, Float) -> Float, fitsHeight: (lines: Int, sp: Float) -> Boolean = { _, _ -> true }): Boolean {
        if (!text.split(' ', '\n').filter { it.isNotEmpty() }.all { measure(it, sp) <= widthPx }) return false
        val lines = wrappedLines(text, widthPx) { measure(it, sp) }
        return lines <= maxLines && fitsHeight(lines, sp)
    }

    /**
     * The largest size in sp, within a range, at which `text` wraps into at most `maxLines` lines of `widthPx` (no word wider
     * than a line) and the lines fit the height. `measure(word, sp)` is a text's width at that size. Never below `minSp`.
     */
    fun fitWordSp(
        text: String,
        maxSp: Float,
        minSp: Float,
        widthPx: Float,
        maxLines: Int,
        measure: (String, Float) -> Float,
        /** Do `lines` lines at `sp` fit the height the text has? */
        fitsHeight: (lines: Int, sp: Float) -> Boolean = { _, _ -> true },
    ): Float {
        fun fits(sp: Float): Boolean = wordFits(text, sp, widthPx, maxLines, measure, fitsHeight)
        if (fits(maxSp)) return maxSp
        var lo = minSp
        var hi = maxSp
        while (hi - lo > 0.5f) {
            val mid = (lo + hi) / 2f
            if (fits(mid)) lo = mid else hi = mid
        }
        return lo
    }

    /** How many lines `text` takes when it wraps at word boundaries in `widthPx` (a hard break counts; a word wider than the line takes the line). */
    fun wrappedLines(text: String, widthPx: Float, measure: (String) -> Float): Int {
        var lines = 0
        for (paragraph in text.split('\n')) {
            var line = ""
            var count = 1
            for (word in paragraph.split(' ').filter { it.isNotEmpty() }) {
                val next = if (line.isEmpty()) word else "$line $word"
                if (line.isNotEmpty() && measure(next) > widthPx) {
                    count++
                    line = word
                } else {
                    line = next
                }
            }
            lines += count
        }
        return maxOf(1, lines)
    }

    /** `measurePx(sp)` is the text's width at that size; the search keeps half-sp steps. */
    fun fitSp(maxSp: Float, minSp: Float, availablePx: Float, measurePx: (Float) -> Float): Float {
        if (measurePx(maxSp) <= availablePx) return maxSp
        var lo = minSp
        var hi = maxSp
        // the largest size that fits, to half an sp; never below `minSp` (the text then ellipsizes rather than shrinks to nothing)
        while (hi - lo > 0.5f) {
            val mid = (lo + hi) / 2f
            if (measurePx(mid) <= availablePx) lo = mid else hi = mid
        }
        return lo
    }
}
