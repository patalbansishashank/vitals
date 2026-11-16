package com.pulseloop.social

import android.app.usage.UsageEvents
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Turns a flat list of Android usage events into per-app foreground seconds for a local day — the pure, device-free
 * core of "Social time" (SPEC social-time). Nothing here touches Android state beyond the event-type constants, so it is
 * fully unit-testable: the caller ([SocialUsageQuery]) reads the events off the phone and hands them in.
 *
 * A foreground run is a MOVE_TO_FOREGROUND/ACTIVITY_RESUMED paired with the next
 * MOVE_TO_BACKGROUND/ACTIVITY_PAUSED/ACTIVITY_STOPPED for the *same* package. Runs are tracked per package, so
 * interleaved apps never confuse each other; a second foreground while one is already open is ignored (no double count).
 * A trailing foreground with no matching background is treated as "open until now". Every run is clamped to the day
 * window before it is summed, so a session that crosses midnight lands partly in each day.
 */
object SocialUsageReader {

    enum class Kind { FOREGROUND, BACKGROUND, OTHER }

    /** One usage event, reduced to the three things the pairing needs. [timeMs] is wall-clock epoch milliseconds. */
    data class Event(val packageName: String, val kind: Kind, val timeMs: Long)

    /** The Android `UsageEvents.Event` event-type ints this reader pairs; anything else is [Kind.OTHER] and ignored. */
    fun kindOf(rawEventType: Int): Kind = when (rawEventType) {
        UsageEvents.Event.MOVE_TO_FOREGROUND, UsageEvents.Event.ACTIVITY_RESUMED -> Kind.FOREGROUND
        UsageEvents.Event.MOVE_TO_BACKGROUND, UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> Kind.BACKGROUND
        else -> Kind.OTHER
    }

    /** A closed foreground run for one package: [endMs] is the background time, or `nowMs` for a trailing open run. */
    private data class Run(val startMs: Long, val endMs: Long)

    /**
     * Foreground seconds per app [SocialApp.key] over the half-open window [dayStartMs, dayEndMs), never counting past
     * [nowMs]. [keyOf] resolves a package to an enabled, installed app's key (null drops the package), so only wanted
     * apps are summed. Pass the full event list (it may reach before/after the window); every run is clipped to the
     * window, which is what makes a cross-midnight session split correctly between days.
     */
    fun foregroundSeconds(
        events: List<Event>,
        dayStartMs: Long,
        dayEndMs: Long,
        nowMs: Long,
        keyOf: (String) -> String?,
    ): Map<String, Int> {
        val windowEnd = minOf(dayEndMs, nowMs)
        if (windowEnd <= dayStartMs) return emptyMap()
        val totalsMs = HashMap<String, Long>()
        for ((pkg, runs) in runsByPackage(events, nowMs)) {
            val key = keyOf(pkg) ?: continue
            var ms = 0L
            for (run in runs) {
                val lo = maxOf(run.startMs, dayStartMs)
                val hi = minOf(run.endMs, windowEnd)
                if (hi > lo) ms += hi - lo
            }
            if (ms > 0) totalsMs[key] = (totalsMs[key] ?: 0L) + ms
        }
        // Seconds, integer; multiple packages behind one key (TikTok) are summed before the divide.
        return totalsMs.mapValues { (_, ms) -> (ms / 1000L).toInt() }.filterValues { it > 0 }
    }

    /** Foreground seconds per key for a set of local [days], computed from one event list, in the phone's [zone]. */
    fun perDay(
        events: List<Event>,
        days: List<LocalDate>,
        zone: ZoneId,
        nowMs: Long,
        keyOf: (String) -> String?,
    ): Map<LocalDate, Map<String, Int>> = days.associateWith { day ->
        val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        foregroundSeconds(events, start, end, nowMs, keyOf)
    }

    private fun runsByPackage(events: List<Event>, nowMs: Long): Map<String, List<Run>> {
        val byPkg = events.filter { it.kind != Kind.OTHER }.groupBy { it.packageName }
        return byPkg.mapValues { (_, pkgEvents) ->
            val runs = ArrayList<Run>()
            var openAt: Long? = null
            for (e in pkgEvents.sortedBy { it.timeMs }) {
                when (e.kind) {
                    // keep the earliest open: a nested RESUMED does not restart or double the run
                    Kind.FOREGROUND -> if (openAt == null) openAt = e.timeMs
                    Kind.BACKGROUND -> openAt?.let { start ->
                        if (e.timeMs > start) runs.add(Run(start, e.timeMs))
                        openAt = null
                    }
                    Kind.OTHER -> Unit
                }
            }
            // a foreground that never backgrounded is open until now
            openAt?.let { start -> if (nowMs > start) runs.add(Run(start, nowMs)) }
            runs
        }
    }

    fun startOfDay(date: LocalDate, zone: ZoneId): Instant = date.atStartOfDay(zone).toInstant()

    fun dayOf(epochMs: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()

    /** The last [days] local days ending with [today], oldest first. */
    fun window(today: LocalDate, days: Int): List<LocalDate> =
        (days - 1 downTo 0).map { today.minusDays(it.toLong()) }
}
