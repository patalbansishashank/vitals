package desi.creative.vitals.widgets

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.floor

/**
 * The words and times every widget shares, from the clock. Pure (java.time only), so it is unit tested; what each card says
 * is `CardFormat`.
 *
 * A widget redraws without the app (every 30 minutes at most), so a relative age such as "5 min ago" would go stale on
 * the home screen: instants are said as clock times ("at 13:20", "yesterday 22:10"), which stay true. The battery keeps
 * the app's own coarse age ("3 h ago", "5 d ago", only once the reading is over two hours old). Quiet mode is words
 * only, no digits (owner, r071 Q8: a part of the day, never a clock time): the app's quiet words (`quietAge`,
 * `quietSynced`) and the app's parts of the day.
 */
object WidgetFormat {
    /** Older than this, the widget says how old its snapshot is ("as of 13:20"). */
    const val STALE_MS = 30 * 60_000L

    /** The app's BATTERY_FRESH_MS: an older battery reading carries its age. */
    const val BATTERY_FRESH_MS = 2 * 60 * 60_000L

    const val DASH = "—"

    object Words {
        const val TODAY = "Today"
        const val ENERGY = "Energy"
        const val STEPS = "Steps"
        const val SLEEP = "Sleep"
        const val HEART_RATE = "Heart rate"
        const val WEIGHT = "Weight"
        const val BATTERY = "Ring"
        const val NOT_SYNCED = "Not synced yet"
        const val FIRST_OPEN = "Open Vitals once to fill this widget"
        const val NEW_DAY = "Open Vitals to see today"
        const val UNPAIRED = "Connect Vitals to your server to see the ring"
        const val UNREACHABLE = "Ring data shows when Vitals reaches your server"
        const val EMPTY = "Ring data shows once your phone sends some"
        const val QUIET_ON = "Quiet mode is on"
        const val WEIGHT_OFF = "Off for widgets. Turn it on in Settings › Widgets."
        const val WEIGHT_NONE = "No trend yet"
        const val LOG = "Log an activity"
        const val LOG_SHORT = "Log"
        const val RECORD = "Record"
        const val MEASURED = "Measured"
        const val OF = "of"
        const val LIKELY = "likely"
    }

    private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)
    private val WEEKDAY = DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH)
    private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)

    // ------------------------------------------------------------------------------------------------- times

    /** "as of 13:20" once the snapshot is over 30 minutes old (quiet: "Updated earlier today"), else null. */
    fun asOf(at: Long, now: Long, zone: ZoneId, quiet: Boolean): String? {
        if (now - at <= STALE_MS) return null
        return if (quiet) "Updated ${quietAgeAt(at, now, zone)}" else "as of ${clockAge(at, now, zone)}"
    }

    /** "13:20" today, "yesterday 22:10", "Mon 13:20" within the week, else "26 Oct". */
    fun clockAge(at: Long, now: Long, zone: ZoneId): String {
        val t = Instant.ofEpochMilli(at).atZone(zone)
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val days = ChronoUnit.DAYS.between(t.toLocalDate(), today)
        return when {
            days <= 0L -> CLOCK.format(t)
            days == 1L -> "yesterday ${CLOCK.format(t)}"
            days < 7L -> "${WEEKDAY.format(t)} ${CLOCK.format(t)}"
            else -> DAY_MONTH.format(t)
        }
    }

    /** "13:20": the clock time of an instant. */
    fun clock(at: Long, zone: ZoneId): String = CLOCK.format(Instant.ofEpochMilli(at).atZone(zone))

    /** A reading's instant: "at 13:20" today, else as `clockAge`. */
    fun at(at: Long, now: Long, zone: ZoneId): String {
        val c = clockAge(at, now, zone)
        return if (c.first().isDigit() && c.contains(':')) "at $c" else c
    }

    /** "Wed 28 Oct" (quiet: "Wed": no digits). */
    fun dayLine(now: Long, zone: ZoneId, quiet: Boolean): String {
        val d = Instant.ofEpochMilli(now).atZone(zone)
        return if (quiet) WEEKDAY.format(d) else "${WEEKDAY.format(d)} ${DAY_MONTH.format(d)}"
    }

    /** The app's local day of an instant (YYYY-MM-DD): the day a snapshot's figures must belong to. */
    fun dayOf(now: Long, zone: ZoneId): String = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()

    /**
     * A time of day as the app says it in quiet mode (`partOfDay`): "in the night", "early in the morning", "in the
     * morning", "in the afternoon", "in the evening", "late in the evening".
     */
    fun partOfDay(at: Long, zone: ZoneId): String = when (hourOf(at, zone)) {
        in 0.0..<5.0 -> "in the night"
        in 5.0..<8.0 -> "early in the morning"
        in 8.0..<12.0 -> "in the morning"
        in 12.0..<17.0 -> "in the afternoon"
        in 17.0..<21.0 -> "in the evening"
        else -> "late in the evening"
    }

    /** The same part of the day as a noun for a short line: "night", "early morning", "morning", "afternoon", "evening", "late evening". */
    fun partOfDayNoun(at: Long, zone: ZoneId): String = when (hourOf(at, zone)) {
        in 0.0..<5.0 -> "night"
        in 5.0..<8.0 -> "early morning"
        in 8.0..<12.0 -> "morning"
        in 12.0..<17.0 -> "afternoon"
        in 17.0..<21.0 -> "evening"
        else -> "late evening"
    }

    private fun hourOf(at: Long, zone: ZoneId): Double {
        val t = Instant.ofEpochMilli(at).atZone(zone)
        return t.hour + t.minute / 60.0
    }

    /** The app's `batteryAge`: null while fresh; "3 h ago" / "5 d ago" (quiet: `quietAge`). */
    fun batteryAge(at: Long, now: Long, quiet: Boolean): String? {
        if (now - at < BATTERY_FRESH_MS) return null
        val min = minutes(at, now)
        if (quiet) return quietAge(min)
        return if (min < 24 * 60) "${floor(min / 60).toInt()} h ago" else "${floor(min / (24 * 60)).toInt()} d ago"
    }

    /** The app's `quietAge`: "just now" · "recently" · "earlier today" · "a while ago". */
    fun quietAge(ageMin: Double): String = when {
        !ageMin.isFinite() -> "a while ago"
        ageMin < 1 -> "just now"
        ageMin < 60 -> "recently"
        ageMin < 18 * 60 -> "earlier today"
        else -> "a while ago"
    }

    /**
     * The app's `quietAge` for an instant on a home screen: under an hour the same words, but "earlier today" only when it
     * was today (at 08:00 a reading from 22:30 is "a while ago", not "earlier today").
     */
    fun quietAgeAt(at: Long, now: Long, zone: ZoneId): String {
        val min = minutes(at, now)
        if (min < 60) return quietAge(min)
        return if (dayOf(at, zone) == dayOf(now, zone)) quietAge(min) else "a while ago"
    }

    fun minutes(at: Long, now: Long): Double = maxOf(0L, now - at) / 60_000.0

    /** The first letter capital: the app's quiet words are lower case ("over half of the goal"). */
    fun cap(word: String?): String? = word?.replaceFirstChar { it.titlecase(Locale.ENGLISH) }

    /** The app's words for where the trend weight stands against the plan (`TODAY_COPY.drift`). */
    fun weightState(state: String?): String? = when (state) {
        "ahead" -> "Ahead"
        "onTrack" -> "On track"
        "behind" -> "Behind"
        else -> null
    }
}
