package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.WidgetSamples.MIN
import desi.creative.vitals.widgets.WidgetSamples.now
import desi.creative.vitals.widgets.WidgetSamples.zone
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The words and times every widget shares: clock times that stay true, the app's quiet words, parts of the day. */
class WidgetFormatTest {
    private fun at(h: Int, m: Int = 0, zone: ZoneId = WidgetSamples.zone): Long = ZonedDateTime.of(2026, 10, 28, h, m, 0, 0, zone).toInstant().toEpochMilli()

    @Test
    fun anOldSnapshotSaysItsAge() {
        assertNull(WidgetFormat.asOf(now - 30 * MIN, now, zone, false))
        assertEquals("as of 12:49", WidgetFormat.asOf(now - 31 * MIN, now, zone, false))
        assertEquals("as of 09:20", WidgetFormat.asOf(now - 240 * MIN, now, zone, false))
        // 13:20 now: 14 h back is yesterday 23:20
        assertEquals("as of yesterday 23:20", WidgetFormat.asOf(now - 14 * 60 * MIN, now, zone, false))
        assertEquals("as of Mon 13:20", WidgetFormat.asOf(now - 2 * 24 * 60 * MIN, now, zone, false))
        assertEquals("as of 18 Oct", WidgetFormat.asOf(now - 10 * 24 * 60 * MIN, now, zone, false))
        // quiet: words, never a clock time
        assertEquals("Updated recently", WidgetFormat.asOf(now - 45 * MIN, now, zone, true))
        assertEquals("Updated earlier today", WidgetFormat.asOf(now - 5 * 60 * MIN, now, zone, true))
        assertEquals("Updated a while ago", WidgetFormat.asOf(now - 20 * 60 * MIN, now, zone, true))
    }

    @Test
    fun aReadingIsSaidAsAClockTime() {
        assertEquals("at 13:16", WidgetFormat.at(now - 4 * MIN, now, zone))
        assertEquals("yesterday 22:10", WidgetFormat.at(now - (15 * 60 + 10) * MIN, now, zone))
        assertEquals("13:16", WidgetFormat.clock(now - 4 * MIN, zone))
        // the clock is the phone's: the same instant in another zone reads differently
        assertEquals("07:46", WidgetFormat.clock(now - 4 * MIN, ZoneId.of("UTC")))
    }

    @Test
    fun theBatteryKeepsTheAppsAgeRule() {
        assertNull(WidgetFormat.batteryAge(now - 119 * MIN, now, false))
        assertEquals("2 h ago", WidgetFormat.batteryAge(now - 121 * MIN, now, false))
        assertEquals("5 d ago", WidgetFormat.batteryAge(now - 5 * 24 * 60 * MIN - 1, now, false))
        assertEquals("earlier today", WidgetFormat.batteryAge(now - 3 * 60 * MIN, now, true))
    }

    @Test
    fun quietAgeMatchesTheApp() {
        assertEquals("just now", WidgetFormat.quietAge(0.5))
        assertEquals("recently", WidgetFormat.quietAge(59.0))
        assertEquals("earlier today", WidgetFormat.quietAge(60.0))
        assertEquals("a while ago", WidgetFormat.quietAge(18 * 60.0))
        assertEquals("a while ago", WidgetFormat.quietAge(Double.NaN))
    }

    @Test
    fun anAgeInWordsSaysEarlierTodayOnlyOfToday() {
        // under an hour: the app's words
        assertEquals("recently", WidgetFormat.quietAgeAt(now - 20 * MIN, now, zone))
        assertEquals("just now", WidgetFormat.quietAgeAt(now, now, zone))
        // earlier the same day
        assertEquals("earlier today", WidgetFormat.quietAgeAt(now - 3 * 60 * MIN, now, zone))
        // at 08:00 a reading from 22:30 is not "earlier today"
        val morning = at(8)
        assertEquals("a while ago", WidgetFormat.quietAgeAt(at(22, 30) - 24 * 60 * MIN, morning, zone))
        // but half an hour back across midnight is still "recently"
        assertEquals("recently", WidgetFormat.quietAgeAt(at(0, 10) - 40 * MIN, at(0, 10), zone))
        assertEquals("Updated a while ago", WidgetFormat.asOf(at(22, 30) - 24 * 60 * MIN, morning, zone, true))
    }

    @Test
    fun partsOfTheDayMatchTheApp() {
        // the app's `partOfDay` (src/features/ring/quiet.ts): the same edges
        assertEquals("in the night", WidgetFormat.partOfDay(at(2), zone))
        assertEquals("in the night", WidgetFormat.partOfDay(at(4, 59), zone))
        assertEquals("early in the morning", WidgetFormat.partOfDay(at(5), zone))
        assertEquals("in the morning", WidgetFormat.partOfDay(at(8), zone))
        assertEquals("in the afternoon", WidgetFormat.partOfDay(at(12), zone))
        assertEquals("in the evening", WidgetFormat.partOfDay(at(17), zone))
        assertEquals("late in the evening", WidgetFormat.partOfDay(at(21), zone))
        assertEquals("late in the evening", WidgetFormat.partOfDay(at(23, 59), zone))
        // the noun forms for a short line
        assertEquals(listOf("night", "early morning", "morning", "afternoon", "evening", "late evening"), listOf(2, 6, 10, 15, 19, 22).map { WidgetFormat.partOfDayNoun(at(it), zone) })
    }

    @Test
    fun theDayLineIsAFactAndQuietLeavesTheDateOut() {
        assertEquals("Wed 28 Oct", WidgetFormat.dayLine(now, zone, false))
        assertEquals("Wed", WidgetFormat.dayLine(now, zone, true))
        assertEquals("2026-10-28", WidgetFormat.dayOf(now, zone))
        // java.time's LocalDate.ofInstant is API 34; the minimum here is 26: the day comes from the zoned time
        assertEquals("2026-10-28", WidgetFormat.dayOf(at(23, 59), zone))
        // half past midnight in Kolkata is still the evening before in UTC: a figure belongs to the phone's own day
        assertEquals("2026-10-28", WidgetFormat.dayOf(at(0, 30), zone))
        assertEquals("2026-10-27", WidgetFormat.dayOf(at(0, 30), ZoneId.of("UTC")))
    }

    @Test
    fun theWeightStatesAreTheAppsWords() {
        assertEquals("Ahead", WidgetFormat.weightState("ahead"))
        assertEquals("On track", WidgetFormat.weightState("onTrack"))
        assertEquals("Behind", WidgetFormat.weightState("behind"))
        assertNull(WidgetFormat.weightState("elsewhere"))
        assertNull(WidgetFormat.weightState(null))
        assertEquals("Over half of the goal", WidgetFormat.cap("over half of the goal"))
        assertNull(WidgetFormat.cap(null))
    }
}
