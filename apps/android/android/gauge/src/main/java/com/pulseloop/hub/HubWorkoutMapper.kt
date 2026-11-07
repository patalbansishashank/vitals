package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.data.entity.ActivityEventEntity
import com.pulseloop.data.entity.ActivityGpsPointEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.service.HeartRateZones
import com.pulseloop.service.MetricsProfileValues
import com.pulseloop.service.RecordingStart
import com.pulseloop.service.WorkoutMetricsEngine
import java.time.Instant
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Recorded workouts for the home server (contract §2, "Workouts"): category `activity/session`,
 * type `com.pulseloop.activity.session.v1`, subject = the session id, observed at the session's
 * start. A changed session is a new event with the same subject (its data, so its id, differs);
 * the server keeps the newest by `received_at`. A cancelled or deleted session becomes a deletion
 * whose range covers that `observed_at`.
 */
object HubWorkoutMapper {
    const val TYPE = "com.pulseloop.activity.session.v1"
    const val CATEGORY = "activity/session"

    /** The server rejects a span over 7 days; such a row is a broken recording, not a workout. */
    internal const val MAX_SPAN_MS = 7L * 86_400_000L
    /** A gap longer than this between two HR readings is not counted as time in a zone. */
    internal const val MAX_HR_GAP_MS = 5L * 60_000L
    /** Keeps the encoded polyline well under the server's 256 KiB route limit. */
    internal const val MAX_ROUTE_POINTS = 10_000
    internal const val MAX_ROUTE_CHARS = 250_000

    /** SPEC §2.1 `activity/gps`: GPS fixes travel in their own chunked events, not in the session. */
    const val GPS_TYPE = "com.pulseloop.activity.gps.v1"
    const val GPS_CATEGORY = "activity/gps"
    internal const val GPS_POINTS_PER_EVENT = 500

    /**
     * How the uploaded `kcal` was computed: Gauge's own [WorkoutMetricsEngine] estimate, labelled
     * so Vitals can recompute (GA.6). The numbers are not changed here. Bump [KCAL_VERSION] when
     * that engine's equations change.
     */
    const val KCAL_VERSION = "gauge-workout-metrics/1"
    /** The legacy `zones` meaning: 220 − age %HRmax bands, each reading held up to 5 min. */
    const val ZONES_VERSION = "gauge-220-age-5min"

    data class HrSample(val timestamp: Long, val bpm: Double)

    /** One pause, epoch millis, half-open `[start, end)`. */
    data class Pause(val start: Long, val end: Long)

    /** One finished session as an upload row, or null when it is not a valid finished workout. */
    fun toHubOutbox(
        session: ActivitySessionEntity,
        gps: List<ActivityGpsPointEntity>,
        heartRate: List<HrSample>,
        age: Int?,
        installationId: String,
        receivedAt: Instant,
        pauses: List<Pause> = emptyList(),
        profile: MetricsProfileValues? = null,
        recording: RecordingStart? = null,
    ): HubOutboxEntity? {
        val data = data(session, gps, heartRate, age, receivedAt, pauses, profile, recording) ?: return null
        val observedAt = Instant.ofEpochMilli(session.startedAt)
        val identity = JsonObject(data.filterKeys { it != "received_at" })
        val eventId = "pl-" + BroadcastEventMapper.sha256("$TYPE|${session.id}|$observedAt|$identity").take(40)
        val envelope = PulseCloudEvent(
            id = eventId,
            type = TYPE,
            source = "urn:pulseloop:installation:$installationId",
            subject = session.id,
            time = observedAt.toString(),
            data = data,
            category = CATEGORY,
        )
        return HubOutboxEntity(
            eventId = eventId,
            category = CATEGORY,
            payloadJson = BroadcastEventMapper.json.encodeToString(envelope),
            createdAt = receivedAt.toEpochMilli(),
        )
    }

    /** Hides a session the owner cancelled or deleted: kind = the session id, range around its start. */
    fun deletion(session: ActivitySessionEntity, installationId: String, deletedAt: Instant): HubOutboxEntity =
        HubEventMapper.deletion(
            buildJsonObject {
                put("category", CATEGORY)
                put("kind", session.id)
                put("from", Instant.ofEpochMilli(session.startedAt - 60_000).toString())
                put("to", Instant.ofEpochMilli(session.startedAt + 60_000).toString())
            },
            installationId,
            deletedAt,
        )

