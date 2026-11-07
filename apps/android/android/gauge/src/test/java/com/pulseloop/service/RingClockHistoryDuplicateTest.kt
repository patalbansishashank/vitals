package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.hub.HubEventMapper
import com.pulseloop.ring.JStyle2301Decoder
import com.pulseloop.ring.JStyle2301Driver
import com.pulseloop.ring.JStyle2301UUIDs
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingClockSegment
import com.pulseloop.ring.RingClockStore
import com.pulseloop.ring.RingDecodedEvent
import com.pulseloop.ring.RingEventBridge
import com.pulseloop.ring.SleepStage
import com.pulseloop.util.TimeUtil
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The 2.7.3 duplicates for every ring-history type, end to end through the real J-Style driver,
 * bridge and store. Values are the owner's ring's Oct 22 records as the server holds them: the
 * 03:29:30 HRV record (raw 28 = 19 ms, HR 65, stress 45, BP estimate 115/60) and the 01:43:59 sleep
 * packet (30 minutes). A second HR reading of 65 one second later stands for the real one-second
 * neighbours the server's pre-update history is full of: it must survive every pass.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RingClockHistoryDuplicateTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val zone = ZoneId.of("Asia/Kolkata")
    private val setAt = Instant.parse("2026-10-26T23:36:41.882Z")
    private val offsetMs = 383_118L

    private val hrvAt = LocalDateTime.of(2026, 10, 22, 3, 29, 30)
    private val sleepAt = LocalDateTime.of(2026, 10, 22, 1, 43, 59)
    /** a = awake, l = light, d = deep, as the server stored the packet. */
    private val sleepStages = "alllllllllllllllldddlddddddddd"

    private class MemoryStore(var segments: List<RingClockSegment> = emptyList()) : RingClockStore {
        override fun load() = segments
        override fun save(segments: List<RingClockSegment>) { this.segments = segments }
    }

    private fun bcd(v: Int) = (((v / 10) shl 4) or (v % 10)).toByte()
    private fun stamp(at: LocalDateTime) =
        byteArrayOf(bcd(at.year % 100), bcd(at.monthValue), bcd(at.dayOfMonth), bcd(at.hour), bcd(at.minute), bcd(at.second))

    private val firmware = byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05) // V0525
    private val hrvRecord = ByteArray(15).also { r ->
        r[0] = 0x56; stamp(hrvAt).copyInto(r, 3)
        r[9] = 28; r[10] = 0; r[11] = 65; r[12] = 45; r[13] = 115; r[14] = 60
    }
    private val hrRecord = ByteArray(10).also { r -> r[0] = 0x55; stamp(hrvAt.plusSeconds(1)).copyInto(r, 3); r[9] = 65 }
    private val sleepPacket = ByteArray(130).also { r ->
        r[0] = 0x53; stamp(sleepAt).copyInto(r, 3); r[9] = sleepStages.length.toByte()
        sleepStages.forEachIndexed { i, c -> r[10 + i] = when (c) { 'a' -> 5; 'l' -> 2; else -> 1 }.toByte() }
    }
    private val dayTotal = ByteArray(27).also { r ->
        r[0] = 0x51; byteArrayOf(bcd(26), bcd(10), bcd(22)).copyInto(r, 2)
        r[5] = 0x10; r[6] = 0x3F // 16,144 steps
        r[9] = 0x2C; r[10] = 0x01 // exercise 300
    }

    private fun readBack(ring: LocalDateTime) = ByteArray(16).also { it[0] = 0x41; stamp(ring).copyInto(it, 1) }

    private fun connection(store: MemoryStore, now: Instant, ringClock: LocalDateTime? = null): List<PulseEvent> {
        val driver = JStyle2301Driver(writer = null, zoneId = zone, now = { now })
        driver.configureClockStore(store)
        driver.ingest(firmware, JStyle2301UUIDs.NOTIFY)
        ringClock?.let { driver.ingest(readBack(it), JStyle2301UUIDs.NOTIFY) }
        return listOf(hrvRecord, hrRecord, sleepPacket).flatMap { driver.ingest(it, JStyle2301UUIDs.NOTIFY) }
            .filter { it is RingDecodedEvent.HistoryMeasurement || it is RingDecodedEvent.VendorMetric || it is RingDecodedEvent.SleepTimeline }
            .flatMap { RingEventBridge.eventsFor(it, now) }
    }

    private fun memoryDb() = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
    private fun subscriber(db: PulseLoopDatabase) = EventPersistenceSubscriber(
        context, db, enabledOverride = { false }, hubInstallationIdOverride = { "inst" }, hubFlushOverride = {},
    )
    private val oldSync = Instant.parse("2026-10-23T15:43:01Z")
    private val repullClock = LocalDateTime.of(2026, 10, 27, 5, 13, 5)
    private val hrvMs get() = hrvAt.atZone(zone).toInstant().toEpochMilli()
    private val dayStart get() = TimeUtil.startOfDayLocal(hrvMs)

    private fun rows(db: PulseLoopDatabase, kindRaw: String) = runBlocking {
        db.measurementDao().historyBetween(kindRaw, dayStart, dayStart + 86_400_000L)
    }
    private fun nightMinutes(db: PulseLoopDatabase): Pair<Int, Int> = runBlocking {
        val sessions = db.sleepSessionDao().ringAllByDay(TimeUtil.wakingDayLocal(sleepAt.atZone(zone).toInstant().toEpochMilli()))
        val blocks = sessions.flatMap { db.sleepStageBlockDao().forSession(it.id) }
        sessions.sumOf { it.totalMinutes } to blocks.sumOf { it.durationMinutes }
    }
    private fun deletionTargets(db: PulseLoopDatabase) = runBlocking {
        com.pulseloop.hub.HubPendingDeletions.drain(db, "inst").let { db.hubOutboxDao().pending(10_000) }.filter { it.category == HubEventMapper.DELETION_CATEGORY }.map {
            val t = Json.parseToJsonElement(it.payloadJson).jsonObject["data"]!!.jsonObject["target"]!!.jsonObject
            val from = Instant.parse(t["from"]!!.jsonPrimitive.content).toEpochMilli()
            val to = Instant.parse(t["to"]!!.jsonPrimitive.content).toEpochMilli()
            // Exact instants, or (0.6.3) a range joining raw copies with no reading that stays between them.
            if (from != to) assertEquals("metrics/hr", t["category"]!!.jsonPrimitive.content)
            Triple(t["category"]!!.jsonPrimitive.content, from, to)
        }
    }

    @Test fun `2_7_3 stored every history type twice and stretched the night`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val store = MemoryStore()
            sub.persistBatch(connection(store, oldSync))
            assertEquals(2, rows(db, "HEART_RATE").size)
            assertEquals(29 to 30, nightMinutes(db)) // 29 asleep of 30 minutes

            // 2.7.3's re-pull: shifted, without the raw stamp, so the old copies stayed.
            sub.persistBatch(connection(store, setAt, repullClock).map(::without273Knowledge))
            assertEquals(4, rows(db, "HEART_RATE").size)
            for (kind in listOf("HRV", "STRESS", "VENDOR_HRV_RAW", "VENDOR_BLOOD_PRESSURE_SYSTOLIC_ESTIMATE")) {
                assertEquals(kind, 2, rows(db, kind).size)
            }
            // The raw packet's last 6 minutes survive past the corrected copy: deep sleep counted twice.
            assertEquals(35 to 36, nightMinutes(db))
        } finally { sub.stop(); db.close() }
    }

    @Test fun `2_7_4 keeps one copy of every reading and the night as recorded`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val store = MemoryStore()
            sub.persistBatch(connection(store, oldSync))
            val rawHr = rows(db, "HEART_RATE").map { it.timestamp }
            assertEquals(listOf(hrvMs, hrvMs + 1_000), rawHr)

            val repull = connection(store, setAt, repullClock)
            assertEquals(listOf(RingClockSegment(setAt.toEpochMilli(), offsetMs)), store.segments)
            sub.persistBatch(repull)

            // Every kind: one row each, at the corrected stamp. The real 1 s neighbour survives.
            assertEquals(rawHr.map { it - offsetMs }, rows(db, "HEART_RATE").map { it.timestamp })
            for (kind in listOf("HRV", "STRESS", "VENDOR_HRV_RAW", "VENDOR_BLOOD_PRESSURE_SYSTOLIC_ESTIMATE", "VENDOR_BLOOD_PRESSURE_DIASTOLIC_ESTIMATE")) {
                assertEquals(kind, listOf(hrvMs - offsetMs), rows(db, kind).map { it.timestamp })
            }
            assertEquals(19.0, rows(db, "HRV").single().value, 0.0)
            assertEquals(29 to 30, nightMinutes(db))

            // The server drops exactly the raw copies: two HR readings (one range: no reading that
            // stays lies between them), one each of the others, and the raw sleep packet.
            val targets = deletionTargets(db)
            assertEquals(listOf(hrvMs to hrvMs + 1_000), targets.filter { it.first == "metrics/hr" }.map { it.second to it.third })
            for (category in listOf("metrics/hrv", "metrics/stress", "vendor/hrv_raw", "vendor/blood_pressure_systolic_estimate")) {
                assertEquals(category, listOf(hrvMs to hrvMs), targets.filter { it.first == category }.map { it.second to it.third })
            }
            assertEquals(listOf(sleepAt.atZone(zone).toInstant().toEpochMilli()), targets.filter { it.first == "sleep/timeline" }.map { it.second })

            // Later connections with sub-second read-back noise change nothing.
            val before = deletionTargets(db).size
            for ((now, ring) in listOf(
                Instant.parse("2026-10-27T03:39:31.679Z") to LocalDateTime.of(2026, 10, 27, 9, 9, 31),
                Instant.parse("2026-10-27T06:28:29.299Z") to LocalDateTime.of(2026, 10, 27, 11, 58, 30),
            )) {
                sub.persistBatch(connection(store, now, ring))
                assertEquals(rawHr.map { it - offsetMs }, rows(db, "HEART_RATE").map { it.timestamp })
                assertEquals(29 to 30, nightMinutes(db))
            }
            assertEquals(before, deletionTargets(db).size)
        } finally { sub.stop(); db.close() }
    }

    @Test fun `a sub-second copy of a reading is replaced, a real reading one second away is not`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val at = TimeUtil.startOfDayLocal(System.currentTimeMillis() - 2 * 86_400_000L) + 3_600_000L + 30_000L
            fun hr(ms: Long, bpm: Double) = PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, bpm, Instant.ofEpochMilli(ms))
            sub.persistBatch(listOf(hr(at - 679, 65.0), hr(at + 1_000 - 311, 66.0)))
            sub.persistBatch(listOf(hr(at, 65.0), hr(at + 1_000, 66.0), hr(at + 2_000, 65.0)))
            assertEquals(listOf(at, at + 1_000, at + 2_000), db.measurementDao().historyBetween("HEART_RATE", at - 5_000, at + 5_000).map { it.timestamp })
        } finally { sub.stop(); db.close() }
    }

    @Test fun `date-stamped day totals never move with the clock`() {
        val store = MemoryStore()
        val driver = JStyle2301Driver(writer = null, zoneId = zone, now = { setAt })
        driver.configureClockStore(store)
        driver.ingest(firmware, JStyle2301UUIDs.NOTIFY)
        driver.ingest(readBack(repullClock), JStyle2301UUIDs.NOTIFY)
        val midnight = LocalDateTime.of(2026, 10, 22, 0, 0).atZone(zone).toInstant()
        val vendor = driver.ingest(dayTotal, JStyle2301UUIDs.NOTIFY).filterIsInstance<RingDecodedEvent.VendorMetric>()
        assertTrue(vendor.isNotEmpty())
        assertTrue(vendor.all { it.key in JStyle2301Decoder.DAY_TOTAL_KEYS })
        assertTrue(vendor.all { it._timestamp == midnight && it.rawTimestamp == null })
    }

    @Test fun `ring-stamped history keeps its stamp, a live reading is clamped`() {
        val now = Instant.parse("2026-10-27T06:00:00.123Z")
        val later = now.plusSeconds(30)
        val bucket = RingEventBridge.eventsFor(RingDecodedEvent.ActivityBucket(later, 50, 30), now).single() as PulseEvent.ActivityBucket
        assertEquals(later, bucket.timestamp)
        assertNull(bucket.rawTimestamp)
        val hr = RingEventBridge.eventsFor(RingDecodedEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 65.0, later), now).single()
        assertEquals(later, (hr as PulseEvent.HistoryMeasurement).timestamp)
        val sleep = RingEventBridge.eventsFor(RingDecodedEvent.SleepTimeline(later, listOf(SleepStage.LIGHT)), now).single()
        assertEquals(later, (sleep as PulseEvent.SleepTimeline).timestamp)
        val live = RingEventBridge.eventsFor(RingDecodedEvent.HeartRateSample(70, later), now).single()
        assertEquals(now, (live as PulseEvent.HeartRateSample).timestamp)
    }

    /** What 2.7.3 handed the store: the shifted record with no trace of the raw stamp. */
    private fun without273Knowledge(event: PulseEvent): PulseEvent = when (event) {
        is PulseEvent.HistoryMeasurement -> event.copy(rawTimestamp = null)
        is PulseEvent.VendorMetric -> event.copy(rawTimestamp = null)
        is PulseEvent.SleepTimeline -> event.copy(rawTimestamp = null)
        else -> event
    }
}
