package com.pulseloop.shortvideo

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The top of the screen as the system reports it, in px: everything [IslandGeometry.of] sizes the pill from.
 * Read from the window metrics (status bar inset, display cutout), not guessed from the phone's model.
 */
data class IslandScreen(
    val width: Int,
    val height: Int,
    /** The status bar's height; 0 when the system did not say. */
    val statusBarHeight: Int,
    /** The top-edge cutout's bounding rect, or null for a phone without one. */
    val topCutout: IslandGeometry.Cutout?,
    val density: Float,
) {
    /** On its side the status bar and the camera hole are not where the pill goes. */
    val landscape: Boolean get() = width > height
}

/**
 * Where the pill sits and how big it is, from the real screen. Pure so the rules are testable. The pill is one
 * size, always: the count may change but never the pill.
 *
 * - A hole or notch in the middle of the top edge is wrapped: the pill is centred on it and hugs it with a small
 *   margin. The cutout's rect is not trusted for its height: the owner's OnePlus Nord 4 reports (as his screenshot
 *   of the old pill reads back) a rect 79 px wide and 139 px tall, the whole status bar, around its camera hole.
 *   The hole is as wide as the rect and no taller than it is wide.
 * - A hole in a corner, a cutout wider than 40 % of the screen (two holes merge into one wide rect) or no cutout
 *   at all: nothing to wrap, the pill sits top-centre in the status bar.
 * - The pill is never taller than the status bar unless the hole itself is, and never wider than 36 % of the
 *   screen, so the clock and the system icons stay readable.
 * - On its side (or with no size to go by) the screen has no island: [visible] is false and nothing is drawn.
 */
data class IslandGeometry(
    /** The pill's centre in screen px; the camera hole, when there is one, is at its middle. */
    val centerX: Int,
    val centerY: Int,
    /** The camera hole or notch the pill wraps, 0 when it wraps nothing. */
    val holeWidth: Int,
    val holeHeight: Int,
    /** The pill's height. */
    val height: Int,
    /** The most the pill may be, side to side. */
    val maxWidth: Int,
    val screenWidth: Int,
    val visible: Boolean = true,
) {
    /** A top cutout's bounds in screen px. */
    data class Cutout(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val width: Int get() = right - left
        val height: Int get() = bottom - top
        val centerX: Int get() = (left + right) / 2
        val centerY: Int get() = (top + bottom) / 2
    }

    /** Top edge of a window as tall as the pill, centred on it. */
    val top: Int get() = centerY - height / 2

    /** Left edge of a window [windowWidth] wide, centred on the pill and kept on the screen. */
    fun left(windowWidth: Int): Int = (centerX - windowWidth / 2).coerceIn(0, max(0, screenWidth - windowWidth))

    companion object {
        private const val MARGIN_DP = 4f      // between the hole and the pill's edge
        private const val TIGHT_DP = 2f       // the least margin when the hole leaves no room for more
        private const val EDGE_DP = 2f        // between the pill and the top of the screen or the status bar's bottom
        private const val MIN_HEIGHT_DP = 30f // never a sliver, also on a phone without a hole
        private const val MIN_SIDE_DP = 48f   // room for the brain and the count either side of a wide notch
        private const val DEFAULT_BAR_DP = 24f
        private const val MAX_WIDTH_SHARE = 0.36f
        private const val MAX_HOLE_SHARE = 0.4f
        private const val CENTRED_SHARE = 0.08f

        fun of(screen: IslandScreen): IslandGeometry {
            fun dp(v: Float) = (v * screen.density).roundToInt()
            val cutout = screen.topCutout
            val bar = if (screen.statusBarHeight > 0) screen.statusBarHeight else max(dp(DEFAULT_BAR_DP), cutout?.bottom ?: 0)
            val hole = cutout?.takeIf { wrappable(it, screen, bar) }
            val holeWidth = hole?.width ?: 0
            val holeHeight = hole?.let { min(it.height, it.width) } ?: 0

            val wanted = max(if (hole != null) holeHeight + 2 * dp(MARGIN_DP) else 0, dp(MIN_HEIGHT_DP))
            val room = bar - 2 * dp(EDGE_DP)
            val height = if (wanted <= room) wanted else max(room, holeHeight + 2 * dp(TIGHT_DP))
            val maxWidth = min(max((screen.width * MAX_WIDTH_SHARE).roundToInt(), holeWidth + 2 * dp(MIN_SIDE_DP)), screen.width)
            return IslandGeometry(
                centerX = hole?.centerX ?: (screen.width / 2),
                centerY = hole?.centerY ?: (bar / 2),
                holeWidth = holeWidth,
                holeHeight = holeHeight,
                height = height,
                maxWidth = maxWidth,
                screenWidth = screen.width,
                visible = screen.width > 0 && screen.height > 0 && !screen.landscape,
            )
        }

        /** A cutout in the status bar's band, in the middle of the top edge and not a wide merge of several. */
        private fun wrappable(cutout: Cutout, screen: IslandScreen, bar: Int): Boolean =
            cutout.width > 0 && cutout.height > 0 && cutout.top < bar &&
                cutout.width <= screen.width * MAX_HOLE_SHARE &&
                abs(cutout.centerX - screen.width / 2) <= screen.width * CENTRED_SHARE

        /**
         * The pill's width for a brain and a count column of the given widths: with a hole, both sides as wide as the
         * wider one so the hole stays in the middle; without one, the two side by side.
         */
        fun pillWidth(hole: Float, brain: Float, text: Float, pad: Float, gap: Float): Float =
            if (hole > 0f) hole + 2 * (pad + gap + max(brain, text)) else 2 * pad + gap + brain + text

        /** The factor (at most 1) that shrinks something [needed] long to fit in [available]. */
        fun fitScale(available: Float, needed: Float): Float =
            if (needed <= 0f || available >= needed) 1f else max(available, 0f) / needed
    }
}