    /**
     * The session's GPS fixes as `activity/gps` events of at most [GPS_POINTS_PER_EVENT] points,
     * subject `<session id>:<chunk n>`, observed at the chunk's first fix. Rejected fixes travel
     * too, flagged `accepted:false`, so the server can see what the route filter dropped.
     */
    fun gpsChunks(
        session: ActivitySessionEntity,
        gps: List<ActivityGpsPointEntity>,
        installationId: String,
        receivedAt: Instant,
    ): List<HubOutboxEntity> {
        val points = gps.filter { it.latitude.isFinite() && it.longitude.isFinite() }.sortedWith(compareBy({ it.timestamp }, { it.id }))
        return points.chunked(GPS_POINTS_PER_EVENT).mapIndexed { n, chunk ->
            val subject = "${session.id}:$n"
            val observedAt = Instant.ofEpochMilli(chunk.first().timestamp)
            val data = buildJsonObject {
                put("schema_version", 1)
                put("observed_at", observedAt.toString())
                put("received_at", receivedAt.toString())
                put("session_id", session.id)
                put("chunk", n)
                put("points", JsonArray(chunk.map { p ->
                    buildJsonObject {
                        put("t", Instant.ofEpochMilli(p.timestamp).toString())
                        put("lat", p.latitude)
                        put("lon", p.longitude)
                        p.altitude?.takeIf { it.isFinite() }?.let { put("alt", it) }
                        put("acc", p.horizontalAccuracy?.takeIf { it.isFinite() }?.let(::JsonPrimitive) ?: JsonNull)
                        p.speed?.takeIf { it.isFinite() && it >= 0 }?.let { put("speed", it) }
                        put("accepted", p.accepted)
                    }
                }))
            }
            val identity = JsonObject(data.filterKeys { it != "received_at" })
            val eventId = "pl-" + BroadcastEventMapper.sha256("$GPS_TYPE|$subject|$observedAt|$identity").take(40)
            HubOutboxEntity(
                eventId = eventId,
                category = GPS_CATEGORY,
                payloadJson = BroadcastEventMapper.json.encodeToString(PulseCloudEvent(
                    id = eventId,
                    type = GPS_TYPE,
                    source = "urn:pulseloop:installation:$installationId",
                    subject = subject,
                    time = observedAt.toString(),
                    data = data,
                    category = GPS_CATEGORY,
                )),
                createdAt = receivedAt.toEpochMilli(),
            )
        }
    }

    /** Hides a cancelled or deleted session's GPS chunks: every chunk observed inside its span. */
    fun gpsDeletion(session: ActivitySessionEntity, installationId: String, deletedAt: Instant): HubOutboxEntity =
        HubEventMapper.deletion(
            buildJsonObject {
                put("category", GPS_CATEGORY)
                put("from", Instant.ofEpochMilli(session.startedAt - 60_000).toString())
                put("to", Instant.ofEpochMilli(maxOf(session.endedAt ?: session.startedAt, session.lastGpsPointAt ?: 0L) + 60_000).toString())
            },
            installationId,
            deletedAt,
        )

    /**
     * Pauses from the session's `paused` / `resumed` lifecycle markers, clipped to the session. A
     * pause still open at the end (finished while paused) closes at the session's end.
     */
    fun pauses(events: List<ActivityEventEntity>, start: Long, end: Long): List<Pause> {
        val out = mutableListOf<Pause>()
        var open: Long? = null
        for (event in events.sortedBy { it.timestamp }) {
            when (event.kind) {
                "paused" -> if (open == null) open = event.timestamp
                "resumed" -> open?.let { out += Pause(it, event.timestamp); open = null }
            }
        }
        open?.let { out += Pause(it, end) }
        return out.mapNotNull { p ->
            val a = p.start.coerceIn(start, end)
            val b = p.end.coerceIn(start, end)
            if (b > a) Pause(a, b) else null
        }
    }

    /**
     * Which [WorkoutMetricsEngine.calories] branch produced the session's kcal, re-derived from the
     * same inputs [com.pulseloop.service.ActivityAggregates.recompute] gives it (its gates are
     * mirrored here; its numbers are not touched). `acsm_level`: ACSM level-grade walk/run from
     * route speed; `keytel`: Keytel 2005 HR regression; `met`: Compendium MET by type.
     */
    internal fun kcalMethod(
        session: ActivitySessionEntity,
        movingS: Long,
        heartRate: List<HrSample>,
        profile: MetricsProfileValues?,
    ): String? {
        if (session.calories == null || movingS <= 0) return null
        val speed = session.distanceMeters?.takeIf { it.isFinite() && it > 0 }?.div(movingS)
        if (WorkoutMetricsEngine.acsmMetValue(session.type, speed) != null) return "acsm_level"
        if (session.type in setOf("walk", "run", "cycle", "hike") && keytelEligible(movingS, heartRate, profile)) return "keytel"
        return "met"
    }

