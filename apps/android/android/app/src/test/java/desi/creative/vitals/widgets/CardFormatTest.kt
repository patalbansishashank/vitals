package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.WidgetFormat.DASH
import desi.creative.vitals.widgets.WidgetFormat.Words
import desi.creative.vitals.widgets.WidgetSamples.MIN
import desi.creative.vitals.widgets.WidgetSamples.now
import desi.creative.vitals.widgets.WidgetSamples.zone
import desi.creative.vitals.widgets.viz.VizSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * What each card says, for every card, size class and mode (the snapshots are the shared fixtures, parsed with org.json: Robolectric).
 * The rules that must survive every restyle: another day's figures are never shown as today's; quiet mode is words and
 * parts of the day with no digit anywhere (the spoken sentence included); an estimate carries its range at every size.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CardFormatTest {
    private val digit = Regex("""\d""")
    private val numbers = WidgetSamples.numbers()
    private val quiet = WidgetSamples.quiet()

    private fun every(s: WidgetSnapshot?, cls: SizeClass): List<CardView> = listOf(
        CardFormat.energy(s, now, zone, cls),
        CardFormat.sleep(s, now, zone, cls),
        CardFormat.steps(s, now, zone, cls),
        CardFormat.heart(s, now, zone, cls),
        CardFormat.weight(s, now, zone, cls),
    )

    // ------------------------------------------------------------------------------------------------- Energy

    @Test
    fun energyAsARingSaysTheFigureItsCourseAndItsRange() {
        val v = CardFormat.energy(numbers, now, zone, SizeClass.SQUARE)
        assertEquals(CardLayout.RING, v.layout)
        assertEquals("1 096", v.hero)
        assertEquals("kcal", v.unit)
        assertEquals("On plan", v.state)
        assertEquals("983–1 209", v.range)
        assertEquals(VizSpec.Ring(0.422), v.viz)
        assertNull("a fresh snapshot carries no age", v.asOf)
        assertNull(v.meta)
        assertEquals("energy", v.tap)
        assertEquals("Vitals Energy, 1 096 kcal so far, On plan, likely 983–1 209", v.spoken)
    }

    @Test
    fun theWideEnergyCardDrawsTheDaysLineAndNamesTheLikelyDay() {
        val v = CardFormat.energy(numbers, now, zone, SizeClass.WIDE)
        assertEquals(CardLayout.SIDE, v.layout)
        assertEquals("of 2 595 today", v.meta)
        val line = v.viz as VizSpec.Line
        assertEquals(23, line.series.now)
        assertNotNull("the dotted forecast", line.series.ahead)
        // the estimate keeps its range at every size (drop the forecast, never the range)
        assertEquals("983–1 209", v.range)
        assertEquals("983–1 209", CardFormat.energy(numbers, now, zone, SizeClass.STRIP).range)
    }

    @Test
    fun quietModeSaysNothingAboutEnergy() {
        for (cls in SizeClass.entries) {
            val v = CardFormat.energy(quiet, now, zone, cls)
            assertEquals(Words.QUIET_ON, v.note)
            assertNull(v.hero)
            assertNull(v.viz)
            assertFalse(CardFormat.texts(v).any { digit.containsMatchIn(it) })
        }
    }

    // ------------------------------------------------------------------------------------------------- Sleep

    @Test
    fun sleepAsARingIsTheNightAgainstTheGoal() {
        val v = CardFormat.sleep(numbers, now, zone, SizeClass.SQUARE)
        assertEquals("7 h 56", v.hero)
        assertEquals("Goal met", v.state)
        assertEquals("7 h 30", v.range)
        assertEquals(VizSpec.Ring(1.058), v.viz)
        assertNull(v.word)
    }

    @Test
    fun theWideSleepCardDrawsTheNightAndSaysWhenItWas() {
        val v = CardFormat.sleep(numbers, now, zone, SizeClass.WIDE)
        assertEquals("23:14 – 07:37", v.meta)
        val h = v.viz as VizSpec.Hypnogram
        assertEquals(14, h.spans.size)
        assertEquals("sleep", v.tap)
    }

    @Test
    fun quietSleepKeepsTheRingAndTheNightAndSaysItInPartsOfTheDay() {
        val sq = CardFormat.sleep(quiet, now, zone, SizeClass.SQUARE)
        assertNull("no figure in quiet mode", sq.hero)
        assertEquals("Goal met", sq.word)
        assertNull("said once", sq.state)
        assertNull(sq.range)
        assertTrue(sq.viz is VizSpec.Ring)
        val wide = CardFormat.sleep(quiet, now, zone, SizeClass.WIDE)
        assertTrue("the app draws the hypnogram in quiet mode too", wide.viz is VizSpec.Hypnogram)
        assertEquals("late evening\nto early morning", wide.meta)
        for (v in listOf(sq, wide)) assertFalse(CardFormat.texts(v).any { digit.containsMatchIn(it) })
    }

    // ------------------------------------------------------------------------------------------------- Steps

    @Test
    fun stepsAsARing() {
        val v = CardFormat.steps(numbers, now, zone, SizeClass.SQUARE)
        assertEquals("7 605", v.hero)
        assertEquals("steps", v.unit)
        assertEquals("On course", v.state)
        assertEquals("of 9 000", v.range)
        assertEquals(VizSpec.Ring(0.845), v.viz)
    }

    @Test
    fun theWideStepsCardDrawsTheHoursAndNamesTheLikelyTotal() {
        val v = CardFormat.steps(numbers, now, zone, SizeClass.WIDE)
        val bars = v.viz as VizSpec.Bars
        assertEquals(13, bars.series.now)
        assertEquals(24, bars.series.y.size)
        assertEquals("likely 12 878", v.meta)
    }

    @Test
    fun quietStepsAreTheRatioAndAWordNeverBars() {
        for (cls in listOf(SizeClass.SQUARE, SizeClass.WIDE)) {
            val v = CardFormat.steps(quiet, now, zone, cls)
            assertNull(v.hero)
            assertEquals("Over half of the goal", v.word)
            assertEquals("On course", v.state)
            assertEquals("a ring by ratio, as the app draws it in quiet mode", VizSpec.Ring(0.845), v.viz)
            assertNull(v.meta)
            assertNull(v.range)
            assertFalse(CardFormat.texts(v).any { digit.containsMatchIn(it) })
        }
    }

    // ------------------------------------------------------------------------------------------------- Heart rate

    @Test
    fun heartRateIsTheReadingItsWordItsRangeAndWhenItWasTaken() {
        val v = CardFormat.heart(numbers, now, zone, SizeClass.SQUARE)
        assertEquals(CardLayout.STACK, v.layout)
        assertEquals("79", v.hero)
        assertEquals("bpm", v.unit)
        assertEquals("Normal", v.state)
        assertEquals("50–90", v.range)
        assertEquals("at 13:16", v.meta)
        assertTrue(v.viz is VizSpec.Line)
        assertEquals("hr", v.tap)
        val wide = CardFormat.heart(numbers, now, zone, SizeClass.WIDE)
        assertEquals(CardLayout.SIDE, wide.layout)
        assertEquals("at 13:16 · Ring 64 %", wide.meta)
    }

    @Test
    fun heartRateInQuietModeIsAWordAndNoLine() {
        for (cls in listOf(SizeClass.SQUARE, SizeClass.WIDE)) {
            val v = CardFormat.heart(quiet, now, zone, cls)
            assertNull(v.hero)
            assertEquals("Measured recently", v.word)
            assertEquals("Normal", v.state)
            assertNull(v.viz)
            assertNull(v.range)
            assertNull(v.meta)
            assertFalse(CardFormat.texts(v).any { digit.containsMatchIn(it) })
        }
    }

    @Test
    fun heartRateSaysWhyThereIsNoData() {
        val base = numbers
        val unpaired = base.copy(ring = WidgetSnapshot.RingPart("unpaired", null, null, null))
        assertEquals(Words.UNPAIRED, CardFormat.heart(unpaired, now, zone, SizeClass.SQUARE).note)
        val empty = base.copy(ring = WidgetSnapshot.RingPart("empty", null, null, null))
        assertEquals(Words.EMPTY, CardFormat.heart(empty, now, zone, SizeClass.SQUARE).note)
        val offline = base.copy(ring = WidgetSnapshot.RingPart("unreachable", null, null, now - 90 * MIN))
        assertEquals(Words.UNREACHABLE, CardFormat.heart(offline, now, zone, SizeClass.SQUARE).note)
        // offline with the last readings kept: they show
        val kept = base.copy(ring = base.ring!!.copy(state = "unreachable"))
        assertNull(CardFormat.heart(kept, now, zone, SizeClass.SQUARE).note)
    }

    // ------------------------------------------------------------------------------------------------- Weight

    @Test
    fun weightIsOffUntilThePersonTurnsItOn() {
        val off = numbers.copy(body = null)
        for (cls in SizeClass.entries) assertEquals(Words.WEIGHT_OFF, CardFormat.weight(off, now, zone, cls).note)
        assertEquals(Words.WEIGHT_NONE, CardFormat.weight(numbers.copy(body = WidgetSnapshot.BodyPart(null)), now, zone, SizeClass.SQUARE).note)
        assertEquals(Words.FIRST_OPEN, CardFormat.weight(null, now, zone, SizeClass.SQUARE).note)
    }

    @Test
    fun weightWithNumbersAndInQuietMode() {
        val v = CardFormat.weight(numbers, now, zone, SizeClass.SQUARE)
        assertEquals("85.2", v.hero)
        assertEquals("kg", v.unit)
        assertEquals("On track", v.state)
        assertTrue(v.viz is VizSpec.Line)
        assertEquals("weight", v.tap)
        val q = CardFormat.weight(quiet, now, zone, SizeClass.WIDE)
        assertNull(q.hero)
        assertEquals("On track", q.word)
        assertNull(q.viz)
        assertFalse(CardFormat.texts(q).any { digit.containsMatchIn(it) })
    }

    // ------------------------------------------------------------------------------------------------- the Today glance

    @Test
    fun theGlanceIsThreeRingsEachItsOwnTap() {
        val t = CardFormat.trio(numbers, now, zone)
        assertEquals("Today", t.title)
        assertEquals("Wed 28 Oct", t.dayLine)
        assertEquals(listOf("steps", "energy", "sleep"), t.cells.map { it.id })
        assertEquals(listOf("steps", "energy", "sleep"), t.cells.map { it.tap })
        assertEquals(listOf("7 605", "1 096", "7 h 56"), t.cells.map { it.hero })
        assertEquals(listOf(0.845, 0.422, 1.058), t.cells.map { it.ratio })
        assertEquals(listOf("Steps", "Energy", "Sleep"), t.cells.map { it.label })
        assertNull(t.note)
    }

    @Test
    fun theQuietGlanceIsTwoRingsAndAWordUnderEach() {
        val t = CardFormat.trio(quiet, now, zone)
        assertEquals("Wed", t.dayLine)
        assertEquals(listOf("steps", "sleep"), t.cells.map { it.id })
        assertEquals(listOf("Over half of the goal", "Goal met"), t.cells.map { it.word })
        assertTrue(t.cells.all { it.hero == null })
        assertFalse(CardFormat.texts(t).any { digit.containsMatchIn(it) })
    }

    // ------------------------------------------------------------------------------------------------- every card

    @Test
    fun anotherDaysFiguresAreNeverShownAsToday() {
        val old = WidgetSamples.numbers(at = now - 15 * 60 * MIN, date = "2026-10-27")
        for (cls in SizeClass.entries) {
            for (v in listOf(CardFormat.energy(old, now, zone, cls), CardFormat.sleep(old, now, zone, cls), CardFormat.steps(old, now, zone, cls))) {
                assertEquals(Words.NEW_DAY, v.note)
                assertNull(v.hero)
                assertNull(v.viz)
            }
        }
        val t = CardFormat.trio(old, now, zone)
        assertEquals(Words.NEW_DAY, t.note)
        assertTrue(t.cells.isEmpty())
    }

    @Test
    fun theFiguresAreTodaysUntilTheAppDayEnds() {
        // the app's day rolls over at 04:00: at 00:30 on the 29th it is still the 28th, and the widgets say so
        val zoned = { d: String, h: Int, m: Int -> java.time.ZonedDateTime.of(java.time.LocalDate.parse(d).year, java.time.LocalDate.parse(d).monthValue, java.time.LocalDate.parse(d).dayOfMonth, h, m, 0, 0, zone).toInstant().toEpochMilli() }
        val snap = WidgetSamples.numbers(at = zoned("2026-10-28", 23, 50), date = "2026-10-28")
        for ((d, h, m) in listOf(Triple("2026-10-29", 0, 30), Triple("2026-10-29", 3, 59))) {
            val at = zoned(d, h, m)
            assertNull("$d $h:$m is still the 28th", CardFormat.energy(snap, at, zone, SizeClass.SQUARE).note)
            assertEquals("1 096", CardFormat.energy(snap, at, zone, SizeClass.SQUARE).hero)
            assertNull(CardFormat.trio(snap, at, zone).note)
        }
        // at 04:00 the app's day is the 29th and the widgets ask for the app
        val rolled = zoned("2026-10-29", 4, 0)
        assertEquals(Words.NEW_DAY, CardFormat.energy(snap, rolled, zone, SizeClass.SQUARE).note)
        assertEquals(Words.NEW_DAY, CardFormat.sleep(snap, rolled, zone, SizeClass.WIDE).note)
        assertEquals(Words.NEW_DAY, CardFormat.trio(snap, rolled, zone).note)
        // an older web bundle sends no day end: the calendar day decides, as it did
        val old = WidgetSnapshot.parse(WidgetSamples.oldV1())!!
        assertNull(old.today!!.until)
        assertNull(CardFormat.energy(old, now, zone, SizeClass.SQUARE).note)
        assertEquals(Words.NEW_DAY, CardFormat.energy(old, zoned("2026-10-29", 0, 30), zone, SizeClass.SQUARE).note)
    }

    @Test
    fun theBatteryCarriesItsAgeOnceItIsOverTwoHoursOld() {
        val fresh = CardFormat.heart(numbers, now, zone, SizeClass.WIDE)
        assertEquals("at 13:16 · Ring 64 %", fresh.meta)
        val old = numbers.copy(ring = numbers.ring!!.copy(battery = WidgetSnapshot.Battery("64", "Fine", now - 5 * 24 * 60 * MIN)))
        assertEquals("at 13:16 · Ring 64 % · 5 d ago", CardFormat.heart(old, now, zone, SizeClass.WIDE).meta)
        val three = numbers.copy(ring = numbers.ring!!.copy(battery = WidgetSnapshot.Battery("64", "Fine", now - 3 * 60 * MIN)))
        assertEquals("at 13:16 · Ring 64 % · 3 h ago", CardFormat.heart(three, now, zone, SizeClass.WIDE).meta)
    }

    @Test
    fun aReadingFromYesterdayIsNotEarlierToday() {
        val late = numbers.copy(ring = numbers.ring!!.copy(hr = numbers.ring!!.hr!!.copy(at = now - 15 * 60 * MIN)), quiet = true)
        // 22:20 yesterday seen at 13:20: not "earlier today"
        assertEquals("Measured a while ago", CardFormat.heart(late, now, zone, SizeClass.SQUARE).word)
        assertEquals("Measured recently", CardFormat.heart(quiet, now, zone, SizeClass.SQUARE).word)
    }

    @Test
    fun withoutASnapshotEveryTodayCardAsksForTheApp() {
        for (cls in SizeClass.entries) {
            assertEquals(Words.FIRST_OPEN, CardFormat.energy(null, now, zone, cls).note)
            assertEquals(Words.FIRST_OPEN, CardFormat.sleep(null, now, zone, cls).note)
            assertEquals(Words.FIRST_OPEN, CardFormat.steps(null, now, zone, cls).note)
            assertEquals(Words.FIRST_OPEN, CardFormat.heart(null, now, zone, cls).note)
        }
        assertEquals(Words.FIRST_OPEN, CardFormat.trio(null, now, zone).note)
    }

    @Test
    fun anOldSnapshotSaysItsAge() {
        val stale = WidgetSamples.numbers(at = now - 70 * MIN)
        assertEquals("as of 12:10", CardFormat.energy(stale, now, zone, SizeClass.SQUARE).asOf)
        assertEquals("as of 12:10", CardFormat.trio(stale, now, zone).asOf)
        assertEquals("Updated earlier today", CardFormat.steps(WidgetSamples.quiet(at = now - 70 * MIN), now, zone, SizeClass.SQUARE).asOf)
    }

    @Test
    fun quietModeShowsNoDigitInAnyCardAtAnySize() {
        for (cls in SizeClass.entries) {
            for (v in every(quiet, cls)) for (t in CardFormat.texts(v)) assertFalse("quiet shows no digit: '$t' (${v.id} $cls)", digit.containsMatchIn(t))
        }
        // even a quiet flag on a snapshot that still carries figures shows none of them
        val leaky = numbers.copy(quiet = true)
        for (cls in SizeClass.entries) for (v in every(leaky, cls)) for (t in CardFormat.texts(v)) assertFalse("quiet shows no digit: '$t' (${v.id} $cls)", digit.containsMatchIn(t))
        for (t in CardFormat.texts(CardFormat.trio(leaky, now, zone))) assertFalse("quiet shows no digit: '$t'", digit.containsMatchIn(t))
        // a stale quiet snapshot says its age in words
        for (t in CardFormat.texts(CardFormat.trio(WidgetSamples.quiet(at = now - 5 * 60 * MIN), now, zone))) assertFalse(t, digit.containsMatchIn(t))
    }

    @Test
    fun aSnapshotFromAnOlderWebBundleStillDrawsWithoutItsPictures() {
        val old = WidgetSnapshot.parse(WidgetSamples.oldV1())!!
        val e = CardFormat.energy(old, now, zone, SizeClass.SQUARE)
        assertEquals("1 240", e.hero)
        assertNull("no ratio from an older bundle: no ring", e.viz)
        assertEquals("1 120–1 360", e.range)
        val w = CardFormat.energy(old, now, zone, SizeClass.WIDE)
        assertNull(w.viz)
        assertNull(w.meta)
        val s = CardFormat.steps(old, now, zone, SizeClass.SQUARE)
        assertEquals("6 420", s.hero)
        assertEquals(VizSpec.Ring(0.642), s.viz)
        assertEquals("of 10 000", s.range)
        val sl = CardFormat.sleep(old, now, zone, SizeClass.WIDE)
        assertEquals("7 h 12", sl.hero)
        assertNull(sl.viz)
        assertEquals("62", CardFormat.heart(old, now, zone, SizeClass.SQUARE).hero)
        assertEquals(listOf("6 420", "1 240", "7 h 12"), CardFormat.trio(old, now, zone).cells.map { it.hero })
    }

    @Test
    fun aCardWithNoReadingYetShowsADash() {
        val bare = numbers.copy(today = numbers.today!!.copy(energy = null, steps = null, sleep = null))
        assertEquals(DASH, CardFormat.energy(bare, now, zone, SizeClass.SQUARE).hero)
        assertEquals(DASH, CardFormat.steps(bare, now, zone, SizeClass.SQUARE).hero)
        assertEquals(DASH, CardFormat.sleep(bare, now, zone, SizeClass.SQUARE).hero)
        assertEquals(listOf(DASH, DASH, DASH), CardFormat.trio(bare, now, zone).cells.map { it.hero })
    }

    @Test
    fun everyCardNamesAKnownTarget() {
        val known = WidgetLinks.targets.toSet()
        for (cls in SizeClass.entries) for (v in every(numbers, cls)) assertTrue("${v.id} -> ${v.tap}", v.tap in known)
        for (c in CardFormat.trio(numbers, now, zone).cells) assertTrue(c.tap in known)
    }
}
