package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.data.entity.ActivityGpsPointEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import java.time.Instant
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.double
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubWorkoutMapperTest {
    private val start = Instant.parse("2026-10-27T06:00:00Z").toEpochMilli()
    private val end = start + 40 * 60_000L
    private val received = Instant.parse("2026-10-27T07:00:00Z")

    private fun session(
        status: String = "finished",
        pauseS: Double = 300.0,
        avgHr: Double? = 142.4,
        maxHr: Double? = 171.0,
    ) = ActivitySessionEntity(
        id = "s-1", type = "run", statusRaw = status, startedAt = start, endedAt = end,
        totalPauseSeconds = pauseS, calories = 401.26, distanceMeters = 6012.34,
        avgHeartRate = avgHr, maxHeartRate = maxHr, useGps = true, gpsPointCount = 3,
        createdAt = start, updatedAt = end,
    )

    private fun gps(lat: Double, lng: Double, i: Int, accepted: Boolean = true) =
        ActivityGpsPointEntity(id = "p$i", sessionId = "s-1", latitude = lat, longitude = lng, timestamp = start + i * 1000L, accepted = accepted)

    private val route = listOf(gps(38.5, -120.2, 0), gps(40.7, -120.95, 1), gps(43.252, -126.453, 2))

    private fun decode(row: com.pulseloop.data.entity.HubOutboxEntity) =
        BroadcastEventMapper.json.decodeFromString(PulseCloudEvent.serializer(), row.payloadJson)

    @Test fun `encodes Google's reference polyline`() {
        assertEquals(
            "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
            HubWorkoutMapper.encodePolyline(listOf(38.5 to -120.2, 40.7 to -120.95, 43.252 to -126.453)),
        )
    }

    @Test fun `a finished session maps to the contract's activity session event`() {
        val hr = listOf(
            HubWorkoutMapper.HrSample(start, 100.0),
            HubWorkoutMapper.HrSample(start + 60_000, 150.0),
            HubWorkoutMapper.HrSample(start + 120_000, 180.0),
        )
        val row = HubWorkoutMapper.toHubOutbox(session(), route, hr, age = 30, installationId = "inst", receivedAt = received)!!
        assertEquals("activity/session", row.category)
        val event = decode(row)
        assertEquals("com.pulseloop.activity.session.v1", event.type)
        assertEquals("activity/session", event.category)
        assertEquals("s-1", event.subject)
        assertEquals("urn:pulseloop:installation:inst", event.source)
        val d = event.data
        assertEquals(1, d["schema_version"]!!.jsonPrimitive.int)
        assertEquals("2026-10-27T06:00:00Z", d["observed_at"]!!.jsonPrimitive.content)
        assertEquals("2026-10-27T06:00:00Z", d["start"]!!.jsonPrimitive.content)
        assertEquals("2026-10-27T06:40:00Z", d["end"]!!.jsonPrimitive.content)
        assertEquals("run", d["type"]!!.jsonPrimitive.content)
        assertEquals("gauge_gps", d["source"]!!.jsonPrimitive.content)
        // 40 min span minus the 5 min pause: moving time, never above span + 60 s.
        assertEquals(2100L, d["durationS"]!!.jsonPrimitive.long)
        assertEquals(6012.3, d["distanceM"]!!.jsonPrimitive.double, 0.0)
        assertEquals(401.3, d["kcal"]!!.jsonPrimitive.double, 0.0)
        assertEquals(142, d["avgHr"]!!.jsonPrimitive.int)
        assertEquals(171, d["maxHr"]!!.jsonPrimitive.int)
        val zones = d["zones"]!!.jsonObject
        assertEquals(setOf("rest", "fat_burn", "cardio", "peak", "max"), zones.keys)
        // 100 bpm at age 30 is 52 % of max (rest), 150 is 78 % (cardio); the last reading has no successor.
        assertEquals(60L, zones["rest"]!!.jsonPrimitive.long)
        assertEquals(60L, zones["cardio"]!!.jsonPrimitive.long)
        assertEquals(0L, zones["max"]!!.jsonPrimitive.long)
        val r = d["route"]!!.jsonObject
        assertEquals("_p~iF~ps|U_ulLnnqC_mqNvxq`@", r["polyline"]!!.jsonPrimitive.content)
        assertEquals(3, r["points"]!!.jsonPrimitive.int)
        assertEquals(setOf("schema_version", "observed_at", "received_at", "start", "end", "type", "source",
            "durationS", "distanceM", "kcal", "avgHr", "maxHr", "zones", "route",
            // SPEC GA.6 additions.
            "zones_version", "pauses", "moving_s", "energy_basis", "kcal_method", "kcal_version", "gps_points_ref"), d.keys)
    }

    @Test fun `a 2_8_1 session uploads its catalogue activity id, sport type and gps outcome`() {
        val recording = com.pulseloop.service.RecordingStart("treadmill_run", "run", gpsRequested = true, gpsUnavailable = "gps_permission_missing")
        val d = HubWorkoutMapper.data(session(), emptyList(), emptyList(), 30, received, recording = recording)!!
        assertEquals("treadmill_run", d["activity_type_id"]!!.jsonPrimitive.content)
        assertEquals("run", d["sport_type"]!!.jsonPrimitive.content)
        assertEquals("true", d["gps_requested"]!!.jsonPrimitive.content)
        assertEquals("gps_permission_missing", d["gps_unavailable"]!!.jsonPrimitive.content)
        assertEquals("run", d["type"]!!.jsonPrimitive.content)

        // Without a start record (older sessions) the shape and so the event id are unchanged.
        val old = HubWorkoutMapper.toHubOutbox(session(), route, emptyList(), 30, "inst", received)!!
        val oldAgain = HubWorkoutMapper.toHubOutbox(session(), route, emptyList(), 30, "inst", received, recording = null)!!
        assertEquals(old.eventId, oldAgain.eventId)
        val keys = decode(old).data.keys
        for (k in listOf("activity_type_id", "sport_type", "gps_requested", "gps_unavailable")) assertFalse(k in keys)
        // A coarse start with no id and no gps request adds only the sport type.
        val coarse = HubWorkoutMapper.data(session(), emptyList(), emptyList(), 30, received,
            recording = com.pulseloop.service.RecordingStart(null, "walk", gpsRequested = false, gpsUnavailable = null))!!
        assertFalse("activity_type_id" in coarse.keys)
        assertFalse("gps_requested" in coarse.keys)
        assertEquals("walk", coarse["sport_type"]!!.jsonPrimitive.content)
    }

    @Test fun `the id ignores delivery time and changes with the data`() {
        val a = HubWorkoutMapper.toHubOutbox(session(), route, emptyList(), 30, "inst", received)!!
        val b = HubWorkoutMapper.toHubOutbox(session(), route, emptyList(), 30, "inst", received.plusSeconds(3600))!!
        val edited = HubWorkoutMapper.toHubOutbox(session(avgHr = 150.0), route, emptyList(), 30, "inst", received)!!
        assertEquals(a.eventId, b.eventId)
        assertNotEquals(a.eventId, edited.eventId)
        assertTrue(a.eventId.startsWith("pl-"))
    }

    @Test fun `only finished sessions upload and bad values are left out`() {
        assertNull(HubWorkoutMapper.toHubOutbox(session(status = "recording"), route, emptyList(), 30, "inst", received))
        assertNull(HubWorkoutMapper.toHubOutbox(session().copy(endedAt = null), route, emptyList(), 30, "inst", received))
        assertNull(HubWorkoutMapper.toHubOutbox(session().copy(endedAt = start + 8 * 86_400_000L), route, emptyList(), 30, "inst", received))
        val d = decode(HubWorkoutMapper.toHubOutbox(
            session(avgHr = 7.0, maxHr = 400.0, pauseS = 99_999.0), emptyList(), emptyList(), 30, "inst", received,
        )!!).data
        assertFalse("avgHr" in d)
        assertFalse("maxHr" in d)
        assertFalse("zones" in d)
        assertFalse("route" in d)
        assertEquals(0L, d["durationS"]!!.jsonPrimitive.long)
        // No route and no live polls: the owner logged it by hand.
        assertEquals("gauge_manual", d["source"]!!.jsonPrimitive.content)
    }

    @Test fun `rejected fixes are not part of the route`() {
        val (_, points) = HubWorkoutMapper.route(route + gps(0.0, 0.0, 9, accepted = false))!!
        assertEquals(3, points)
    }

    @Test fun `a very long route is thinned under the server limit`() {
        val many = List(40_000) { i -> gps(51.0 + i * 0.0001, -0.1 - (i % 7) * 0.0003, i) }
        val (polyline, points) = HubWorkoutMapper.route(many)!!
        assertTrue(points <= HubWorkoutMapper.MAX_ROUTE_POINTS)
        assertTrue(polyline.length <= HubWorkoutMapper.MAX_ROUTE_CHARS)
    }

    @Test fun `a deleted session becomes a deletion covering its observed_at`() {
        val row = HubWorkoutMapper.deletion(session(status = "deleted"), "inst", received)
        val event = decode(row)
        assertEquals("com.pulseloop.deletion.v1", event.type)
        val target = event.data["target"]!!.jsonObject
        assertEquals("activity/session", target["category"]!!.jsonPrimitive.content)
        assertEquals("s-1", target["kind"]!!.jsonPrimitive.content)
        val from = Instant.parse(target["from"]!!.jsonPrimitive.content).toEpochMilli()
        val to = Instant.parse(target["to"]!!.jsonPrimitive.content).toEpochMilli()
        assertTrue(start in from..to)
    }
}
