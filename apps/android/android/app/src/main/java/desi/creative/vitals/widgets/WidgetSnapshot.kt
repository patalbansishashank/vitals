package desi.creative.vitals.widgets

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the web app last published for the home-screen widgets (web side: src/platform/widgets.ts, `VitalsWidgets.publish`).
 * Widgets cannot run the web app, so this is a small, already-formatted snapshot: figures arrive as display strings
 * ("1 240", "7 h 12"), exactly as the app writes them, plus the instants the widget turns into clock times or parts of
 * the day itself, and (r071) the small series the pictures draw.
 *
 * Quiet mode (words only, no digits, 0.6.3 S31) is enforced here as well as on the web side: a quiet snapshot keeps no
 * figure at all, no line or bar, and any word carrying a digit is dropped; ratios, the night's stages and instants stay
 * (the widget says instants as parts of the day, never as clock times). Weight is only ever in it when the person turned
 * on "Show weight on the home screen"; the web side does not send it otherwise.
 *
 * Every field added since version 1 is optional: a snapshot from an older web bundle parses (the new pictures are then
 * empty), and one from a newer bundle has keys this parser never reads. The wire version stays 1.
 */
data class WidgetSnapshot(
    /** When the web app published it (epoch ms). */
    val at: Long,
    val quiet: Boolean,
    val today: TodayPart?,
    val ring: RingPart?,
    /** The trend weight, only with the person's opt-in (r071). */
    val body: BodyPart? = null,
) {
    data class TodayPart(
        /** The app's local day these figures belong to (YYYY-MM-DD). */
        val date: String,
        val energy: Energy?,
        val steps: Fill?,
        val heartPoints: Fill?,
        val sleep: Sleep?,
        /**
         * When the app's day ends (epoch ms): the app's day rolls over at 04:00, so until then the figures are still today's
         * although the calendar says tomorrow. Null (an older web bundle): the calendar day decides.
         */
        val until: Long? = null,
    )

    /** A small picture's data: values in 0..1 (null = no reading, a gap), `now` the live index, `ahead` a dotted forecast tail. */
    data class Series(val y: List<Double?>, val now: Int? = null, val ahead: List<Double?>? = null)

    /** A night's stage run: its place in 0..1 of the recorded window, and a level: 0 awake, 1 REM, 2 light, 3 deep, 4 asleep and not staged. */
    data class StageSpan(val from: Double, val to: Double, val stage: Int)

    /** Energy so far: "1 240" kcal, its scenario range "1 120–1 360". Never in quiet mode. */
    data class Energy(
        val value: String,
        val unit: String,
        val range: String?,
        /** Burned so far over the likely day. */
        val ratio: Double? = null,
        /** The likely day ("2 595"). */
        val likely: String? = null,
        /** "On plan" · "Over plan" · "Under plan". */
        val state: String? = null,
        val series: Series? = null,
    )

    /** A figure against a goal (steps of the goal, the week's Heart Points of 150); `word` is the quiet reading. */
    data class Fill(
        val value: String?,
        val goal: String?,
        val ratio: Double?,
        val word: String?,
        /** The course of the day in words ("On course"). */
        val state: String? = null,
        /** The likely total by bedtime. */
        val likely: String? = null,
        val series: Series? = null,
    )

    /** Last night's sleep: "7 h 12"; `word` is the quiet reading ("Goal met"). */
    data class Sleep(
        val value: String?,
        val word: String?,
        val goal: String? = null,
        val ratio: Double? = null,
        val onset: Long? = null,
        val wake: Long? = null,
        val stages: List<StageSpan>? = null,
    )

    data class RingPart(
        /** ready · unpaired · unreachable · empty (the app's RingTodayState, without loading). */
        val state: String,
        val hr: Hr?,
        val battery: Battery?,
        /** Gauge's last upload to the server (epoch ms), as the app last saw it. */
        val lastSyncAt: Long?,
    )

    data class Hr(
        val value: String?,
        val unit: String,
        val at: Long,
        /** The reading in words ("Normal"). */
        val state: String? = null,
        /** The day's low and high ("50–90"). */
        val range: String? = null,
        val series: Series? = null,
    )

    /** `word`: "Fine" / "Low" (the app's quiet battery word); `at` the reading's instant. */
    data class Battery(val value: String?, val word: String?, val at: Long?)

    /** Present when the person turned weight on for the home screen; `weight` is null until there is a trend to show. */
    data class BodyPart(val weight: Weight?)

    /** The trend weight: "85.2" kg, where it stands (ahead · onTrack · behind) and the last weeks as a line. */
    data class Weight(val value: String?, val unit: String, val state: String?, val series: Series? = null)

    /** The snapshot as stored: only what survived parsing (a quiet one keeps no figure). */
    fun toJson(): JSONObject {
        val o = JSONObject().put("v", VERSION).put("at", at).put("quiet", quiet)
        today?.let { t ->
            val j = JSONObject().put("date", t.date).putOpt("until", t.until)
            t.energy?.let { e ->
                j.put(
                    "energy",
                    JSONObject().put("value", e.value).put("unit", e.unit).putOpt("range", e.range).putOpt("ratio", e.ratio)
                        .putOpt("likely", e.likely).putOpt("state", e.state).putOpt("series", e.series?.let(::seriesJson)),
                )
            }
            t.steps?.let { j.put("steps", fillJson(it)) }
            t.heartPoints?.let { j.put("heartPoints", fillJson(it)) }
            t.sleep?.let { s ->
                j.put(
                    "sleep",
                    JSONObject().putOpt("value", s.value).putOpt("word", s.word).putOpt("goal", s.goal).putOpt("ratio", s.ratio)
                        .putOpt("onset", s.onset).putOpt("wake", s.wake)
                        .putOpt("stages", s.stages?.let { st -> JSONArray().also { a -> st.forEach { a.put(JSONArray().put(it.from).put(it.to).put(it.stage)) } } }),
                )
            }
            o.put("today", j)
        }
        ring?.let { r ->
            val j = JSONObject().put("state", r.state).putOpt("lastSyncAt", r.lastSyncAt)
            r.hr?.let {
                j.put(
                    "hr",
                    JSONObject().putOpt("value", it.value).put("unit", it.unit).put("at", it.at).putOpt("state", it.state).putOpt("range", it.range)
                        .putOpt("series", it.series?.let(::seriesJson)),
                )
            }
            r.battery?.let { j.put("battery", JSONObject().putOpt("value", it.value).putOpt("word", it.word).putOpt("at", it.at)) }
            o.put("ring", j)
        }
        body?.let { b ->
            val j = JSONObject()
            b.weight?.let { w -> j.put("weight", JSONObject().putOpt("value", w.value).put("unit", w.unit).putOpt("state", w.state).putOpt("series", w.series?.let(::seriesJson))) }
            o.put("body", j)
        }
        return o
    }

    private fun fillJson(f: Fill): JSONObject =
        JSONObject().putOpt("value", f.value).putOpt("goal", f.goal).putOpt("ratio", f.ratio).putOpt("word", f.word)
            .putOpt("state", f.state).putOpt("likely", f.likely).putOpt("series", f.series?.let(::seriesJson))

    private fun seriesJson(s: Series): JSONObject {
        fun arr(xs: List<Double?>) = JSONArray().also { a -> xs.forEach { a.put(it ?: JSONObject.NULL) } }
        return JSONObject().put("y", arr(s.y)).putOpt("now", s.now).putOpt("ahead", s.ahead?.let(::arr))
    }

    companion object {
        const val VERSION = 1

        /** The highest snapshot revision this build reads and draws (`status().contract`: the web builds series only for 2 or more). */
        const val CONTRACT = 2

        /** A display string longer than this is not a widget figure: dropped. */
        private const val MAX_TEXT = 48

        /** The longest series, and the most stage runs, a widget takes (the web's WIDGET_SERIES_MAX, WIDGET_STAGES_MAX). */
        const val MAX_SERIES = 48
        const val MAX_STAGES = 64
        private val RING_STATES = setOf("ready", "unpaired", "unreachable", "empty")
        private val WEIGHT_STATES = setOf("ahead", "onTrack", "behind")
        private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")
        private val DIGIT = Regex("""\d""")

        /** The stored or published JSON, or null when it is not a version-1 snapshot. */
        fun parse(json: String?): WidgetSnapshot? {
            if (json.isNullOrBlank()) return null
            return try {
                parse(JSONObject(json))
            } catch (e: Exception) {
                null
            }
        }

        fun parse(o: JSONObject): WidgetSnapshot? {
            if (o.optInt("v", -1) != VERSION) return null
            val at = o.optLong("at", 0L).takeIf { it > 0 } ?: return null
            val quiet = o.optBoolean("quiet", false)
            return WidgetSnapshot(
                at = at,
                quiet = quiet,
                today = o.optJSONObject("today")?.let { today(it, quiet) },
                ring = o.optJSONObject("ring")?.let { ring(it, quiet) },
                body = o.optJSONObject("body")?.let { body(it, quiet) },
            )
        }

        private fun today(o: JSONObject, quiet: Boolean): TodayPart? {
            val date = o.optString("date").takeIf { DATE.matches(it) } ?: return null
            return TodayPart(
                date = date,
                // quiet: no calorie talk at all
                energy = if (quiet) null else o.optJSONObject("energy")?.let { e ->
                    val value = text(e, "value") ?: return@let null
                    Energy(
                        value = value,
                        unit = text(e, "unit") ?: "kcal",
                        range = text(e, "range"),
                        ratio = ratio(e, "ratio"),
                        likely = text(e, "likely"),
                        state = word(e, "state"),
                        series = series(e.optJSONObject("series")),
                    )
                },
                steps = o.optJSONObject("steps")?.let { fill(it, quiet) },
                heartPoints = o.optJSONObject("heartPoints")?.let { fill(it, quiet) },
                sleep = o.optJSONObject("sleep")?.let { sleep(it, quiet) },
                until = instant(o, "until"),
            )
        }

        private fun fill(o: JSONObject, quiet: Boolean): Fill? {
            val f = Fill(
                value = if (quiet) null else text(o, "value"),
                goal = if (quiet) null else text(o, "goal"),
                ratio = ratio(o, "ratio"),
                word = word(o, "word"),
                state = word(o, "state"),
                likely = if (quiet) null else text(o, "likely"),
                series = if (quiet) null else series(o.optJSONObject("series")),
            )
            return f.takeIf { it.value != null || it.word != null }
        }

        private fun sleep(s: JSONObject, quiet: Boolean): Sleep? {
            val v = Sleep(
                value = if (quiet) null else text(s, "value"),
                word = word(s, "word"),
                goal = if (quiet) null else text(s, "goal"),
                ratio = ratio(s, "ratio"),
                onset = instant(s, "onset"),
                wake = instant(s, "wake"),
                // the app draws the hypnogram in quiet mode too
                stages = stages(s.optJSONArray("stages")),
            )
            return v.takeIf { it.value != null || it.word != null || it.ratio != null || it.stages != null }
        }

        private fun ring(o: JSONObject, quiet: Boolean): RingPart {
            val state = o.optString("state").takeIf { it in RING_STATES } ?: "empty"
            return RingPart(
                state = state,
                hr = o.optJSONObject("hr")?.let { h ->
                    val at = instant(h, "at") ?: return@let null
                    Hr(
                        value = if (quiet) null else text(h, "value"),
                        unit = text(h, "unit") ?: "bpm",
                        at = at,
                        state = word(h, "state"),
                        range = if (quiet) null else text(h, "range"),
                        series = if (quiet) null else series(h.optJSONObject("series")),
                    )
                },
                battery = o.optJSONObject("battery")?.let { b ->
                    Battery(if (quiet) null else text(b, "value"), word(b, "word"), instant(b, "at")).takeIf { it.value != null || it.word != null }
                },
                lastSyncAt = instant(o, "lastSyncAt"),
            )
        }

        private fun body(o: JSONObject, quiet: Boolean): BodyPart = BodyPart(
            o.optJSONObject("weight")?.let { w ->
                val state = text(w, "state")?.takeIf { it in WEIGHT_STATES }
                // quiet mode: the trend weight as a word only
                Weight(
                    value = if (quiet) null else text(w, "value"),
                    unit = text(w, "unit") ?: "kg",
                    state = state,
                    series = if (quiet) null else series(w.optJSONObject("series")),
                ).takeIf { it.value != null || it.state != null }
            },
        )

        private fun text(o: JSONObject, key: String): String? {
            if (!o.has(key) || o.isNull(key)) return null
            val s = o.optString(key).trim()
            return s.takeIf { it.isNotEmpty() && it.length <= MAX_TEXT }
        }

        /** A word: words only, so one carrying a digit is dropped (the app's `wordsOnly`), in either mode. */
        private fun word(o: JSONObject, key: String): String? = text(o, key)?.takeIf { !DIGIT.containsMatchIn(it) }

        private fun ratio(o: JSONObject, key: String): Double? =
            if (o.has(key) && !o.isNull(key)) o.optDouble(key).takeIf { it.isFinite() && it >= 0 } else null

        private fun instant(o: JSONObject, key: String): Long? =
            if (o.has(key) && !o.isNull(key)) o.optLong(key, 0L).takeIf { it > 0 } else null

        private fun values(a: JSONArray?): List<Double?>? {
            if (a == null) return null
            val out = ArrayList<Double?>(minOf(a.length(), MAX_SERIES))
            for (i in 0 until minOf(a.length(), MAX_SERIES)) {
                out.add(if (a.isNull(i)) null else a.optDouble(i).takeIf { it.isFinite() }?.coerceIn(0.0, 1.0))
            }
            return out
        }

        /** A series with something to draw, or null. */
        fun series(o: JSONObject?): Series? {
            if (o == null) return null
            val y = values(o.optJSONArray("y"))?.takeIf { l -> l.any { it != null } } ?: return null
            val now = if (o.has("now") && !o.isNull("now")) o.optInt("now", -1).takeIf { it in y.indices } else null
            val ahead = values(o.optJSONArray("ahead"))?.takeIf { l -> l.any { it != null } }
            return Series(y, now, ahead)
        }

        private fun stages(a: JSONArray?): List<StageSpan>? {
            if (a == null) return null
            val out = ArrayList<StageSpan>()
            for (i in 0 until minOf(a.length(), MAX_STAGES)) {
                val r = a.optJSONArray(i) ?: continue
                if (r.length() < 3 || r.isNull(0) || r.isNull(1) || r.isNull(2)) continue
                val from = r.optDouble(0)
                val to = r.optDouble(1)
                val stage = r.optInt(2, -1)
                if (from.isFinite() && to.isFinite() && from >= 0 && to <= 1 && to > from && stage in 0..4) out.add(StageSpan(from, to, stage))
            }
            return out.takeIf { it.isNotEmpty() }
        }
    }
}
