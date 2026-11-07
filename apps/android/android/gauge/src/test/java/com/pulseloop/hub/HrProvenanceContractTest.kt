package com.pulseloop.hub

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.HrProvenance
import com.pulseloop.ring.JStyle2301Decoder
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingEventBridge
import com.pulseloop.service.EventPersistenceSubscriber
import com.pulseloop.service.RecordingWindow
import com.pulseloop.service.WorkoutHrTagger
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Audit A1/F01 contract: the ring's workout heart rate must reach the server with a declared cadence,
 * so `hrSupport.ts` gives it supported time (HR calories, zone time); all-day history must not.
 *
 * Real J-Style bytes → [JStyle2301Decoder] → [RingEventBridge] → [EventPersistenceSubscriber]
 * (Room + hub outbox) → upload JSON, then the stored rows → [HubBackfill] → upload JSON again. The
 * server's rule is mirrored in [declaredCadenceS] / [supportedSeconds] (hr-support/1).
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HrProvenanceContractTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val zone = ZoneId.of("Asia/Kolkata")
    private val workoutStart = LocalDateTime.of(2026, 10, 27, 7, 0, 0)
    private val now = Instant.parse("2026-10-27T12:00:00Z")

    // --- the server's rule (packages/companion/src/home/hrSupport.ts), mirrored

    private fun declaredCadenceS(provenance: String?, cadence: Double?): Double? = when {
        cadence != null && cadence > 0 && cadence <= 3600 -> cadence
        provenance == "device_workout" || provenance == "workout_history" -> 10.0
        else -> null
    }

    /** Σ support of samples (t ms, declared cadence s): ±min(c,60)/2 clipped at the neighbours' midpoints. */
    private fun supportedSeconds(samples: List<Pair<Long, Double?>>): Double {
        val xs = samples.sortedBy { it.first }
        var ms = 0.0
        xs.forEachIndexed { k, (t, c) ->
            if (c == null || c <= 0) return@forEachIndexed
            val h = minOf(c * 1000, 60_000.0) / 2
            var lo = t - h
            var hi = t + h
            xs.getOrNull(k - 1)?.let { lo = maxOf(lo, (it.first + t) / 2.0) }
            xs.getOrNull(k + 1)?.let { hi = minOf(hi, (t + it.first) / 2.0) }
            ms += maxOf(0.0, hi - lo)
        }
        return ms / 1000
    }

    // --- real packets

    private fun bcd(v: Int): Byte = (((v / 10) shl 4) or (v % 10)).toByte()
    private fun stamp(p: ByteArray, at: LocalDateTime) =
        listOf(at.year % 100, at.monthValue, at.dayOfMonth, at.hour, at.minute, at.second).forEachIndexed { i, v -> p[3 + i] = bcd(v) }

    /** One `0x54` workout record: 15 readings 10 s apart from [at]; a 0 is "no reading". */
    private fun workoutRecord(at: LocalDateTime, bpm: List<Int>) = ByteArray(24).also {
        it[0] = 0x54; stamp(it, at); bpm.forEachIndexed { i, v -> it[9 + i] = v.toByte() }
    }

    /** One `0x55` all-day heart-rate record. */
    private fun allDayRecord(at: LocalDateTime, bpm: Int) = ByteArray(10).also { it[0] = 0x55; stamp(it, at); it[9] = bpm.toByte() }

    private val workoutBpm = listOf(98, 104, 111, 0, 120, 126, 131, 133, 135, 138, 140, 0, 0, 142, 141)

    private fun decoded(): List<PulseEvent> {
        val decoder = JStyle2301Decoder(zone, initialFirmwareRevision = "V0789", now = { now })
        return (decoder.decode(workoutRecord(workoutStart, workoutBpm)) +
            decoder.decode(allDayRecord(workoutStart.minusMinutes(30), 72)) +
            decoder.decode(allDayRecord(workoutStart.minusMinutes(25), 70)))
            .flatMap { RingEventBridge.eventsFor(it, now) }
    }

    private fun json(payload: String): JsonObject = Json.parseToJsonElement(payload).jsonObject
    private fun JsonObject.data() = getValue("data").jsonObject
    private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.number(key: String) = this[key]?.jsonPrimitive?.doubleOrNull

    private fun hrUploads(rows: List<String>): List<JsonObject> =
        rows.map(::json).filter { it.text("category") == "metrics/hr" }.sortedBy { it.data().text("observed_at") }

    private fun assertServerContract(uploads: List<JsonObject>) {
        val workoutFrom = workoutStart.atZone(zone).toInstant()
        val (workout, allDay) = uploads.partition { !Instant.parse(it.data().text("observed_at")).isBefore(workoutFrom) }
        // The workout stream: every reading declares 10 s and the workout marker the server knows.
        assertEquals(workoutBpm.count { it > 0 }, workout.size)
        for (e in workout) {
            assertEquals("hr", e.text("subject"))
            assertEquals("health.metric.observed", e.text("type"))
            val d = e.data()
            assertEquals("hr", d.text("metric"))
            assertEquals(HrProvenance.WORKOUT_HISTORY, d.text("provenance"))
            assertEquals(10.0, d.number(BroadcastEventMapper.CADENCE_FIELD)!!, 0.0)
            assertEquals(10.0, declaredCadenceS(d.text("provenance"), d.number("cadence_s"))!!, 0.0)
        }
        val times = workout.map { Instant.parse(it.data().text("observed_at")).toEpochMilli() }
        assertTrue(times.zipWithNext().all { (a, b) -> (b - a) % 10_000L == 0L })
        // Supported time on the server: 10 s per reading, never bridging the missing ones.
        val supported = supportedSeconds(workout.map { Instant.parse(it.data().text("observed_at")).toEpochMilli() to it.data().number("cadence_s") })
        assertEquals(10.0 * workout.size, supported, 0.001)

        // All-day history: no cadence, no workout marker, so no supported time.
        assertEquals(2, allDay.size)
        for (e in allDay) {
            val d = e.data()
            assertEquals("device_history", d.text("provenance"))
            assertFalse(d.containsKey(BroadcastEventMapper.CADENCE_FIELD))
            assertNull(declaredCadenceS(d.text("provenance"), d.number("cadence_s")))
        }
    }

    @Test fun `decoder output maps to upload JSON the server gives supported time`() {
        val rows = decoded().mapNotNull { HubEventMapper.toHubOutbox(it, "inst", now)?.payloadJson }
        assertServerContract(hrUploads(rows))
    }

    @Test fun `persistence keeps the cadence and the backfill re-sends it, all-day history stays plain`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        val sub = EventPersistenceSubscriber(context, db, enabledOverride = { false }, hubInstallationIdOverride = { "inst" }, hubFlushOverride = {}, recordingOverride = { null })
        try {
            sub.persistBatch(decoded())
            // Live upload path.
            assertServerContract(hrUploads(db.hubOutboxDao().pending(1_000).map { it.payloadJson }))
            // Stored rows: cadence only on the workout stream.
            val stored = db.measurementDao().rangeReal("HEART_RATE", 0, Long.MAX_VALUE)
            val workoutFrom = workoutStart.atZone(zone).toInstant().toEpochMilli()
            assertTrue(stored.filter { it.timestamp >= workoutFrom }.all { it.cadenceS == 10 && it.sourceRaw == "history" })
            assertTrue(stored.filter { it.timestamp < workoutFrom }.all { it.cadenceS == null })

            // First-pair backfill of the same rows.
            db.hubOutboxDao().clear()
            val backfill = HubBackfill(db, FakeHubSettings("https://hub.example:8443", installationId = "inst"), now = { now })
            repeat(10) { backfill.runChunk() }
            assertServerContract(hrUploads(db.hubOutboxDao().pending(1_000).map { it.payloadJson }))
        } finally { sub.stop(); db.close() }
    }

    @Test fun `live heart rate during a recording declares its measured gap, outside it nothing changes`() = runBlocking {
        val start = Instant.parse("2026-10-27T01:30:00Z")
        var active: RecordingWindow.Active? = RecordingWindow.Active("w1", start.toEpochMilli())
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        val sub = EventPersistenceSubscriber(context, db, enabledOverride = { false }, hubInstallationIdOverride = { "inst" }, hubFlushOverride = {}, recordingOverride = { active })
        try {
            val offsets = listOf(1L, 4L, 7L, 50L, 52L) // a 43 s dropout between 7 and 50
            sub.persistBatch(offsets.map { PulseEvent.HeartRateSample(110 + it.toInt(), start.plusSeconds(it)) } +
                PulseEvent.HeartRateSample(90, start.plusSeconds(60), spot = true))
            active = null
            sub.persistBatch(listOf(PulseEvent.HeartRateSample(80, start.plusSeconds(600))))

            val uploads = hrUploads(db.hubOutboxDao().pending(1_000).map { it.payloadJson }).map { it.data() }
            assertEquals(listOf(null, 3.0, 3.0, null, 2.0, null, null), uploads.map { it.number("cadence_s") })
            assertEquals(
                listOf("device_live", "device_workout", "device_workout", "device_live", "device_workout", "device_spot", "device_live"),
                uploads.map { it.text("provenance") },
            )
            val rows = db.measurementDao().rangeReal("HEART_RATE", 0, Long.MAX_VALUE).sortedBy { it.timestamp }
            assertEquals(listOf(null, 3, 3, null, 2, null, null), rows.map { it.cadenceS })
            assertEquals(listOf("w1", "w1", "w1", "w1", "w1", null, null), rows.map { it.activitySessionId })

            db.hubOutboxDao().clear()
            val backfill = HubBackfill(db, FakeHubSettings("https://hub.example:8443", installationId = "inst"), now = { now })
            repeat(10) { backfill.runChunk() }
            val resent = hrUploads(db.hubOutboxDao().pending(1_000).map { it.payloadJson }).map { it.data() }
            assertEquals(listOf(null, 3.0, 3.0, null, 2.0, null, null), resent.map { it.number("cadence_s") })
        } finally { sub.stop(); db.close() }
    }

    @Test fun `tagger ignores spot and measurement frames and resets after a pause`() {
        var active: RecordingWindow.Active? = RecordingWindow.Active("w1", 0)
        val tagger = WorkoutHrTagger { active }
        fun hr(s: Long, spot: Boolean = false, stream: Boolean = false) =
            tagger.tag(PulseEvent.HeartRateSample(100, Instant.ofEpochSecond(s), spot = spot, measurementStream = stream)) as PulseEvent.HeartRateSample
        assertNull(hr(10).cadenceS)
        assertEquals(5, hr(15).cadenceS)
        assertNull(hr(20, spot = true).workoutSessionId)
        assertNull(hr(25, stream = true).workoutSessionId)
        assertEquals(10, hr(25).cadenceS)
        active = null // paused
        assertNull(hr(30).workoutSessionId)
        active = RecordingWindow.Active("w1", 0)
        assertNull(hr(33).cadenceS) // first after the pause: spacing not observed
        assertEquals(2, hr(35).cadenceS)
        active = RecordingWindow.Active("w2", 40_000)
        assertNull(hr(36).workoutSessionId) // before the new recording started
        assertNull(hr(41).cadenceS) // new recording: its own first sample
    }
}
