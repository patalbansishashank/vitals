package desi.creative.vitals.widgets.viz

import desi.creative.vitals.widgets.WidgetSnapshot.Series
import desi.creative.vitals.widgets.WidgetSnapshot.StageSpan
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The geometry of every picture, with no Android class in it: the painters (`*Painter`) only turn these numbers into
 * strokes, so the numbers (tick angles and lit counts, the points of a line, a bar's rectangle, a stage run's block) are
 * unit tested on a plain JVM. All lengths are in the units of the box they are given (the painter passes pixels).
 */
object RadialTicksGeometry {
    const val TICKS = 72
    const val LONG_EVERY = 6

    /** `angleDeg` clockwise from 12 o'clock; `cap`: the bright mark of a goal that is passed. */
    data class Tick(val angleDeg: Double, val lit: Boolean, val long: Boolean, val cap: Boolean)

    /** How many of the 72 ticks are lit for a ratio of the goal (0 to 1; anything past 1 lights them all). */
    fun litCount(ratio: Double): Int = if (!ratio.isFinite()) 0 else (ratio.coerceIn(0.0, 1.0) * TICKS).roundToInt()

    fun ticks(ratio: Double): List<Tick> {
        val lit = litCount(ratio)
        val past = ratio.isFinite() && ratio > 1.0001
        return List(TICKS) { i -> Tick(angleDeg = i * 360.0 / TICKS, lit = i < lit, long = i % LONG_EVERY == 0, cap = past && i == 0) }
    }
}

object GlowLineGeometry {
    data class Pt(val x: Float, val y: Float)

    /** The room a line keeps inside its box so its live end and halo are never cut. */
    data class Insets(val left: Float, val top: Float, val right: Float, val bottom: Float)

    /** The point of each reading, run by run (a gap breaks the line: never bridged, never zero). */
    fun runs(y: List<Double?>, w: Float, h: Float, inset: Insets): List<List<Pt>> {
        val plotW = max(0f, w - inset.left - inset.right)
        val plotH = max(0f, h - inset.top - inset.bottom)
        val out = ArrayList<MutableList<Pt>>()
        var cur: MutableList<Pt>? = null
        y.forEachIndexed { i, v ->
            if (v == null) {
                cur = null
            } else {
                val x = inset.left + if (y.size == 1) plotW / 2 else plotW * i / (y.size - 1)
                val p = Pt(x, inset.top + plotH * (1f - v.toFloat().coerceIn(0f, 1f)))
                val c = cur ?: ArrayList<Pt>().also { out.add(it); cur = it }
                c.add(p)
            }
        }
        return out
    }

    /** The live end: the series' `now` when it holds a reading, else the last reading. */
    fun endIndex(s: Series): Int? {
        s.now?.let { if (it in s.y.indices && s.y[it] != null) return it }
        return s.y.indices.lastOrNull { s.y[it] != null }
    }

    /** The point of the live end. */
    fun end(s: Series, w: Float, h: Float, inset: Insets): Pt? {
        val i = endIndex(s) ?: return null
        return runs(List(s.y.size) { if (it == i) s.y[it] else null }, w, h, inset).firstOrNull()?.firstOrNull()
    }
}

object BarsGeometry {
    /** A bar's rectangle in the box (`top` from the box's top edge), and whether it is the current one. */
    data class Bar(val x: Float, val width: Float, val top: Float, val height: Float, val now: Boolean)

    /** One bar per reading, none for a gap; heights are the 0..1 values of the box above `minHeight`, which a non-zero reading keeps. */
    fun bars(y: List<Double?>, now: Int?, w: Float, h: Float, gapRatio: Float = 0.38f, minHeight: Float = 2f): List<Bar> {
        if (y.isEmpty()) return emptyList()
        val slot = w / y.size
        val bw = slot * (1f - gapRatio)
        val out = ArrayList<Bar>()
        y.forEachIndexed { i, v ->
            if (v == null) return@forEachIndexed
            val bh = if (v <= 0.0) 0f else max(minHeight, (v.toFloat().coerceIn(0f, 1f)) * h)
            if (bh > 0f) out.add(Bar(i * slot + (slot - bw) / 2f, bw, h - min(bh, h), min(bh, h), i == now))
        }
        return out
    }
}

object HypnogramGeometry {
    /** The row of a stage, awake on top: awake 0, REM 1, light 2, deep 3; a night with no stage is one band between light and REM. */
    fun rowOf(stage: Int): Float = when (stage) {
        0 -> 0f
        1 -> 1f
        2 -> 2f
        3 -> 3f
        else -> 1.5f
    }

    /** A run as a block in the box: where it starts, how long it is (never under `minWidth`), and the centre of its row. */
    data class Block(val x: Float, val width: Float, val centerY: Float, val stage: Int)

    fun blocks(spans: List<StageSpan>, w: Float, h: Float, minWidth: Float = 2f): List<Block> {
        val rowH = h / 4f
        return spans.sortedBy { it.from }.map { s ->
            val x = (s.from * w).toFloat()
            Block(x, max(minWidth, ((s.to - s.from) * w).toFloat()), rowH * (rowOf(s.stage) + 0.5f), s.stage)
        }
    }
}
