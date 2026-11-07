package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.WidgetFormat.DASH
import desi.creative.vitals.widgets.WidgetFormat.Words
import desi.creative.vitals.widgets.viz.VizSpec
import java.time.ZoneId

/**
 * What each widget says, from the snapshot, the clock and the widget's size class (r071). Pure (java.time only), so it is
 * unit tested for every card, size and mode. Native only draws what it is given, as the web card would: it never works a
 * figure out (the one exception worth a port, "Next up", is not built yet).
 *
 * Rules every card keeps:
 *  - never another day's figures as today's ("Open Vitals to see today");
 *  - quiet mode (owner, r071 Q8): words and parts of the day, no digit in any text or spoken sentence, no energy, no
 *    line or bar (the ratio rings and the night's hypnogram stay: the app draws those in quiet mode too);
 *  - an estimate carries its range on every size;
 *  - instants are clock times that stay true on a home screen nobody refreshes, never "5 min ago".
 */
object CardFormat {
    private const val EN_DASH = "–"

    private fun spoken(vararg parts: String?): String = parts.filterNotNull().filter { it.isNotBlank() }.joinToString(", ")

    private fun asOf(s: WidgetSnapshot?, now: Long, zone: ZoneId): String? = s?.let { WidgetFormat.asOf(it.at, now, zone, it.quiet) }

    /**
     * The sentence a Today card shows instead of figures when it has none for today, or null when it has. The app's day rolls
     * over at 04:00, so the figures are today's until the instant the web said the day ends; an older bundle did not say,
     * and the calendar day decides.
     */
    private fun todayNote(s: WidgetSnapshot?, now: Long, zone: ZoneId): String? {
        val t = s?.today ?: return Words.FIRST_OPEN
        val over = if (t.until != null) now >= t.until else t.date != WidgetFormat.dayOf(now, zone)
        return if (over) Words.NEW_DAY else null
    }

    private fun layoutOf(cls: SizeClass, ring: Boolean): CardLayout = when {
        cls != SizeClass.SQUARE -> CardLayout.SIDE
        ring -> CardLayout.RING
        else -> CardLayout.STACK
    }

    /** A card with a sentence in place of its figure. */
    private fun noteCard(id: String, hue: String, title: String, layout: CardLayout, note: String, asOf: String?, tap: String): CardView =
        CardView(id = id, hue = hue, title = title, layout = layout, asOf = asOf, note = note, spoken = spoken("Vitals $title", note, asOf), tap = tap)

    // ------------------------------------------------------------------------------------------------- Energy

    fun energy(s: WidgetSnapshot?, now: Long, zone: ZoneId, cls: SizeClass): CardView {
        val layout = layoutOf(cls, ring = true)
        val asOf = asOf(s, now, zone)
        if (s == null || s.today == null) return noteCard("energy", "energy", Words.ENERGY, layout, Words.FIRST_OPEN, asOf, "energy")
        // quiet mode: nothing about energy (the app removes the whole card), so the widget only says why
        if (s.quiet) return noteCard("energy", "energy", Words.ENERGY, layout, Words.QUIET_ON, asOf, "energy")
        todayNote(s, now, zone)?.let { return noteCard("energy", "energy", Words.ENERGY, layout, it, asOf, "energy") }
        val e = s.today.energy
        return CardView(
            id = "energy",
            hue = "energy",
            title = Words.ENERGY,
            layout = layout,
            asOf = asOf,
            hero = e?.value ?: DASH,
            unit = e?.unit,
            // the likely day: "of 2 595 today" beside the figure (the wide card has the room; the ring's foot has the range)
            meta = if (layout == CardLayout.SIDE) e?.likely?.let { "${Words.OF} $it today" } else null,
            viz = if (layout == CardLayout.RING) e?.ratio?.let { VizSpec.Ring(it) } else e?.series?.let { VizSpec.Line(it) },
            state = e?.state,
            range = e?.range,
            spoken = spoken("Vitals Energy", e?.let { "${it.value} ${it.unit} so far" }, e?.state, e?.range?.let { "likely ${it}" }, asOf),
            tap = "energy",
        )
    }

    // ------------------------------------------------------------------------------------------------- Sleep

