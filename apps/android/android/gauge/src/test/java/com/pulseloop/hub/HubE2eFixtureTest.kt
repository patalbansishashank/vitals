package com.pulseloop.hub

import com.pulseloop.ring.RING_VENDOR_ID
import com.pulseloop.broadcasting.RingSourceIdentity
import com.pulseloop.data.entity.ActivityEventEntity
import com.pulseloop.data.entity.ActivityGpsPointEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.ring.JStyle2301Decoder
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.RingEventBridge
import com.pulseloop.ring.SleepStage
import com.pulseloop.ring.WearableCapability
import com.pulseloop.service.MetricsProfileValues
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The upload fixture for the home server's end-to-end test (Vitals repo,
 * `packages/companion/scripts/lumen-e2e.mjs`): two days of realistic history built by the app's own
 * [HubEventMapper], in the order the phone would send it, plus a revised reading, a reading
 * deletion, a Reset App Data and the history the ring hands back afterwards. Group `ringEvidence`
 * holds SPEC GA's §2.1 ring rows (native step support, sleep epochs, sport telemetry, coverage,
 * workout pauses and GPS chunks) for the server's S1/S2 packages.
 *
 * Always checks the fixture; writes it as JSON when `LUMEN_HUB_FIXTURE_OUT` names a file:
 * `LUMEN_HUB_FIXTURE_OUT=/abs/path.json ./gradlew :app:testDebugUnitTest --tests '*HubE2eFixture*'`.
 */
class HubE2eFixtureTest {
    @Test fun `builds the e2e upload fixture from the app's mapper`() {
        val fixture = build()
        val groups = fixture.getValue("groups").jsonObject
        val all = groups.values.flatMap { (it as JsonArray).map { e -> e.jsonObject } }
        // Every event carries the hub envelope and a category; ids are the mapper's.
        for (e in all) {
            assertEquals("1.0", (e.getValue("specversion") as JsonPrimitive).content)
            assertTrue(e.containsKey("category"))
            assertTrue((e.getValue("id") as JsonPrimitive).content.startsWith("pl-"))
            assertEquals("urn:pulseloop:installation:$INSTALLATION", (e.getValue("source") as JsonPrimitive).content)
        }
        assertTrue((groups.getValue("history") as JsonArray).size > 500)
        // SPEC GA §2.1 ring rows, for S1/S2.
        val ring = (groups.getValue("ringEvidence") as JsonArray).map { it.jsonObject }
        fun subject(e: JsonObject) = (e.getValue("subject") as JsonPrimitive).content
        fun data(e: JsonObject) = e.getValue("data").jsonObject
        val steps = ring.filter { subject(it) == "ring_steps" }
        assertTrue("every covered minute, zeros included", steps.count { (data(it).getValue("support") as JsonPrimitive).content == "minute" } >= 60)
        assertTrue(steps.any { (data(it).getValue("support") as JsonPrimitive).content == "tenMinuteFallback" })
        assertTrue(steps.all { data(it).containsKey("device_key") && data(it).containsKey("local_offset_min") })
        assertTrue(ring.any { subject(it) == "activity_bucket" })
        assertTrue(ring.any { subject(it) == "sleep_timeline" && data(it).containsKey("native_epoch_s") })
        assertTrue(ring.any { (it.getValue("category") as JsonPrimitive).content == "activity/sport_telemetry" })
        assertTrue(ring.any { subject(it).startsWith("coverage.") })
        assertTrue(ring.any { (it.getValue("category") as JsonPrimitive).content == "activity/gps" })
        assertTrue(ring.any { (it.getValue("category") as JsonPrimitive).content == "activity/session" && data(it).containsKey("pauses") })
        System.getenv("LUMEN_HUB_FIXTURE_OUT")?.takeIf { it.isNotBlank() }?.let { path ->
            File(path).apply { parentFile?.mkdirs() }.writeText(Json { prettyPrint = false }.encodeToString(JsonObject.serializer(), fixture))
        }
    }

