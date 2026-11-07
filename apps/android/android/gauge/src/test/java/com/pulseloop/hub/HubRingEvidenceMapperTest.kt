package com.pulseloop.hub

import com.pulseloop.ring.RING_VENDOR_ID
import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.broadcasting.RingSourceIdentity
import com.pulseloop.data.entity.ActivityEventEntity
import com.pulseloop.data.entity.ActivityGpsPointEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.SleepStage
import com.pulseloop.ring.StepSupport
import com.pulseloop.service.MetricsProfileValues
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JSON snapshots of the SPEC §2.1 rows GA owns: `ring_steps` (minute and fallback), the unchanged
 * legacy bucket, sleep with native epoch, daily with ring identity, sport telemetry, `state/sync`
 * coverage, the workout additions and `activity/gps` chunks. `received_at` is fixed so the whole
 * `data` object is the snapshot.
 */
class HubRingEvidenceMapperTest {
    private val received = Instant.parse("2026-10-21T18:45:00Z")
    private val kolkata = ZoneId.of("Asia/Kolkata")
    private val source = RingSourceIdentity(
        deviceKey = RingSourceIdentity.deviceKey("AA:BB:CC:DD:EE:01"),
        deviceModel = RING_VENDOR_ID,
        firmware = "V0789",
        decoderVersion = RingSourceIdentity.decoderVersion(RingDeviceType.JSTYLE_2301),
        zone = kolkata,
    )
    private val at = Instant.parse("2026-10-21T01:30:00Z") // 07:00 IST

    private fun row(event: PulseEvent, source: RingSourceIdentity? = this.source): HubOutboxEntity =
        HubEventMapper.toHubOutbox(event, "inst", received, source)!!

    private fun envelope(row: HubOutboxEntity): PulseCloudEvent =
        BroadcastEventMapper.json.decodeFromString(PulseCloudEvent.serializer(), row.payloadJson)

    private fun data(row: HubOutboxEntity): String = envelope(row).data.toString()

    @Test fun `device key is the first 16 hex of sha256 of the normalised MAC`() {
        assertEquals(BroadcastEventMapper.sha256("AABBCCDDEE01").take(16), source.deviceKey)
        assertEquals(source.deviceKey, RingSourceIdentity.deviceKey("aa-bb-cc-dd-ee-01"))
        assertNull(RingSourceIdentity.deviceKey(null))
        assertEquals("jstyle2301/2", source.decoderVersion)
    }

