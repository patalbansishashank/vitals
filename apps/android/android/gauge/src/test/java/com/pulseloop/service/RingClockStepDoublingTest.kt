package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.hub.HubEventMapper
import com.pulseloop.ring.JStyle2301Driver
import com.pulseloop.ring.JStyle2301UUIDs
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingClockSegment
import com.pulseloop.ring.RingClockStore
import com.pulseloop.ring.RingDecodedEvent
import com.pulseloop.ring.RingEventBridge
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
 * The 2.7.3 step doubling, end to end: J-Style 0x52 activity-detail history decoded by the real
 * driver, through the bridge, into Room. The minute values are the owner's ring's Oct 22 records
 * as the server recorded them (raw ring stamps at hh:mm:19, IST).
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RingClockStepDoublingTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val zone = ZoneId.of("Asia/Kolkata")

    private val first = LocalDateTime.of(2026, 10, 22, 9, 59, 19)
    private val firstMinutes = intArrayOf(80, 103, 103, 89, 106, 100, 104, 82, 103, 105)
    private val second = LocalDateTime.of(2026, 10, 22, 10, 9, 19)
    private val secondMinutes = intArrayOf(106, 96, 104, 109, 108, 109, 91, 109, 110, 108)
    private val daySteps = firstMinutes.sum() + secondMinutes.sum() // 2025

    /** The connection that set the clock: phone 23:36:41.882Z, ring 383.118 s ahead (as on the server). */
    private val setAt = Instant.parse("2026-10-26T23:36:41.882Z")
    private val offsetMs = 383_118L

    private class MemoryStore(var segments: List<RingClockSegment> = emptyList()) : RingClockStore {
        override fun load() = segments
        override fun save(segments: List<RingClockSegment>) { this.segments = segments }
    }

    private fun bcd(v: Int) = (((v / 10) shl 4) or (v % 10)).toByte()

    private fun detailRecord(at: LocalDateTime, minutes: IntArray, distanceTens: Int): ByteArray =
        ByteArray(25).also { r ->
            r[0] = 0x52
            byteArrayOf(bcd(at.year % 100), bcd(at.monthValue), bcd(at.dayOfMonth), bcd(at.hour), bcd(at.minute), bcd(at.second))
                .copyInto(r, 3)
            val total = minutes.sum()
            r[9] = (total and 0xFF).toByte(); r[10] = (total shr 8).toByte()
            r[13] = (distanceTens and 0xFF).toByte(); r[14] = (distanceTens shr 8).toByte()
            minutes.forEachIndexed { i, steps -> r[15 + i] = steps.toByte() }
        }

    private val history = detailRecord(first, firstMinutes, 72) + detailRecord(second, secondMinutes, 78)

    private fun readBack(ring: LocalDateTime) = ByteArray(16).also {
        it[0] = 0x41
        byteArrayOf(bcd(ring.year % 100), bcd(ring.monthValue), bcd(ring.dayOfMonth), bcd(ring.hour), bcd(ring.minute), bcd(ring.second))
            .copyInto(it, 1)
    }

    /** One connection: optional clock read-back, then the history pull, as the bus would carry it. */
    private fun connection(store: MemoryStore, now: Instant, ringClock: LocalDateTime? = null): List<PulseEvent> {
        val driver = JStyle2301Driver(writer = null, zoneId = zone, now = { now })
        driver.configureClockStore(store)
        ringClock?.let { driver.ingest(readBack(it), JStyle2301UUIDs.NOTIFY) }
        return driver.ingest(history, JStyle2301UUIDs.NOTIFY)
            .filterIsInstance<RingDecodedEvent.ActivityBucket>()
            .flatMap { RingEventBridge.eventsFor(it, now) }
    }

    private fun memoryDb() = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
    private fun subscriber(db: PulseLoopDatabase) = EventPersistenceSubscriber(
        context, db, enabledOverride = { false }, hubInstallationIdOverride = { "inst" }, hubFlushOverride = {},
    )
    private val dayStart get() = TimeUtil.startOfDayLocal(first.atZone(zone).toInstant().toEpochMilli())

    private fun deletionTargets(db: PulseLoopDatabase): List<Pair<String, String>> = runBlocking {
        com.pulseloop.hub.HubPendingDeletions.drain(db, "inst").let { db.hubOutboxDao().pending(10_000) }.filter { it.category == HubEventMapper.DELETION_CATEGORY }.map {
            val target = Json.parseToJsonElement(it.payloadJson).jsonObject["data"]!!.jsonObject["target"]!!.jsonObject
            assertEquals("activity/buckets", target["category"]!!.jsonPrimitive.content)
            assertEquals("activity_bucket", target["kind"]!!.jsonPrimitive.content)
            target["from"]!!.jsonPrimitive.content to target["to"]!!.jsonPrimitive.content
        }
    }

    @Test fun `2_7_3 stored the corrected re-pull beside the raw copy and doubled the day`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val store = MemoryStore()
            // Oct 23, older app: no clock read-back, buckets stored at the ring's raw stamps.
            sub.persistBatch(connection(store, Instant.parse("2026-10-23T15:43:01Z")))
            assertEquals(daySteps, db.activityDailyDao().byDay(dayStart)!!.steps)

            // Oct 27, 2.7.3: 383.118 s measured, the same records re-pulled and shifted. 2.7.3
            // kept no trace of the raw stamp, so the stale copy stayed.
            val repull = connection(store, setAt, ringClock = LocalDateTime.of(2026, 10, 27, 5, 13, 5))
            assertEquals(listOf(RingClockSegment(setAt.toEpochMilli(), offsetMs)), store.segments)
            sub.persistBatch(repull.map { (it as PulseEvent.ActivityBucket).copy(rawTimestamp = null) })

            assertEquals(40, db.activityBucketDao().byDay(dayStart).size)
            assertEquals(2 * daySteps, db.activityDailyDao().byDay(dayStart)!!.steps)
        } finally { sub.stop(); db.close() }
    }

    @Test fun `2_7_4 keeps one copy per ring record across the clock correction and later connections`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val store = MemoryStore()
            sub.persistBatch(connection(store, Instant.parse("2026-10-23T15:43:01Z")))
            val rawStarts = db.activityBucketDao().byDay(dayStart).map { it.startEpoch }
            assertEquals(20, rawStarts.size)
            assertTrue(rawStarts.all { it % 60_000 == 19_000L })

            val repull = connection(store, setAt, ringClock = LocalDateTime.of(2026, 10, 27, 5, 13, 5))
            assertTrue(repull.all { (it as PulseEvent.ActivityBucket).rawTimestamp != null })
            sub.persistBatch(repull)

            val buckets = db.activityBucketDao().byDay(dayStart)
            assertEquals(20, buckets.size)
            assertEquals(rawStarts.map { it - offsetMs }, buckets.map { it.startEpoch })
            assertEquals(daySteps, db.activityDailyDao().byDay(dayStart)!!.steps)
            // The server is told to drop exactly the raw copies, nothing around them: a range never
            // covers a bucket that stays (0.6.3 coalescing).
            val targets = deletionTargets(db)
            com.pulseloop.hub.assertCoversExactly(rawStarts, buckets.map { it.startEpoch }, targets.map { Instant.parse(it.first).toEpochMilli() to Instant.parse(it.second).toEpochMilli() })

            // Later connections: the clock is right, the read-back is off by a fraction of a
            // second (2.7.3 shifted each connection's history by it). Same keys, nothing added.
            for ((now, ring) in listOf(
                Instant.parse("2026-10-27T03:39:31.679Z") to LocalDateTime.of(2026, 10, 27, 9, 9, 31),
                Instant.parse("2026-10-27T06:28:29.299Z") to LocalDateTime.of(2026, 10, 27, 11, 58, 30),
            )) {
                sub.persistBatch(connection(store, now, ringClock = ring))
                assertEquals(buckets.map { it.startEpoch }, db.activityBucketDao().byDay(dayStart).map { it.startEpoch })
                assertEquals(daySteps, db.activityDailyDao().byDay(dayStart)!!.steps)
            }
            assertEquals(1, store.segments.size)
            assertEquals(targets.size, deletionTargets(db).size)
        } finally { sub.stop(); db.close() }
    }

    @Test fun `a copy a fraction of a second off replaces the bucket instead of adding to it`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val day = TimeUtil.startOfDayLocal(System.currentTimeMillis() - 3 * 86_400_000L)
            val at = day + 10 * 3_600_000L + 19_000L
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(at - 679), 103, 75.0)))
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(at + 299), 103, 75.0)))
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(at), 103, 75.0)))
            // A real neighbour a minute later is untouched.
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(at + 60_000), 80, 59.0)))
            assertEquals(listOf(at, at + 60_000), db.activityBucketDao().byDay(day).map { it.startEpoch })
            assertEquals(183, db.activityDailyDao().byDay(day)!!.steps)
            assertEquals(2, deletionTargets(db).size)
        } finally { sub.stop(); db.close() }
    }

    @Test fun `the day total is the device count or the distinct buckets, never its own stored value`() = runBlocking {
        val db = memoryDb(); val sub = subscriber(db)
        try {
            val today = TimeUtil.startOfTodayLocal()
            // The ring's own count leads the bucket history during the day.
            sub.persistBatch(listOf(PulseEvent.ActivityUpdate(Instant.ofEpochMilli(today + 60_000), 10_432, 7_050.0, 370.0, 96, false)))
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(today + 3_600_000), 9_000, 6_000.0)))
            assertEquals(10_432, db.activityDailyDao().byDay(today)!!.steps)
            assertEquals(10_432, db.activityDailyDao().byDay(today)!!.deviceSteps)

            // A total inflated by duplicate buckets (what 2.7.3 left on the phone) heals on the
            // next update instead of being ratcheted against.
            val row = db.activityDailyDao().byDay(today)!!
            db.activityDailyDao().upsert(row.copy(steps = 44_379))
            sub.persistBatch(listOf(PulseEvent.ActivityUpdate(Instant.ofEpochMilli(today + 120_000), 10_500, 7_100.0, 372.0, 97, false)))
            assertEquals(10_500, db.activityDailyDao().byDay(today)!!.steps)
            db.activityDailyDao().upsert(db.activityDailyDao().byDay(today)!!.copy(steps = 44_379))
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(today + 7_200_000), 1_000, 700.0)))
            assertEquals(10_500, db.activityDailyDao().byDay(today)!!.steps)

            // History beyond the live count wins (a day the live count missed).
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(today + 10_800_000), 2_000, 1_400.0)))
            assertEquals(12_000, db.activityDailyDao().byDay(today)!!.steps)

            // A past day with no device count is the sum of its buckets.
            val past = today - 2 * 86_400_000L
            db.activityDailyDao().upsert(ActivityDailyEntity(date = past, steps = 4_050, source = "ring_history"))
            sub.persistBatch(listOf(PulseEvent.ActivityBucket(Instant.ofEpochMilli(past + 3_600_000), 2_025, 1_500.0)))
            assertEquals(2_025, db.activityDailyDao().byDay(past)!!.steps)
        } finally { sub.stop(); db.close() }
    }
}
