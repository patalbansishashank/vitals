package com.pulseloop.hub

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.data.entity.HubPendingDeletionEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.hub.HubDeletionCoalescer.Target
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 0.6.3: per-sample hub deletions are coalesced where nothing that stays lies between them, and paced. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HubDeletionCoalescerTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    private fun t(id: Long, at: Long, category: String = "metrics/hr", kind: String? = "hr") = Target(id, category, kind, at, at)
    private fun stays(vararg xs: Long) = HubDeletionCoalescer.Survivors { _, _, from, to -> xs.filter { it in from..to }.sorted() }

    @Test fun `a contiguous run with nothing staying between becomes one range`() = runBlocking {
        val ranges = HubDeletionCoalescer.coalesce((0L until 100L).map { t(it, it * 60_000) }, stays())
        assertEquals(1, ranges.size)
        assertEquals(0L to 99 * 60_000L, ranges.single().fromMs to ranges.single().toMs)
        assertEquals((0L until 100L).toList(), ranges.single().ids.sorted())
    }

    @Test fun `a stored reading between two targets keeps them apart`() = runBlocking {
        // 2.7.3 clock copies: each raw copy sits between corrected readings that stay.
        val raws = (0L until 10L).map { it * 300_000 + 383_118 }
        val kept = (0L until 11L).map { it * 300_000 }.toLongArray()
        val ranges = HubDeletionCoalescer.coalesce(raws.mapIndexed { i, at -> t(i.toLong(), at) }, stays(*kept))
        assertEquals(raws, ranges.map { it.fromMs })
        assertTrue(ranges.all { it.fromMs == it.toMs })
    }

    @Test fun `unknown categories never widen, a gap over the limit is not bridged, groups stay apart`() = runBlocking {
        val unknown = HubDeletionCoalescer.Survivors { _, _, _, _ -> null }
        assertEquals(3, HubDeletionCoalescer.coalesce(listOf(t(1, 0, "x/y"), t(2, 1, "x/y"), t(3, 2, "x/y")), unknown).size)
        assertEquals(1, HubDeletionCoalescer.coalesce(listOf(Target(1, "x/y", null, 0, 10), Target(2, "x/y", null, 5, 20)), unknown).size)
        val far = HubDeletionCoalescer.coalesce(listOf(t(1, 0), t(2, HubDeletionCoalescer.DEFAULT_MAX_GAP_MS + 1)), stays())
        assertEquals(2, far.size)
        val mixed = HubDeletionCoalescer.coalesce(listOf(t(1, 0), t(2, 1_000), t(3, 500, "metrics/spo2", "spo2")), stays())
        assertEquals(listOf("metrics/hr" to 2, "metrics/spo2" to 1), mixed.map { it.category to it.ids.size }.sortedBy { it.first })
    }

    @Test fun `user deletions of a run of readings send the union of their windows`() {
        val rows = (0 until 50).map { MeasurementEntity(id = "m$it", kindRaw = "HEART_RATE", value = 80.0, unit = "bpm", timestamp = 1_000_000L + it * 60_000L, sourceRaw = "live") }
        val events = HubEventMapper.measurementDeletions(rows, "install123", Instant.ofEpochMilli(9_000_000))
        assertEquals(1, events.size)
        val target = Json.parseToJsonElement(events.single().payloadJson).jsonObject["data"]!!.jsonObject["target"]!!.jsonObject
        assertEquals(Instant.ofEpochMilli(1_000_000L - 90_000).toString(), target["from"]!!.jsonPrimitive.content)
        assertEquals(Instant.ofEpochMilli(1_000_000L + 49 * 60_000L + 90_000).toString(), target["to"]!!.jsonPrimitive.content)
    }

    @Test fun `the drain coalesces against stored rows and paces the rest`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        try {
            // 600 removed buckets in one contiguous block (nothing stays between): one range.
            val block = (0L until 600L).map { 10_000_000L + it * 60_000 }
            // 500 removed HR copies, each between two readings that stay: exact, and paced.
            val copies = (0L until 500L).map { 100_000_000L + it * 300_000 + 1_000 }
            for (i in 0L..500L) db.measurementDao().insert(MeasurementEntity(kindRaw = "HEART_RATE", value = 70.0, unit = "bpm", timestamp = 100_000_000L + i * 300_000, sourceRaw = "history"))
            db.activityBucketDao().upsert(ActivityBucketEntity(startEpoch = 9_000_000, date = 0, steps = 10, distanceMeters = 1.0))
            db.hubPendingDeletionDao().add(
                block.map { HubPendingDeletionEntity(category = "activity/buckets", kind = "activity_bucket", fromMs = it, toMs = it, createdAt = 1) } +
                    copies.map { HubPendingDeletionEntity(category = "metrics/hr", kind = "hr", fromMs = it, toMs = it, createdAt = 1) },
            )
            val now = Instant.ofEpochMilli(500_000_000)
            val consumed = HubPendingDeletions.drain(db, "inst", now)
            val events = db.hubOutboxDao().pending(10_000)
            assertEquals(HubPendingDeletions.MAX_EVENTS_PER_HOUR, events.size)
            val targets = events.map { Json.parseToJsonElement(it.payloadJson).jsonObject["data"]!!.jsonObject["target"]!!.jsonObject }
            val bucketRange = targets.single { it["category"]!!.jsonPrimitive.content == "activity/buckets" }
            assertEquals(Instant.ofEpochMilli(block.first()).toString(), bucketRange["from"]!!.jsonPrimitive.content)
            assertEquals(Instant.ofEpochMilli(block.last()).toString(), bucketRange["to"]!!.jsonPrimitive.content)
            assertTrue(targets.filter { it["category"]!!.jsonPrimitive.content == "metrics/hr" }.all { it["from"] == it["to"] })
            assertEquals(600 + (HubPendingDeletions.MAX_EVENTS_PER_HOUR - 1), consumed)
            assertEquals(500 - (HubPendingDeletions.MAX_EVENTS_PER_HOUR - 1), db.hubPendingDeletionDao().all().size)

            // Budget spent: nothing more this hour, even across batches.
            assertEquals(0, HubPendingDeletions.drain(db, "inst", now.plusSeconds(60)))
            // Uploaded more than an hour ago no longer counts: the next slice goes.
            db.hubOutboxDao().markUploaded(events.map { it.eventId }, now.toEpochMilli())
            assertEquals(HubPendingDeletions.MAX_EVENTS_PER_HOUR, HubPendingDeletions.drain(db, "inst", now.plusSeconds(3_601)))
        } finally { db.close() }
    }
}

/**
 * Deletion ranges [targets] hide exactly [removed]: every removed instant lies in exactly one range,
 * each range starts and ends on a removed instant, and no instant in [kept] lies inside any range.
 */
internal fun assertCoversExactly(removed: List<Long>, kept: List<Long>, targets: List<Pair<Long, Long>>) {
    for (at in removed) assertEquals("covered once: $at", 1, targets.count { (a, b) -> at in a..b })
    for ((a, b) in targets) {
        assertTrue("range starts on a removed instant", a in removed)
        assertTrue("range ends on a removed instant", b in removed)
        assertTrue("no kept row inside [$a, $b]", kept.none { it in a..b })
    }
}