    fun sleep(s: WidgetSnapshot?, now: Long, zone: ZoneId, cls: SizeClass): CardView {
        val layout = layoutOf(cls, ring = true)
        val asOf = asOf(s, now, zone)
        todayNote(s, now, zone)?.let { return noteCard("sleep", "sleep", Words.SLEEP, layout, it, asOf, "sleep") }
        val quiet = s!!.quiet
        val sl = s.today!!.sleep
        val word = WidgetFormat.cap(sl?.word)
        val hero = if (quiet) null else sl?.value
        val onset = sl?.onset
        val wake = sl?.wake
        val meta = if (layout != CardLayout.SIDE) null else when {
            // quiet: parts of the day on two short lines ("late evening / to early morning"), never clock times
            onset != null && wake != null -> if (quiet) "${WidgetFormat.partOfDayNoun(onset, zone)}\nto ${WidgetFormat.partOfDayNoun(wake, zone)}" else "${WidgetFormat.clock(onset, zone)} $EN_DASH ${WidgetFormat.clock(wake, zone)}"
            else -> null
        }
        val ring = sl?.ratio?.let { VizSpec.Ring(it) }
        val viz: VizSpec? = if (layout == CardLayout.RING) ring else sl?.stages?.let { VizSpec.Hypnogram(it) } ?: ring
        return CardView(
            id = "sleep",
            hue = "sleep",
            title = Words.SLEEP,
            layout = layout,
            asOf = asOf,
            hero = hero ?: if (word == null) DASH else null,
            // quiet: the goal's word stands where the figure would be, and says it once
            word = if (quiet) word else null,
            meta = meta,
            viz = viz,
            state = if (quiet) null else word,
            range = if (quiet) null else sl?.goal,
            spoken = spoken("Vitals Sleep", if (quiet) word else sl?.value?.let { "$it asleep" }, if (quiet) null else word, if (quiet) null else sl?.goal?.let { "goal $it" }, asOf),
            tap = "sleep",
        )
    }

    // ------------------------------------------------------------------------------------------------- Steps

    fun steps(s: WidgetSnapshot?, now: Long, zone: ZoneId, cls: SizeClass): CardView {
        val layout = layoutOf(cls, ring = true)
        val asOf = asOf(s, now, zone)
        todayNote(s, now, zone)?.let { return noteCard("steps", "steps", Words.STEPS, layout, it, asOf, "steps") }
        val quiet = s!!.quiet
        val st = s.today!!.steps
        val word = WidgetFormat.cap(st?.word)
        val ring = st?.ratio?.let { VizSpec.Ring(it) }
        // quiet mode draws no bars: the ring by ratio is what the app shows there
        val viz: VizSpec? = if (layout == CardLayout.RING || quiet) ring else st?.series?.let { VizSpec.Bars(it) } ?: ring
        val hero = if (quiet) null else st?.value
        return CardView(
            id = "steps",
            hue = "steps",
            title = Words.STEPS,
            layout = layout,
            asOf = asOf,
            hero = hero,
            word = if (quiet) word else null,
            unit = if (!quiet && st?.value != null) "steps" else null,
            meta = if (layout == CardLayout.SIDE && !quiet) st?.likely?.let { "${Words.LIKELY} $it" } else null,
            viz = viz,
            state = st?.state,
            range = if (quiet) null else st?.goal?.let { "${Words.OF} $it" },
            spoken = spoken("Vitals Steps", if (quiet) word else st?.value?.let { "$it steps" }, st?.state, if (quiet) null else st?.goal?.let { "goal $it" }, asOf),
            tap = "steps",
        ).let { if (it.hero == null && it.word == null) it.copy(hero = DASH) else it }
    }

    // ------------------------------------------------------------------------------------------------- Heart rate (the Ring provider)

    fun heart(s: WidgetSnapshot?, now: Long, zone: ZoneId, cls: SizeClass): CardView {
        val layout = layoutOf(cls, ring = false)
        val asOf = asOf(s, now, zone)
        val r = s?.ring
        val note = when {
            s == null || r == null -> Words.FIRST_OPEN
            r.state == "unpaired" -> Words.UNPAIRED
            r.state == "unreachable" && r.hr == null && r.battery == null -> Words.UNREACHABLE
            r.state == "empty" && r.hr == null && r.battery == null -> Words.EMPTY
            else -> null
        }
        if (note != null) return noteCard("ring", "heart", Words.HEART_RATE, layout, note, asOf, "hr")
        val quiet = s!!.quiet
        val hr = r!!.hr
        val bat = r.battery
        val at = hr?.let { WidgetFormat.at(it.at, now, zone) }
        // the ring's battery, with its age once the reading is over two hours old (a days-old 64 % must not read as current)
        val batteryFact = if (quiet) null else bat?.value?.let { v -> listOfNotNull("${Words.BATTERY} $v %", bat.at?.let { WidgetFormat.batteryAge(it, now, false) }).joinToString(" · ") }
        return CardView(
            id = "ring",
            hue = "heart",
            title = Words.HEART_RATE,
            layout = layout,
            asOf = asOf,
            hero = if (quiet) null else hr?.value ?: DASH,
            word = if (quiet && hr != null) "${Words.MEASURED} ${WidgetFormat.quietAgeAt(hr.at, now, zone)}" else if (quiet) DASH else null,
            unit = if (quiet || hr?.value == null) null else hr.unit,
            // when it was measured (a clock time on a home screen that is not redrawn), and on the wide card the ring's battery
            meta = if (quiet) null else listOfNotNull(at, if (layout == CardLayout.SIDE) batteryFact else null).joinToString(" · ").takeIf { it.isNotEmpty() },
            viz = if (quiet) null else hr?.series?.let { VizSpec.Line(it) },
            state = hr?.state,
            range = if (quiet) null else hr?.range,
            spoken = spoken("Vitals Heart rate", if (quiet) hr?.let { "measured ${WidgetFormat.quietAgeAt(it.at, now, zone)}" } else hr?.value?.let { "$it ${hr.unit}" }, hr?.state, if (quiet) null else at, asOf),
            tap = "hr",
        )
    }