    @Test fun `minute ring steps snapshot`() {
        val event = PulseEvent.ActivityBucket(
            at.plusSeconds(60), 0, 0.0, durationS = 60, support = StepSupport.MINUTE,
            parentTotalSteps = 0, parentRecordStart = at,
        )
        val r = row(event)
        assertEquals("activity/buckets", r.category)
        assertEquals("ring_steps", envelope(r).subject)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T01:31:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"start":"2026-10-21T01:31:00Z","duration_s":60,"steps":0,"distance_m":0.0,"support":"minute",""" +
                """"parent_total_steps":0,"parent_record_start":"2026-10-21T01:30:00Z","provenance":"device_history",""" +
                """"replayed":true,"device_key":"${source.deviceKey}","device_model":"${RING_VENDOR_ID}","firmware":"V0789",""" +
                """"decoder_version":"jstyle2301/2","local_offset_min":330}""",
            data(r),
        )
    }

    @Test fun `ten-minute fallback snapshot`() {
        val event = PulseEvent.ActivityBucket(
            at, 640, 450.0, durationS = 600, support = StepSupport.TEN_MINUTE_FALLBACK,
            parentTotalSteps = 640, parentRecordStart = at,
        )
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T01:30:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"start":"2026-10-21T01:30:00Z","duration_s":600,"steps":640,"distance_m":450.0,"support":"tenMinuteFallback",""" +
                """"parent_total_steps":640,"parent_record_start":"2026-10-21T01:30:00Z","provenance":"device_history",""" +
                """"replayed":true}""",
            data(row(event, source = null)),
        )
    }

    @Test fun `legacy bucket keeps its old subject payload and id`() {
        val legacy = PulseEvent.ActivityBucket(at, 120, 80.0)
        val r = row(legacy, source = null)
        assertEquals("activity_bucket", envelope(r).subject)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T01:30:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"steps":120,"distance_m":80.0,"provenance":"device_history","replayed":true}""",
            data(r),
        )
        // Explicitly legacy-labelled rows (the backfill of a pre-v36 row) are the same event.
        assertEquals(r.eventId, row(PulseEvent.ActivityBucket(at, 120, 80.0, support = StepSupport.LEGACY_UNKNOWN), source = null).eventId)
        // New-form evidence for the same minute sits beside it rather than replacing it.
        assertNotEquals(r.eventId, row(PulseEvent.ActivityBucket(at, 120, 80.0, durationS = 60, support = StepSupport.MINUTE), source = null).eventId)
    }

    @Test fun `sleep timeline carries native epoch and raw codes`() {
        val event = PulseEvent.SleepTimeline(
            at, List(5) { SleepStage.DEEP } + List(5) { SleepStage.UNKNOWN },
            nativeEpochS = 300, rawStageCodes = listOf(1, 4),
        )
        val r = row(event, source = null)
        assertEquals("sleep/timeline", r.category)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T01:30:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"sample_interval_minutes":1,"complete_session":false,"stages":["deep","deep","deep","deep","deep",""" +
                """"unknown","unknown","unknown","unknown","unknown"],"provenance":"device_classified","replayed":true,""" +
                """"native_epoch_s":300,"stage_codes_raw":[1,4]}""",
            data(r),
        )
        // A timeline without native epoch data maps exactly as before.
        assertEquals(false, data(row(PulseEvent.SleepTimeline(at, listOf(SleepStage.LIGHT)), null)).contains("native_epoch_s"))
    }

    @Test fun `daily activity labels vendor calories and names the ring`() {
        val event = PulseEvent.ActivityUpdate(Instant.parse("2026-10-20T18:30:00Z"), 8432, 6230.0, 388.0, activeMinutes = 12)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-20T18:30:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"steps":8432,"distance_m":6230.0,"calories_kcal":388.0,"calories_label":"vendor",""" +
                """"calories_provenance":"device_estimate","calories_energy_basis":"unspecified_by_device",""" +
                """"active_minutes":12,"provenance":"device_reported","device_key":"${source.deviceKey}",""" +
                """"device_model":"${RING_VENDOR_ID}","firmware":"V0789","decoder_version":"jstyle2301/2","local_offset_min":330}""",
            data(row(event)),
        )
    }

    @Test fun `sport telemetry snapshot`() {
        val t = Instant.parse("2026-10-21T12:35:00Z")
        val r = row(PulseEvent.SportTelemetrySample(t, 1234, 56.78, 112), source = null)
        assertEquals("activity/sport_telemetry", r.category)
        val e = envelope(r)
        assertEquals("com.pulseloop.activity.sport_telemetry.v1", e.type)
        assertEquals("sport_telemetry", e.subject)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T12:35:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"t":"2026-10-21T12:35:00Z","steps_cum":1234,"kcal_cum_vendor":56.78,"bpm":112,"provenance":"device_live"}""",
            data(r),
        )
    }

    @Test fun `coverage names the whole local days inside its span`() {
        // 2026-10-19 00:00 IST .. 2026-10-21 07:00 IST: the 19th and 20th are whole days.
        val event = PulseEvent.HistoryCoverage(
            "activity_detail", Instant.parse("2026-10-18T18:30:00Z"), at, complete = true, reason = "overlap",
        )
        val r = row(event)
        assertEquals("state/sync", r.category)
        assertEquals("coverage.activity_detail", envelope(r).subject)
        assertEquals(
            """{"schema_version":1,"observed_at":"2026-10-21T18:45:00Z","received_at":"2026-10-21T18:45:00Z",""" +
                """"stream":"activity_detail","from":"2026-10-18T18:30:00Z","to":"2026-10-21T01:30:00Z",""" +
                """"fromDay":"2026-10-19","toDay":"2026-10-20","complete":true,"reason":"overlap",""" +
                """"device_key":"${source.deviceKey}","device_model":"${RING_VENDOR_ID}","firmware":"V0789",""" +
                """"decoder_version":"jstyle2301/2","local_offset_min":330}""",
            data(r),
        )
        val partial = BroadcastEventMapper.coverageValues(
            PulseEvent.HistoryCoverage("heart_rate", Instant.parse("2026-10-20T19:00:00Z"), at, false, "bounded"), kolkata,
        )
        assertEquals("null", partial.getValue("fromDay").toString())
        assertEquals("null", partial.getValue("toDay").toString())
    }

    // ── Workouts (GA.6) ─────────────────────────────────────────────────────

    private val start = Instant.parse("2026-10-21T12:30:00Z").toEpochMilli()
    private val end = start + 40 * 60_000L
    private val session = ActivitySessionEntity(
        id = "w-1", type = "walk", statusRaw = "finished", startedAt = start, endedAt = end,
        totalPauseSeconds = 300.0, calories = 180.4, distanceMeters = 3000.0, avgHeartRate = 112.0,
        maxHeartRate = 131.0, perceivedEffort = "moderate", createdAt = start, updatedAt = end,
    )
    private val gps = (0 until 501).map { i ->
        ActivityGpsPointEntity(
            id = "p$i", sessionId = "w-1", latitude = 12.97 + i * 1e-5, longitude = 77.59,
            altitude = if (i == 0) 900.5 else null, horizontalAccuracy = if (i == 0) 4.0 else null,
            speed = if (i == 0) 1.3 else null, timestamp = start + i * 1000L, accepted = i != 1,
        )
    }

    @Test fun `pauses come from the lifecycle markers and an open pause ends with the session`() {
        val events = listOf(
            ActivityEventEntity(sessionId = "w-1", kind = "paused", timestamp = start + 600_000),
            ActivityEventEntity(sessionId = "w-1", kind = "gps_stopped", timestamp = start + 600_000),
            ActivityEventEntity(sessionId = "w-1", kind = "resumed", timestamp = start + 780_000),
            ActivityEventEntity(sessionId = "w-1", kind = "paused", timestamp = end - 120_000),
        )
        assertEquals(
            listOf(HubWorkoutMapper.Pause(start + 600_000, start + 780_000), HubWorkoutMapper.Pause(end - 120_000, end)),
            HubWorkoutMapper.pauses(events, start, end),
        )
    }

    @Test fun `workout snapshot adds pauses moving time energy basis and the kcal method`() {
        val pauses = listOf(HubWorkoutMapper.Pause(start + 600_000, start + 780_000), HubWorkoutMapper.Pause(end - 120_000, end))
        val data = HubWorkoutMapper.data(session, gps, emptyList(), 30, received, pauses, MetricsProfileValues("male", 30, 80.0))!!
        val added = JsonObject(data.filterKeys { it in setOf("zones_version", "pauses", "moving_s", "energy_basis", "kcal_method", "kcal_version", "perceived_effort", "gps_points_ref") })
        assertEquals(
            """{"pauses":[{"start":"2026-10-21T12:40:00Z","end":"2026-10-21T12:43:00Z"},""" +
                """{"start":"2026-10-21T13:08:00Z","end":"2026-10-21T13:10:00Z"}],"moving_s":2100,""" +
                """"energy_basis":"gross","kcal_method":"acsm_level","kcal_version":"gauge-workout-metrics/1",""" +
                """"perceived_effort":"moderate","gps_points_ref":{"category":"activity/gps","subject_prefix":"w-1:",""" +
                """"chunks":2,"points":501}}""",
            added.toString(),
        )
        // The legacy numbers are untouched.
        assertEquals("180.4", data.getValue("kcal").toString())
        assertEquals("2100", data.getValue("durationS").toString())
    }

    @Test fun `kcal method mirrors the engine's branches`() {
        val hr = (0 until 35).map { HubWorkoutMapper.HrSample(start + it * 60_000L, 120.0) }
        val noRoute = session.copy(distanceMeters = null)
        val profile = MetricsProfileValues("female", 40, 60.0)
        assertEquals("keytel", HubWorkoutMapper.kcalMethod(noRoute, 2100, hr, profile))
        assertEquals("met", HubWorkoutMapper.kcalMethod(noRoute, 2100, hr.take(5), profile))
        assertEquals("met", HubWorkoutMapper.kcalMethod(noRoute.copy(type = "gym"), 2100, hr, profile))
        assertNull(HubWorkoutMapper.kcalMethod(noRoute.copy(calories = null), 2100, hr, profile))
    }

    @Test fun `zones keep their legacy meaning with a version`() {
        val hr = listOf(HubWorkoutMapper.HrSample(start, 100.0), HubWorkoutMapper.HrSample(start + 60_000, 150.0))
        val data = HubWorkoutMapper.data(session, emptyList(), hr, 30, received)!!
        assertEquals("\"gauge-220-age-5min\"", data.getValue("zones_version").toString())
    }

    @Test fun `gps chunks hold at most 500 points and flag rejected fixes`() {
        val rows = HubWorkoutMapper.gpsChunks(session, gps, "inst", received)
        assertEquals(2, rows.size)
        assertEquals(listOf("activity/gps", "activity/gps"), rows.map { it.category })
        val first = envelope(rows[0])
        assertEquals("com.pulseloop.activity.gps.v1", first.type)
        assertEquals("w-1:0", first.subject)
        assertEquals("w-1:1", envelope(rows[1]).subject)
        val points = first.data.getValue("points").toString()
        assertEquals(500, Regex("\"t\":").findAll(points).count())
        assertEquals(
            """{"t":"2026-10-21T12:30:00Z","lat":12.97,"lon":77.59,"alt":900.5,"acc":4.0,"speed":1.3,"accepted":true}""",
            points.substringAfter('[').substringBefore('}') + "}",
        )
        assertEquals(true, points.contains(""""acc":null,"accepted":false"""))
        assertEquals("2026-10-21T12:38:20Z", envelope(rows[1]).time)
        // Stable ids: the same fixes re-sent are the same events.
        assertEquals(rows.map { it.eventId }, HubWorkoutMapper.gpsChunks(session, gps.reversed(), "inst", received.plusSeconds(60)).map { it.eventId })
    }
}