    companion object {
        /** Lumen's installation id format: its MQTT id, 32 lowercase hex. */
        const val INSTALLATION = "5e2d8c41a7f94b0e9c3d1f6a2b7e8d90"
        val ZONE: ZoneId = ZoneId.of("Asia/Kolkata")
        val DAY1: LocalDate = LocalDate.of(2026, 10, 20)
        val DAY2: LocalDate = LocalDate.of(2026, 10, 21)

        /** When the phone received the history (after both days), deleted one reading, reset, and re-synced. */
        val RECEIVED: Instant = Instant.parse("2026-10-21T18:45:00Z")
        val REVISED: Instant = Instant.parse("2026-10-21T18:50:00Z")
        val DELETED: Instant = Instant.parse("2026-10-21T19:00:00Z")
        val RESET: Instant = Instant.parse("2026-10-21T20:00:00Z")
        val RESENT: Instant = Instant.parse("2026-10-21T21:00:00Z")

        private fun at(day: LocalDate, h: Int, m: Int = 0): Instant = day.atTime(h, m).atZone(ZONE).toInstant()

        /** The deleted HR reading (day 2, 12:00 local) and the revised one (day 2, 09:00 local). */
        val DELETED_HR_AT: Instant = at(DAY2, 12, 0)
        val REVISED_HR_AT: Instant = at(DAY2, 9, 0)
        const val REVISED_HR_VALUE = 99.0

        fun hrValue(i: Int): Double = 58.0 + (i * 7 % 25)

        private fun sleepStages(count: Int, offset: Int): List<SleepStage> = (0 until count).map { i ->
            when ((i + offset) % 90) {
                in 0..9 -> SleepStage.AWAKE.takeIf { i + offset < 10 } ?: SleepStage.LIGHT
                in 10..39 -> SleepStage.LIGHT
                in 40..64 -> SleepStage.DEEP
                in 65..79 -> SleepStage.LIGHT
                else -> SleepStage.REM
            }
        }

        private fun map(events: List<PulseEvent>, receivedAt: Instant): List<HubOutboxEntity> =
            events.map { HubEventMapper.toHubOutbox(it, INSTALLATION, receivedAt) ?: error("unmapped $it") }

        /** Day [day]'s ring history (what a sync hands over), oldest first per kind. */
        private fun dayHistory(day: LocalDate, dayIndex: Int): List<PulseEvent> {
            val out = mutableListOf<PulseEvent>()
            for (slot in 0 until 144) { // HR every 10 min
                out += PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, hrValue(slot + dayIndex), at(day, slot / 6, (slot % 6) * 10))
            }
            for (h in 0 until 24) {
                out += PulseEvent.HistoryMeasurement(MeasurementKind.HRV, 38.0 + (h * 5 + dayIndex) % 30, at(day, h, 5))
                out += PulseEvent.HistoryMeasurement(MeasurementKind.SPO2, 95.0 + (h + dayIndex) % 5, at(day, h, 7))
                out += PulseEvent.TemperatureSample(36.1 + ((h + dayIndex) % 6) / 10.0, at(day, h, 15), isHistory = true)
                out += PulseEvent.TemperatureSample(36.2 + ((h + dayIndex) % 5) / 10.0, at(day, h, 45), isHistory = true)
            }
            for (h in listOf(9, 13, 18)) out += PulseEvent.StressSample(30 + h + dayIndex, at(day, h, 20), isHistory = true)
            out += PulseEvent.BloodPressureSample(118 + dayIndex, 77 + dayIndex, at(day, 8, 30), isHistory = true)
            out += PulseEvent.VendorMetric("vascular_age", 39.0 + dayIndex, "years", at(day, 8, 35), isHistory = true)
            // Activity: hourly buckets 07–21 and the climbing daily total every 2 hours.
            var steps = 0
            for (h in 7..21) {
                val bucket = 300 + (h * 37 + dayIndex * 11) % 400
                steps += bucket
                out += PulseEvent.ActivityBucket(at(day, h), bucket, bucket * 0.72)
                if (h % 2 == 1 || h == 21) {
                    out += PulseEvent.ActivityUpdate(at(day, h, 59), steps, steps * 0.72, steps * 0.045, activeMinutes = steps / 120)
                }
            }
            // Scores derived on the phone for the day.
            out += PulseEvent.DerivedInsight("sleep_score", 80.0 + dayIndex * 3, "score", at(day, 0), "medium", "lumen-sleep-v2", mapOf("asleep_min" to 405.0 + dayIndex))
            out += PulseEvent.DerivedInsight("recovery_score", 70.0 + dayIndex * 4, "score", at(day, 0), "low", "lumen-recovery-v1", mapOf("hrv_ms" to 45.0), note = "Few nights of baseline")
            return out
        }

        /** The night of day 1 → day 2: 23:10–06:40 local in two packets, as the ring hands it over. */
        private fun night(): List<PulseEvent> {
            val start = at(DAY1, 23, 10)
            return listOf(
                PulseEvent.SleepTimeline(start, sleepStages(200, 0)),
                PulseEvent.SleepTimeline(start.plusSeconds(200 * 60L), sleepStages(250, 200), completeSession = true),
            )
        }

        /** Live device state as the phone reports it on connect (observed = received). */
        private fun deviceState(): List<PulseEvent> = listOf(
            PulseEvent.DeviceStateChanged(RingConnectionState.CONNECTED, address = "AA:BB:CC:DD:EE:FF", firmware = "MOY-R1K3-2.1.6", name = "R11C_1234", deviceType = RingDeviceType.COLMI_R02),
            PulseEvent.DeviceIdentified(RingDeviceType.COLMI_R02, wearableModelID = "colmi_r11c", advertisedName = "R11C_1234", capabilities = setOf(WearableCapability.HEART_RATE, WearableCapability.SPO2, WearableCapability.SLEEP, WearableCapability.STEPS)),
            PulseEvent.BatteryLevel(76),
            PulseEvent.FirmwareRevision("MOY-R1K3-2.1.6"),
            PulseEvent.WearState(true),
            PulseEvent.SyncProgress("complete"),
        )