    private fun keytelEligible(movingS: Long, heartRate: List<HrSample>, profile: MetricsProfileValues?): Boolean {
        val p = profile ?: return false
        if (p.sex?.lowercase() !in setOf("male", "female")) return false
        val age = p.age ?: return false
        val weight = p.weightKg ?: return false
        if (age !in 18..80 || !weight.isFinite() || weight !in 20.0..350.0) return false
        val minutes = movingS / 60.0
        val covered = heartRate.filter { it.bpm.isFinite() && it.bpm in 90.0..180.0 }
            .map { it.timestamp / 60_000L }.distinct().size
        return covered > 0 && covered / minutes >= WorkoutMetricsEngine.KEYTEL_COVERAGE_THRESHOLD
    }

    internal fun data(
        session: ActivitySessionEntity,
        gps: List<ActivityGpsPointEntity>,
        heartRate: List<HrSample>,
        age: Int?,
        receivedAt: Instant,
        pauses: List<Pause> = emptyList(),
        profile: MetricsProfileValues? = null,
        recording: RecordingStart? = null,
    ): JsonObject? {
        if (session.statusRaw != "finished") return null
        val end = session.endedAt ?: return null
        val start = session.startedAt
        if (end < start || end - start > MAX_SPAN_MS) return null
        val spanS = (end - start) / 1000.0
        val durationS = (spanS - session.totalPauseSeconds.coerceAtLeast(0.0)).coerceIn(0.0, spanS).roundToLong()
        val route = route(gps)
        val zones = zones(heartRate, start, end, age)
        return buildJsonObject {
            put("schema_version", 1)
            put("observed_at", Instant.ofEpochMilli(start).toString())
            put("received_at", receivedAt.toString())
            put("start", Instant.ofEpochMilli(start).toString())
            put("end", Instant.ofEpochMilli(end).toString())
            put("type", label(session.type))
            put("source", source(session, route != null))
            put("durationS", durationS)
            session.distanceMeters?.takeIf { it.isFinite() && it >= 0 }?.let { put("distanceM", round1(it)) }
            session.calories?.takeIf { it.isFinite() && it >= 0 }?.let { put("kcal", round1(it)) }
            heartRateOrNull(session.avgHeartRate)?.let { put("avgHr", it) }
            heartRateOrNull(session.maxHeartRate)?.let { put("maxHr", it) }
            zones?.let { z ->
                putJsonObject("zones") { z.forEach { (k, v) -> put(k, v) } }
                put("zones_version", ZONES_VERSION)
            }
            route?.let { (polyline, points) ->
                putJsonObject("route") {
                    put("polyline", polyline)
                    put("points", points)
                }
            }
            // SPEC §2.1 activity/session additions (GA.6).
            put("pauses", JsonArray(pauses.map { p ->
                buildJsonObject {
                    put("start", Instant.ofEpochMilli(p.start).toString())
                    put("end", Instant.ofEpochMilli(p.end).toString())
                }
            }))
            put("moving_s", durationS)
            if (session.calories?.takeIf { it.isFinite() && it >= 0 } != null) {
                put("energy_basis", "gross")
                kcalMethod(session, durationS, heartRate, profile)?.let { put("kcal_method", it) }
                put("kcal_version", KCAL_VERSION)
            }
            session.perceivedEffort?.takeIf { it.isNotBlank() }?.let { put("perceived_effort", it) }
            // 0.6.3 S26/S20: what the recording was started as. Absent for sessions recorded before
            // 2.8.1 (no `started` event), so their events keep their ids.
            recording?.let { st ->
                st.activityTypeId?.let { put("activity_type_id", it) }
                put("sport_type", label(st.sportType))
                if (st.gpsRequested) put("gps_requested", true)
                st.gpsUnavailable?.let { put("gps_unavailable", label(it)) }
            }
            val fixes = gps.count { it.latitude.isFinite() && it.longitude.isFinite() }
            if (fixes > 0) {
                putJsonObject("gps_points_ref") {
                    put("category", GPS_CATEGORY)
                    put("subject_prefix", "${session.id}:")
                    put("chunks", (fixes + GPS_POINTS_PER_EVENT - 1) / GPS_POINTS_PER_EVENT)
                    put("points", fixes)
                }
            }
        }
    }

