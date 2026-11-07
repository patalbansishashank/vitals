package desi.creative.vitals.widgets.viz

import desi.creative.vitals.widgets.WidgetSnapshot.Series
import desi.creative.vitals.widgets.WidgetSnapshot.StageSpan

/**
 * What a widget's picture shows, as data: the painters draw only this and never any text (so a quiet picture cannot carry
 * a digit, and the numbers stay real TextViews that scale with the system font and are read by TalkBack). One kind per
 * data shape, as on the web card: progress toward a goal is a ring of ticks, an intraday series a line with a live end,
 * a daily series bars with the current one bright, the night a hypnogram.
 */
sealed interface VizSpec {
    /** Radial ticks lit to a ratio of the goal (past 1: all lit and a bright cap). */
    data class Ring(val ratio: Double) : VizSpec

    /** A smooth line with a live end; `series.ahead` is the dotted forecast. */
    data class Line(val series: Series) : VizSpec

    /** Bars scaled to the busiest, the series' `now` one bright. */
    data class Bars(val series: Series) : VizSpec

    /** The night on four levels, awake on top, in the stage colours. */
    data class Hypnogram(val spans: List<StageSpan>) : VizSpec
}
