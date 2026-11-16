package com.pulseloop.social

import com.pulseloop.social.SocialUsageReader.Event
import com.pulseloop.social.SocialUsageReader.Kind
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure foreground-time pairing (SPEC social-time): no Android, no device — just a list of (package, kind, time)
 * events in and per-app seconds out. Covers the cases the spec names: overlapping/interleaved apps, a session crossing
 * midnight, an app opened and never backgrounded, an unknown package ignored, and the TikTok alias.
 */
class SocialUsageReaderTest {
    private val zone = ZoneId.of("Asia/Kolkata")

    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int, s: Int = 0): Long =
        ZonedDateTime.of(y, m, d, h, min, s, 0, zone).toInstant().toEpochMilli()

    private fun dayStart(y: Int, m: Int, d: Int) = at(y, m, d, 0, 0)

    /** Every package maps to its own key; only enabled apps (all seven here) resolve. */
    private val keyOf: (String) -> String? = { pkg -> SocialApp.fromPackage(pkg)?.key }

    private val ig = "com.instagram.android"
    private val yt = "com.google.android.youtube"

    private fun fg(pkg: String, t: Long) = Event(pkg, Kind.FOREGROUND, t)
    private fun bg(pkg: String, t: Long) = Event(pkg, Kind.BACKGROUND, t)

    @Test fun `one session sums its foreground seconds for the day`() {
        val events = listOf(fg(ig, at(2026, 11, 16, 10, 0)), bg(ig, at(2026, 11, 16, 10, 20)))
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 23, 0), keyOf = keyOf,
        )
        assertEquals(mapOf("instagram" to 20 * 60), got)
    }

    @Test fun `overlapping and interleaved apps are tracked independently`() {
        // Instagram and YouTube foreground overlap; each keeps its own run, so neither double-counts the other.
        val events = listOf(
            fg(ig, at(2026, 11, 16, 9, 0)),
            fg(yt, at(2026, 11, 16, 9, 5)),
            bg(ig, at(2026, 11, 16, 9, 10)),
            bg(yt, at(2026, 11, 16, 9, 25)),
        )
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 12, 0), keyOf = keyOf,
        )
        assertEquals(mapOf("instagram" to 10 * 60, "youtube" to 20 * 60), got)
    }

    @Test fun `a nested foreground does not restart or double a run`() {
        val events = listOf(
            fg(ig, at(2026, 11, 16, 8, 0)),
            fg(ig, at(2026, 11, 16, 8, 3)), // a second RESUMED while already open
            bg(ig, at(2026, 11, 16, 8, 10)),
        )
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 9, 0), keyOf = keyOf,
        )
        assertEquals(mapOf("instagram" to 10 * 60), got)
    }

    @Test fun `a session crossing midnight splits between the two days`() {
        // 23:50 -> 00:10 is 10 minutes in each local day; the same event list, clamped to each window.
        val events = listOf(fg(yt, at(2026, 11, 16, 23, 50)), bg(yt, at(2026, 11, 17, 0, 10)))
        val now = at(2026, 11, 17, 8, 0)
        val day16 = SocialUsageReader.foregroundSeconds(events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), now, keyOf)
        val day17 = SocialUsageReader.foregroundSeconds(events, dayStart(2026, 11, 17), dayStart(2026, 11, 18), now, keyOf)
        assertEquals(mapOf("youtube" to 10 * 60), day16)
        assertEquals(mapOf("youtube" to 10 * 60), day17)
    }

    @Test fun `an app opened and never backgrounded counts until now`() {
        val now = at(2026, 11, 16, 10, 30)
        val events = listOf(fg(ig, at(2026, 11, 16, 10, 0)))
        val got = SocialUsageReader.foregroundSeconds(events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), now, keyOf)
        assertEquals(mapOf("instagram" to 30 * 60), got)
    }

    @Test fun `an unknown package is ignored`() {
        val events = listOf(
            fg("com.android.chrome", at(2026, 11, 16, 10, 0)),
            bg("com.android.chrome", at(2026, 11, 16, 10, 30)),
            fg(ig, at(2026, 11, 16, 11, 0)),
            bg(ig, at(2026, 11, 16, 11, 5)),
        )
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 12, 0), keyOf = keyOf,
        )
        assertEquals(mapOf("instagram" to 5 * 60), got)
    }

    @Test fun `both TikTok packages fold into the one key`() {
        val events = listOf(
            fg("com.zhiliaoapp.musically", at(2026, 11, 16, 10, 0)),
            bg("com.zhiliaoapp.musically", at(2026, 11, 16, 10, 10)),
            fg("com.ss.android.ugc.trill", at(2026, 11, 16, 11, 0)),
            bg("com.ss.android.ugc.trill", at(2026, 11, 16, 11, 5)),
        )
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 12, 0), keyOf = keyOf,
        )
        assertEquals(mapOf("tiktok" to 15 * 60), got)
    }

    @Test fun `a disabled app is dropped by the key resolver`() {
        // only YouTube enabled
        val onlyYt: (String) -> String? = { pkg -> SocialApp.fromPackage(pkg)?.takeIf { it == SocialApp.YOUTUBE }?.key }
        val events = listOf(
            fg(ig, at(2026, 11, 16, 10, 0)), bg(ig, at(2026, 11, 16, 10, 20)),
            fg(yt, at(2026, 11, 16, 11, 0)), bg(yt, at(2026, 11, 16, 11, 10)),
        )
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 12, 0), keyOf = onlyYt,
        )
        assertEquals(mapOf("youtube" to 10 * 60), got)
    }

    @Test fun `a trailing background with no foreground is ignored`() {
        // the opening foreground happened before the events we were given; a lone background counts nothing
        val events = listOf(bg(ig, at(2026, 11, 16, 0, 10)))
        val got = SocialUsageReader.foregroundSeconds(
            events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), nowMs = at(2026, 11, 16, 12, 0), keyOf = keyOf,
        )
        assertTrue(got.isEmpty())
    }

    @Test fun `perDay computes each day from one event list`() {
        val events = listOf(
            fg(ig, at(2026, 11, 15, 20, 0)), bg(ig, at(2026, 11, 15, 20, 30)),
            fg(yt, at(2026, 11, 16, 9, 0)), bg(yt, at(2026, 11, 16, 9, 15)),
        )
        val days = SocialUsageReader.window(LocalDate.of(2026, 11, 16), 2)
        assertEquals(listOf(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 11, 16)), days)
        val got = SocialUsageReader.perDay(events, days, zone, nowMs = at(2026, 11, 16, 12, 0), keyOf = keyOf)
        assertEquals(mapOf("instagram" to 30 * 60), got[LocalDate.of(2026, 11, 15)])
        assertEquals(mapOf("youtube" to 15 * 60), got[LocalDate.of(2026, 11, 16)])
    }

    @Test fun `nothing is counted past now`() {
        // a run that is still open: it cannot stretch beyond now, even though the day has not ended
        val now = at(2026, 11, 16, 10, 0)
        val events = listOf(fg(ig, at(2026, 11, 16, 9, 55)))
        val got = SocialUsageReader.foregroundSeconds(events, dayStart(2026, 11, 16), dayStart(2026, 11, 17), now, keyOf)
        assertEquals(mapOf("instagram" to 5 * 60), got)
    }
}
