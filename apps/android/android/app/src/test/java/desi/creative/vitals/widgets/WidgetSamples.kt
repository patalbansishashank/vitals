package desi.creative.vitals.widgets

import java.io.File
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Synthetic snapshots for the widget tests and renders (no person's data). The numbers and the quiet snapshot are the
 * shared fixtures in design/widget-fixtures, the same files the web side's contract test reads, so the two sides cannot
 * drift: parsing needs the Android runtime (org.json), so every test that uses them runs under Robolectric.
 */
object WidgetSamples {
    val zone: ZoneId = ZoneId.of("Asia/Kolkata")

    /** Wed 28 Oct 2026, 13:20 in Kolkata. */
    val now: Long = ZonedDateTime.of(2026, 10, 28, 13, 20, 0, 0, zone).toInstant().toEpochMilli()
    const val TODAY = "2026-10-28"
    const val MIN = 60_000L

    /** The widgets' folder of shared fixtures (unit tests run in the app module's folder). */
    fun fixture(name: String): String = File("../../../../design/widget-fixtures/$name").readText()

    /** The app's day ends at 04:00 the next morning (the app's rollover). */
    fun dayEnd(date: String): Long = java.time.LocalDate.parse(date).plusDays(1).atTime(4, 0).atZone(zone).toInstant().toEpochMilli()

    private fun at(base: WidgetSnapshot, at: Long, date: String): WidgetSnapshot =
        base.copy(at = at, today = base.today?.copy(date = date, until = dayEnd(date)))

    /** What the web publishes with numbers on (every card, its pictures, weight opted in). */
    fun numbers(at: Long = now - 2 * MIN, date: String = TODAY): WidgetSnapshot = at(WidgetSnapshot.parse(fixture("snapshot-numbers.json"))!!, at, date)

    /** What a quiet snapshot keeps after parsing: words, ratios, the night's stages and instants. */
    fun quiet(at: Long = now - 2 * MIN): WidgetSnapshot = at(WidgetSnapshot.parse(fixture("snapshot-quiet.json"))!!, at, TODAY)

    /** The same snapshot without the new fields: what an older web bundle publishes (version 1 as of 0.6.6). */
    fun oldV1(): String = """
        {"v":1,"at":${now - 2 * MIN},"quiet":false,
         "today":{"date":"$TODAY",
           "energy":{"value":"1 240","unit":"kcal","range":"1 120–1 360"},
           "steps":{"value":"6 420","goal":"10 000","ratio":0.642,"word":"over half of the goal"},
           "heartPoints":{"value":"84","goal":"150","ratio":0.56,"word":"on track this week"},
           "sleep":{"value":"7 h 12","word":"Goal met"}},
         "ring":{"state":"ready","lastSyncAt":${now - 3 * MIN},
           "hr":{"value":"62","unit":"bpm","at":${now - 4 * MIN}},
           "battery":{"value":"64","word":"Fine","at":${now - 20 * MIN}}}}
    """.trimIndent()
}