        /** The J-Style 2301 ring of the GA fixture day: what `EventPersistenceSubscriber` stamps on its uploads. */
        val RING = RingSourceIdentity(
            deviceKey = RingSourceIdentity.deviceKey("C0:FF:EE:00:23:01"),
            deviceModel = RING_VENDOR_ID,
            firmware = "V0789",
            decoderVersion = RingSourceIdentity.decoderVersion(RingDeviceType.JSTYLE_2301),
            zone = ZONE,
        )

        private fun bcd(value: Int): Byte = (((value / 10) shl 4) or (value % 10)).toByte()

        private fun stamp(packet: ByteArray, local: java.time.LocalDateTime, offset: Int = 3) {
            listOf(local.year % 100, local.monthValue, local.dayOfMonth, local.hour, local.minute, local.second)
                .forEachIndexed { i, v -> packet[offset + i] = bcd(v) }
        }

        /** One `0x52` record at [local]: [total] steps on the record, [minutes] per minute. */
        private fun detail(local: java.time.LocalDateTime, total: Int, distanceDm: Int, minutes: List<Int>): ByteArray =
            ByteArray(25).also {
                it[0] = 0x52; stamp(it, local)
                it[9] = total.toByte(); it[10] = (total ushr 8).toByte()
                it[13] = distanceDm.toByte(); it[14] = (distanceDm ushr 8).toByte()
                minutes.forEachIndexed { i, v -> it[15 + i] = v.toByte() }
            }

        /**
         * Day 2 as the GA decoder hands it over, through the real decoder → bridge → mapper path:
         * - 07:00–07:30 a treadmill walk with the hands on the keyboard: the ring is blind, so it
         *   reports three all-zero records (observed zero minutes, not missing ones);
         * - 08:00 a record whose minutes are zero but whose total is 640 (the marked fallback);
         * - 09:00 a mixed record whose parent total (150) disagrees with its minutes (144);
         * - 18:00–18:40 a GPS walk in ring sport mode (0x18 frames, flag-on decoder), paused once;
         * - the night before in a 34-byte (5-minute) and a 130-byte (1-minute) sleep record;
         * - the day's 0x51 total, coverage statements and one legacy bucket from before v36.
         */
        private fun ringEvidence(): List<HubOutboxEntity> {
            val now = RESENT
            val decoder = JStyle2301Decoder(ZONE, initialFirmwareRevision = "V0789", now = { at(DAY2, 18, 5) }, sportTelemetryEnabled = true)
            fun bridged(packet: ByteArray) = decoder.decode(packet).flatMap { RingEventBridge.eventsFor(it, now) }
            val events = mutableListOf<PulseEvent>()
            for (k in 0 until 3) events += bridged(detail(DAY2.atTime(7, k * 10), 0, 0, List(10) { 0 }))
            events += bridged(detail(DAY2.atTime(8, 0), 640, 45, List(10) { 0 }))
            events += bridged(detail(DAY2.atTime(9, 0), 150, 10, listOf(0, 12, 0, 30, 0, 0, 95, 0, 0, 7)))
            for (k in 0 until 4) events += bridged(detail(DAY2.atTime(18, k * 10), 1100, 80, List(10) { 110 }))
            events += bridged(ByteArray(34).also {
                it[0] = 0x53; stamp(it, DAY1.atTime(23, 10)); it[9] = 24
                for (i in 0 until 24) it[10 + i] = (if (i < 2) 5 else if (i % 3 == 0) 1 else 2).toByte()
            })
            events += bridged(ByteArray(130).also {
                it[0] = 0x53; stamp(it, DAY2.atTime(1, 10)); it[9] = 120
                for (i in 0 until 120) it[10 + i] = (if (i % 40 < 25) 2 else 3).toByte()
            })
            events += bridged(ByteArray(27).also {
                it[0] = 0x51; it[2] = bcd(DAY2.year % 100); it[3] = bcd(DAY2.monthValue); it[4] = bcd(DAY2.dayOfMonth)
                val steps = 5_904; for (i in 0 until 4) it[5 + i] = (steps ushr (8 * i)).toByte()
                val kcal = 21_850; for (i in 0 until 4) it[17 + i] = (kcal ushr (8 * i)).toByte()
            })
            events += bridged(ByteArray(16).also {
                it[0] = 0x18; it[1] = 112
                val steps = 1_234; for (i in 0 until 4) it[2 + i] = (steps ushr (8 * i)).toByte()
                val kcal = 5_678; for (i in 0 until 4) it[6 + i] = (kcal ushr (8 * i)).toByte()
            })
            events += PulseEvent.HistoryCoverage("activity_detail", at(DAY1, 0, 0), at(DAY2, 18, 40), complete = true, reason = "overlap")
            events += PulseEvent.HistoryCoverage("heart_rate", at(DAY2, 6, 0), at(DAY2, 18, 40), complete = false, reason = "bounded")
            val ring = events.filter { it !is PulseEvent.HeartRateSample }.map {
                HubEventMapper.toHubOutbox(it, INSTALLATION, now, RING) ?: error("unmapped $it")
            }
            val legacy = map(listOf(PulseEvent.ActivityBucket(at(DAY1, 12, 0), 420, 300.0)), now)

            val start = at(DAY2, 18, 0).toEpochMilli()
            val end = at(DAY2, 18, 40).toEpochMilli()
            val walk = ActivitySessionEntity(
                id = "walk-day2", type = "walk", statusRaw = "finished", startedAt = start, endedAt = end,
                totalPauseSeconds = 180.0, calories = 182.6, distanceMeters = 3_150.0, avgHeartRate = 112.0,
                maxHeartRate = 128.0, useGps = true, gpsPointCount = 600, hrPollCount = 120, createdAt = start, updatedAt = end,
            )
            val gps = (0 until 600).map { i ->
                ActivityGpsPointEntity(id = "g$i", sessionId = walk.id, latitude = 12.9716 + i * 4e-5, longitude = 77.5946,
                    horizontalAccuracy = 5.0, speed = 1.4, timestamp = start + i * 4_000L, accepted = i % 50 != 7)
            }
            val pauses = HubWorkoutMapper.pauses(listOf(
                ActivityEventEntity(sessionId = walk.id, kind = "paused", timestamp = start + 1_200_000),
                ActivityEventEntity(sessionId = walk.id, kind = "resumed", timestamp = start + 1_380_000),
            ), start, end)
            val hr = (0 until 40).map { HubWorkoutMapper.HrSample(start + it * 60_000L, 105.0 + it % 20) }
            val session = HubWorkoutMapper.toHubOutbox(walk, gps, hr, 34, INSTALLATION, now, pauses,
                MetricsProfileValues("male", 34, 78.0))!!
            return legacy + ring + session + HubWorkoutMapper.gpsChunks(walk, gps, INSTALLATION, now)
        }