    // ------------------------------------------------------------------------------------------------- Weight (opt-in)

    fun weight(s: WidgetSnapshot?, now: Long, zone: ZoneId, cls: SizeClass): CardView {
        val layout = layoutOf(cls, ring = false)
        val asOf = asOf(s, now, zone)
        if (s == null) return noteCard("weight", "body", Words.WEIGHT, layout, Words.FIRST_OPEN, asOf, "weight")
        // no body part: the person has not turned weight on for the home screen (the web app sends none then)
        val body = s.body ?: return noteCard("weight", "body", Words.WEIGHT, layout, Words.WEIGHT_OFF, asOf, "weight")
        val w = body.weight ?: return noteCard("weight", "body", Words.WEIGHT, layout, Words.WEIGHT_NONE, asOf, "weight")
        val quiet = s.quiet
        val state = WidgetFormat.weightState(w.state)
        return CardView(
            id = "weight",
            hue = "body",
            title = Words.WEIGHT,
            layout = layout,
            asOf = asOf,
            hero = if (quiet) null else w.value ?: DASH,
            // quiet mode: the trend as a word only
            word = if (quiet) state ?: DASH else null,
            unit = if (quiet || w.value == null) null else w.unit,
            viz = if (quiet) null else w.series?.let { VizSpec.Line(it) },
            state = if (quiet) null else state,
            spoken = spoken("Vitals Weight", if (quiet) state else w.value?.let { "trend $it ${w.unit}" }, if (quiet) null else state, asOf),
            tap = "weight",
        )
    }

    // ------------------------------------------------------------------------------------------------- Today glance

    fun trio(s: WidgetSnapshot?, now: Long, zone: ZoneId): TrioView {
        val asOf = asOf(s, now, zone)
        val quiet = s?.quiet == true
        val title = Words.TODAY
        val dayLine = WidgetFormat.dayLine(now, zone, quiet)
        val note = todayNote(s, now, zone)
        if (note != null) return TrioView(title, dayLine, asOf, emptyList(), note, spoken("Vitals $title", note, asOf))
        val t = s!!.today!!
        val cells = ArrayList<TrioCell>(3)
        val st = t.steps
        cells += TrioCell(
            id = "steps", hue = "steps", label = Words.STEPS,
            hero = if (quiet) null else st?.value ?: DASH,
            word = if (quiet) WidgetFormat.cap(st?.word) ?: DASH else null,
            ratio = st?.ratio, tap = "steps",
            spoken = spoken(Words.STEPS, if (quiet) WidgetFormat.cap(st?.word) else st?.value),
        )
        // quiet mode: no energy at all, so two rings
        if (!quiet) {
            val e = t.energy
            cells += TrioCell(id = "energy", hue = "energy", label = Words.ENERGY, hero = e?.value ?: DASH, word = null, ratio = e?.ratio, tap = "energy", spoken = spoken(Words.ENERGY, e?.let { "${it.value} ${it.unit}" }, e?.state))
        }
        val sl = t.sleep
        cells += TrioCell(
            id = "sleep", hue = "sleep", label = Words.SLEEP,
            hero = if (quiet) null else sl?.value ?: DASH,
            word = if (quiet) WidgetFormat.cap(sl?.word) ?: DASH else null,
            ratio = sl?.ratio, tap = "sleep",
            spoken = spoken(Words.SLEEP, if (quiet) WidgetFormat.cap(sl?.word) else sl?.value),
        )
        return TrioView(title, dayLine, asOf, cells, null, spoken("Vitals $title", cells.joinToString(", ") { it.spoken }, asOf))
    }

    // ------------------------------------------------------------------------------------------------- texts (tests)

    /** Every text a card puts on screen (tests: quiet mode shows no digit anywhere, spoken sentence included). */
    fun texts(v: CardView): List<String> = listOfNotNull(v.title, v.asOf, v.hero, v.word, v.unit, v.meta, v.state, v.range, v.note, v.spoken)

    fun texts(v: TrioView): List<String> = listOfNotNull(v.title, v.dayLine, v.asOf, v.note, v.spoken) + v.cells.flatMap { listOfNotNull(it.label, it.hero, it.word, it.spoken) }
}