    /** `gauge_gps` when a route was recorded, `gauge_live` for a live session without one, else `gauge_manual`. */
    internal fun source(session: ActivitySessionEntity, hasRoute: Boolean): String = when {
        hasRoute -> "gauge_gps"
        session.hrPollCount > 0 || session.liveActivityID != null || session.lastSensorPollAt != null -> "gauge_live"
        else -> "gauge_manual"
    }

    /** Short lowercase label; the server accepts short labels only. */
    internal fun label(type: String): String =
        BroadcastEventMapper.safeTopicSegment(type).take(32)

    private fun heartRateOrNull(value: Double?): Int? =
        value?.takeIf { it.isFinite() }?.roundToInt()?.takeIf { it in 20..260 }

    private fun round1(value: Double): Double = (value * 10).roundToLong() / 10.0

    /**
     * Seconds per heart-rate zone (`rest`, `fat_burn`, `cardio`, `peak`, `max`), from the HR readings
     * stored during the session: each reading holds until the next, capped at [MAX_HR_GAP_MS].
     * Null with fewer than two readings in the session.
     */
    internal fun zones(heartRate: List<HrSample>, start: Long, end: Long, age: Int?): Map<String, Long>? {
        val inside = heartRate.filter { it.timestamp in start..end && it.bpm.isFinite() && it.bpm > 0 }
            .sortedBy { it.timestamp }
        if (inside.size < 2) return null
        val seconds = LinkedHashMap<String, Long>().apply { ZONE_KEYS.values.forEach { put(it, 0L) } }
        val effectiveAge = age?.takeIf { it in 10..100 } ?: 30
        for (i in 0 until inside.size - 1) {
            val dt = (inside[i + 1].timestamp - inside[i].timestamp).coerceIn(0, MAX_HR_GAP_MS)
            val key = ZONE_KEYS.getValue(HeartRateZones.zoneFor(inside[i].bpm.roundToInt(), effectiveAge))
            seconds[key] = seconds.getValue(key) + dt / 1000
        }
        return seconds
    }

    private val ZONE_KEYS = mapOf(
        HeartRateZones.Zone.REST to "rest",
        HeartRateZones.Zone.FAT_BURN to "fat_burn",
        HeartRateZones.Zone.CARDIO to "cardio",
        HeartRateZones.Zone.PEAK to "peak",
        HeartRateZones.Zone.MAX to "max",
    )

    /** The accepted fixes as a Google encoded polyline, thinned evenly when very long. */
    internal fun route(gps: List<ActivityGpsPointEntity>): Pair<String, Int>? {
        val points = gps.filter { it.accepted && it.latitude.isFinite() && it.longitude.isFinite() }
            .sortedBy { it.timestamp }
            .map { it.latitude to it.longitude }
        if (points.isEmpty()) return null
        var keep = points.size.coerceAtMost(MAX_ROUTE_POINTS)
        while (true) {
            val thinned = thin(points, keep)
            val encoded = encodePolyline(thinned)
            if (encoded.length <= MAX_ROUTE_CHARS || keep <= 2) return encoded to thinned.size
            keep /= 2
        }
    }

    private fun thin(points: List<Pair<Double, Double>>, keep: Int): List<Pair<Double, Double>> {
        if (points.size <= keep) return points
        val step = (points.size - 1).toDouble() / (keep - 1)
        return List(keep) { i -> points[(i * step).roundToInt().coerceAtMost(points.size - 1)] }
    }

    /** Google's encoded polyline algorithm, precision 1e5. */
    fun encodePolyline(points: List<Pair<Double, Double>>): String {
        val out = StringBuilder()
        var lastLat = 0L
        var lastLng = 0L
        for ((lat, lng) in points) {
            val la = Math.round(lat * 1e5)
            val ln = Math.round(lng * 1e5)
            encodeSigned(la - lastLat, out)
            encodeSigned(ln - lastLng, out)
            lastLat = la
            lastLng = ln
        }
        return out.toString()
    }

    private fun encodeSigned(value: Long, out: StringBuilder) {
        var v = value shl 1
        if (value < 0) v = v.inv()
        while (v >= 0x20) {
            out.append(((0x20 or (v and 0x1f).toInt()) + 63).toChar())
            v = v shr 5
        }
        out.append((v.toInt() + 63).toChar())
    }
}