        fun build(): JsonObject {
            val history = map(dayHistory(DAY1, 0) + night() + dayHistory(DAY2, 1), RECEIVED) + map(deviceState(), RECEIVED) +
                // A live spot reading taken in the app that evening.
                map(listOf(PulseEvent.HeartRateSample(64, at(DAY2, 21, 33), spot = true)), Instant.parse("2026-10-21T16:03:30Z"))
            // The ring re-reports the 09:00 reading with a corrected value: new id, newer received_at.
            val revised = map(listOf(PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, REVISED_HR_VALUE, REVISED_HR_AT)), REVISED)
            val deletion = HubEventMapper.measurementDeletions(
                listOf(MeasurementEntity(id = "history:hr:${DELETED_HR_AT.toEpochMilli()}", kindRaw = "HEART_RATE", value = 0.0, unit = "bpm", timestamp = DELETED_HR_AT.toEpochMilli(), sourceRaw = "history")),
                INSTALLATION, DELETED,
            )
            val reset = listOf(HubEventMapper.resetAll(INSTALLATION, RESET))
            // After the reset the ring hands day 2 and the night back (same ids, newer received_at).
            val resent = map(night() + dayHistory(DAY2, 1).filter { it is PulseEvent.HistoryMeasurement && it.kind == MeasurementKind.HEART_RATE || it is PulseEvent.ActivityBucket }, RESENT)
            fun arr(rows: List<HubOutboxEntity>) = JsonArray(rows.map { Json.parseToJsonElement(it.payloadJson) })
            return buildJsonObject {
                put("generatedBy", "LumenHealth app/src/test/java/com/pulseloop/hub/HubE2eFixtureTest.kt")
                put("installationId", INSTALLATION)
                put("timeZone", ZONE.id)
                put("day1", DAY1.toString())
                put("day2", DAY2.toString())
                put("deletedHrAt", DELETED_HR_AT.toString())
                put("revisedHrAt", REVISED_HR_AT.toString())
                put("revisedHrValue", REVISED_HR_VALUE)
                put("groups", buildJsonObject {
                    put("history", arr(history))
                    put("revised", arr(revised))
                    put("deletion", arr(deletion))
                    put("reset", arr(reset))
                    put("resent", arr(resent))
                    put("ringEvidence", arr(ringEvidence()))
                })
            }
        }
    }
}
