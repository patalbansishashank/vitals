package com.pulseloop.service

import com.pulseloop.data.entity.ActivityEventEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The activity a recording was started as (0.6.3 S26/A24).
 *
 * Vitals starts a recording with its coarse type (`walk | run | cycle | other`, unchanged since
 * 2.8.0) and, from 2.8.1, the catalogue activity id the person picked (`treadmill_run`, `air_bike`,
 * `mudgar_pair`, ...; Vitals `src/content/catalogues/exercises.ts` and `activityTypes.ts`). Gauge
 * keeps that id on the session and uploads it as `activity_type_id`; it never interprets energy
 * from it. Separately it picks the **sport type** the ring is told about: one of Gauge's own
 * workout types ([com.pulseloop.ui.components.ActivityMeta.ORDER]), which each ring driver maps to
 * whatever sport modes its firmware has (J-Style: run, walk; Colmi: walk, run, cycle, hike, yoga,
 * else "other sports"). An id this table doesn't know still travels; only the ring falls back to
 * the coarse type.
 */
object RecordingActivityType {
    /** The catalogue's id shape: lowercase words joined by `_`, at most [MAX_ID_LENGTH] characters. */
    private val ID = Regex("^[a-z0-9][a-z0-9_]{0,47}$")
    const val MAX_ID_LENGTH = 48

    fun isValidId(id: String): Boolean = ID.matches(id)

    /**
     * The Gauge workout type the ring's sport mode follows: the catalogue id's own family when this
     * table knows it, else [coarseType] (old commands carry no id and behave exactly as before).
     */
    fun sportTypeFor(activityTypeId: String?, coarseType: String): String =
        activityTypeId?.let(::familyOf) ?: coarseType

    /** The Gauge workout type of a known catalogue id, or null. */
    internal fun familyOf(id: String): String? {
        EXACT[id]?.let { return it }
        return PREFIXES.firstOrNull { (prefix, _) -> id.startsWith(prefix) }?.second
            ?: if (id.endsWith("asana")) "yoga" else null
    }

    private val WALK = listOf(
        "walk", "brisk_walk", "walk_brisk", "treadmill_incline_walk", "treadmill_desk_slow", "treadmill_walk", "rucking",
    )
    private val RUN = listOf("jog_outdoor", "treadmill_run", "run", "running", "jog")
    private val CYCLE = listOf("cycle_outdoor", "stationary_bike", "spin_class", "bike_hiit", "air_bike", "air_cycling")
    private val HIKE = listOf("hike")
    private val YOGA = listOf("hatha_yoga", "power_yoga", "surya_namaskar", "pilates", "pilates_mat", "stretching", "yoga")
    private val DANCE = listOf("dance_general", "garba", "zumba", "step_aerobics")
    private val SPORT = listOf(
        "badminton", "cricket", "football", "kabaddi", "kho_kho", "tennis", "table_tennis", "basketball",
        "volleyball", "boxing", "boxing_bag", "martial_arts",
    )
    private val GYM = listOf(
        "strength_general", "calisthenics", "circuit", "circuit_kb", "hiit_bodyweight", "dumbbells", "kettlebells",
        "mudgar", "gada", "push_up", "pull_up", "dip", "burpee", "farmer_carry", "suitcase_carry", "turkish_getup",
    )

    private val EXACT: Map<String, String> = buildMap {
        WALK.forEach { put(it, "walk") }
        RUN.forEach { put(it, "run") }
        CYCLE.forEach { put(it, "cycle") }
        HIKE.forEach { put(it, "hike") }
        YOGA.forEach { put(it, "yoga") }
        DANCE.forEach { put(it, "dance") }
        SPORT.forEach { put(it, "sport") }
        GYM.forEach { put(it, "gym") }
    }

    /** Families named by an id's leading word (`bb_back_squat`, `mudgar_pair`, `kushti_drill`, ...). */
    private val PREFIXES = listOf(
        "treadmill_" to "walk",
        "bb_" to "gym", "db_" to "gym", "kb_" to "gym", "band_" to "gym",
        "mudgar_" to "gym", "gada_" to "gym", "dand" to "gym", "baithak" to "gym", "kushti_" to "gym",
        "mallakhamb_" to "gym",
    )
}

/**
 * What a recording was started as, kept on the session's `started` [ActivityEventEntity]
 * (payload JSON; no schema change) and read back for the upload. [gpsUnavailable] is the reason a
 * requested route was not recorded ([WorkoutGpsAccess]); a later `gps_unavailable` event (the
 * foreground service refused `location`) overrides it.
 */
data class RecordingStart(
    val activityTypeId: String?,
    val sportType: String,
    val gpsRequested: Boolean,
    val gpsUnavailable: String?,
) {
    fun toJson(): String = buildJsonObject {
        activityTypeId?.let { put("activity_type_id", JsonPrimitive(it)) }
        put("sport_type", JsonPrimitive(sportType))
        put("gps_requested", JsonPrimitive(gpsRequested))
        gpsUnavailable?.let { put("gps_unavailable", JsonPrimitive(it)) }
    }.toString()

    companion object {
        const val STARTED_EVENT = "started"
        const val GPS_UNAVAILABLE_EVENT = "gps_unavailable"

        fun gpsUnavailablePayload(reason: String): String =
            buildJsonObject { put("reason", JsonPrimitive(reason)) }.toString()

        /** The session's start metadata, or null for a session recorded before 2.8.1 (no `started` event). */
        fun fromEvents(events: List<ActivityEventEntity>): RecordingStart? {
            val sorted = events.sortedBy { it.timestamp }
            val started = sorted.firstOrNull { it.kind == STARTED_EVENT }?.payloadJSON?.let(::parse) ?: return null
            fun text(o: JsonObject, key: String) =
                (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val id = text(started, "activity_type_id")?.takeIf(RecordingActivityType::isValidId)
            val sport = text(started, "sport_type") ?: return null
            val requested = (started["gps_requested"] as? JsonPrimitive)?.content == "true"
            val later = sorted.lastOrNull { it.kind == GPS_UNAVAILABLE_EVENT }?.payloadJSON?.let(::parse)?.let { text(it, "reason") }
            return RecordingStart(id, sport, requested, later ?: text(started, "gps_unavailable"))
        }

        private fun parse(raw: String): JsonObject? =
            runCatching { Json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
    }
}
