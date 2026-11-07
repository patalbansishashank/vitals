package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.viz.VizSpec

/** How a card is laid out (r071): the hero inside a ring, the hero above its picture, or the hero beside it. */
enum class CardLayout { RING, STACK, SIDE }

/**
 * Everything one card of a widget says, as plain data (the web card's slots: icon, title, hero, unit, meta, picture, foot
 * state and foot range). Built by `CardFormat` from the snapshot and the clock, drawn by `VitalsWidgets`; being data it is
 * unit tested, and quiet mode is a property of it: in quiet mode no field carries a digit.
 */
data class CardView(
    /** The registry id (`energy`): also the icon and the hue's owner. */
    val id: String,
    /** The domain hue (`energy`, `sleep`, `steps`, `heart`, `body`, `gold`). */
    val hue: String,
    val title: String,
    val layout: CardLayout,
    /** "as of 13:20" once the snapshot is old; quiet: "Updated earlier today". */
    val asOf: String? = null,
    /** The one figure; null in quiet mode or when it has no reading. */
    val hero: String? = null,
    /** Where the figure would be, in words (the quiet reading: "Goal met"). */
    val word: String? = null,
    val unit: String? = null,
    /** A line of facts in mono caps ("of 2 595 today", "23:14 – 07:37"). */
    val meta: String? = null,
    val viz: VizSpec? = null,
    /** The foot's left: where it stands in a word. */
    val state: String? = null,
    /** The foot's right: the range or the goal. */
    val range: String? = null,
    /** A sentence instead of a card (first open, a new day, quiet mode on, not paired): the hero and the picture give way to it. */
    val note: String? = null,
    /** What TalkBack reads for the whole widget. */
    val spoken: String,
    /** The tap target id (`WidgetLinks`). */
    val tap: String,
)

/** One ring of the Today glance: a small hero inside the ring, its label under it, its own tap. */
data class TrioCell(
    val id: String,
    val hue: String,
    val label: String,
    val hero: String?,
    val word: String?,
    val ratio: Double?,
    val tap: String,
    val spoken: String,
)

/** The Today glance: three rings (two in quiet mode: no energy) on a gold card. */
data class TrioView(
    val title: String,
    /** "Wed 28 Oct"; quiet: "Wed". */
    val dayLine: String,
    val asOf: String?,
    val cells: List<TrioCell>,
    val note: String?,
    val spoken: String,
)
