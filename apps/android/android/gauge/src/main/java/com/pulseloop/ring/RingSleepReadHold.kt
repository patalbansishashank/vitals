package com.pulseloop.ring

import java.time.Instant
import java.time.ZoneId

/**
 * Whether a sync pass may read the ring's sleep history right now.
 *
 * Reading the J-Style 2301 sleep stream closes the ring's open sleep record. On the night of
 * 2026-10-28/29 the phone stayed linked and ran a pass every ~30 min: each of the 13 records ended
 * within a minute of a pass's "Syncing sleep", the next began a few minutes later with a 3-minute
 * awake lead-in, and the ring classified no REM at all (raw code 3 in none of 384 minutes). The two
 * nights before, with no pass between ~22:00 and ~04:45, arrived as unbroken 120-minute records with
 * 93–106 min of REM. The ring names REM only deeper into an unbroken record, so a pass inside the
 * person's usual sleep window leaves sleep alone while the phone lies unused. A pass the person
 * asked for (the phone in use, or Vitals' `ring.sync` via [request]) still reads it, and the first
 * pass after the window catches the whole night up through the stream's cursor.
 */
object RingSleepReadHold {
    /** Local minutes of the day; [end] may be before [start] (the window crosses midnight). */
    data class Window(val start: Int, val end: Int) {
        fun contains(minute: Int): Boolean =
            if (start <= end) minute in start until end else minute >= start || minute < end
    }

    /** Until three nights are known: 21:00–09:00. */
    val DEFAULT = Window(21 * 60, 9 * 60)

    /** A Vitals request keeps sleep readable for this long (a sync takes about a minute). */
    const val REQUEST_MS = 5 * 60_000L
    private const val DAY_MIN = 24 * 60
    private const val MIN_NIGHT_MIN = 3 * 60
    private const val MIN_NIGHTS = 3
    private const val LEAD_MIN = 30
    private const val TRAIL_MIN = 60

    @Volatile var window: Window = DEFAULT
    /** True while the phone is in use; the app installs `PowerManager.isInteractive`. Unwired: always. */
    @Volatile var interactive: () -> Boolean = { true }
    @Volatile private var requestedUntilMs = 0L

    /** Someone asked for this sync (Vitals' Refresh): read sleep even inside the window. */
    fun request(nowMs: Long = System.currentTimeMillis()) {
        requestedUntilMs = nowMs + REQUEST_MS
    }

    fun mayRead(now: Instant, zone: ZoneId): Boolean {
        if (now.toEpochMilli() < requestedUntilMs) return true
        if (interactive()) return true
        val t = now.atZone(zone)
        return !window.contains(t.hour * 60 + t.minute)
    }

    /** Automatic foreground refresh must not fragment an open night merely because the screen is on. */
    fun mayReadUnattended(now: Instant, zone: ZoneId): Boolean {
        val t = now.atZone(zone)
        return !window.contains(t.hour * 60 + t.minute)
    }

    /**
     * The usual window from recent nights' ring windows ([start, end] epoch ms, the main sleep of
     * each night): the median bedtime less 30 min to the median wake plus 60 min. Fewer than three
     * nights of at least 3 h: [DEFAULT].
     */
    fun learn(nights: List<Pair<Long, Long>>, zone: ZoneId): Window {
        val long = nights.filter { (a, b) -> b - a >= MIN_NIGHT_MIN * 60_000L }
        if (long.size < MIN_NIGHTS) return DEFAULT
        // minutes after noon, so a night does not wrap through midnight
        fun afterNoon(ms: Long): Int {
            val t = Instant.ofEpochMilli(ms).atZone(zone)
            return (t.hour * 60 + t.minute + DAY_MIN - 12 * 60) % DAY_MIN
        }
        fun median(xs: List<Int>): Int = xs.sorted().let { it[(it.size - 1) / 2] }
        val start = median(long.map { afterNoon(it.first) }) - LEAD_MIN
        val end = median(long.map { afterNoon(it.second) }) + TRAIL_MIN
        fun clock(m: Int) = ((m + 12 * 60) % DAY_MIN + DAY_MIN) % DAY_MIN
        return Window(clock(start), clock(end.coerceAtMost(start + DAY_MIN - 1)))
    }
}
