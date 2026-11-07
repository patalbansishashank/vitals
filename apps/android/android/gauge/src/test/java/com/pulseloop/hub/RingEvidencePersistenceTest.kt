package com.pulseloop.hub

import com.pulseloop.ring.RING_VENDOR_ID
import androidx.room.Room
import com.pulseloop.broadcasting.RingSourceIdentity
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.ring.PacketDirection
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingDecodedEvent
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.StepSupport
import com.pulseloop.service.EventPersistenceSubscriber
import java.time.Instant
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

/** Ring evidence through Room: bucket support columns, ring identity on uploads, backfill, 0x18 capture. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RingEvidencePersistenceTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun memoryDb() = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
    private val source = RingSourceIdentity(deviceKey = "0123456789abcdef", deviceModel = RING_VENDOR_ID, firmware = "V0789",
        decoderVersion = "jstyle2301/2", zone = ZoneId.of("UTC"))
    private val at = Instant.parse("2026-10-21T07:00:00Z")

    private fun subscriber(db: PulseLoopDatabase, now: () -> Long = System::currentTimeMillis) = EventPersistenceSubscriber(
        context, db,
        enabledOverride = { false },
        hubInstallationIdOverride = { "install123" },
        hubFlushOverride = {},
        ringSourceOverride = { source },
        nowOverride = now,
    )

    @Test fun `native buckets store their support and upload as ring_steps with the ring's identity`() = runBlocking {
        val db = memoryDb()
        val sub = subscriber(db)
        try {
            val minutes = (0 until 10).map { i ->
                PulseEvent.ActivityBucket(at.plusSeconds(i * 60L), if (i == 3) 40 else 0, 0.0,
                    durationS = 60, support = StepSupport.MINUTE, parentTotalSteps = 44, parentRecordStart = at)
            }
            val fallback = PulseEvent.ActivityBucket(at.plusSeconds(600), 300, 210.0,
                durationS = 600, support = StepSupport.TEN_MINUTE_FALLBACK, parentTotalSteps = 300, parentRecordStart = at.plusSeconds(600))
            sub.persistBatch(minutes + fallback)

            val rows = db.activityBucketDao().startingBetween(0, Long.MAX_VALUE)
            assertEquals(11, rows.size)
            val zero = rows.first { it.startEpoch == at.toEpochMilli() }
            assertEquals(ActivityBucketEntity(
                startEpoch = zero.startEpoch, date = zero.date, steps = 0, distanceMeters = 0.0, updatedAt = zero.updatedAt,
                durationS = 60, support = "minute", parentTotal = 44, parentStart = at.toEpochMilli(), deviceKey = "0123456789abcdef",
            ), zero)
            assertEquals("tenMinuteFallback", rows.last().support)
            assertEquals(340, db.activityDailyDao().byDay(zero.date)!!.steps)

            val uploads = db.hubOutboxDao().pending(100).map { Json.parseToJsonElement(it.payloadJson).jsonObject }
            assertEquals(11, uploads.size)
            assertTrue(uploads.all { it.getValue("subject").jsonPrimitive.content == "ring_steps" })
            val data = uploads.first().getValue("data").jsonObject
            assertEquals("0123456789abcdef", data.getValue("device_key").jsonPrimitive.content)
            assertEquals("jstyle2301/2", data.getValue("decoder_version").jsonPrimitive.content)
            assertEquals("0", data.getValue("local_offset_min").jsonPrimitive.content)
        } finally { sub.stop(); db.close() }
    }

    @Test fun `backfill re-sends legacy rows as legacy and native rows with their stored ring`() = runBlocking {
        val db = memoryDb()
        try {
            val dao = db.activityBucketDao()
            dao.upsert(ActivityBucketEntity(startEpoch = 1_000, date = 0, steps = 120, distanceMeters = 80.0))
            dao.upsert(ActivityBucketEntity(startEpoch = 61_000, date = 0, steps = 0, distanceMeters = 0.0,
                durationS = 60, support = "minute", parentTotal = 12, parentStart = 1_000, deviceKey = "fedcba9876543210"))
            val settings = FakeHubSettings("https://hub.example:8443")
            val backfill = HubBackfill(db, settings, now = { Instant.parse("2026-10-27T08:00:00Z") })
            repeat(10) { backfill.runChunk() }
            val buckets = db.hubOutboxDao().pending(100).filter { it.category == "activity/buckets" }
                .map { Json.parseToJsonElement(it.payloadJson).jsonObject }
            assertEquals(listOf("activity_bucket", "ring_steps"), buckets.map { it.getValue("subject").jsonPrimitive.content })
            val legacy = buckets[0].getValue("data").jsonObject
            assertNull(legacy["support"])
            assertNull(legacy["device_key"])
            val native = buckets[1].getValue("data").jsonObject
            assertEquals("minute", native.getValue("support").jsonPrimitive.content)
            assertEquals("12", native.getValue("parent_total_steps").jsonPrimitive.content)
            assertEquals("fedcba9876543210", native.getValue("device_key").jsonPrimitive.content)
        } finally { db.close() }
    }

    @Test fun `inbound J-Style 0x18 frames are captured for seven days and never uploaded`() = runBlocking {
        val db = memoryDb()
        var now = Instant.parse("2026-10-21T07:00:00Z").toEpochMilli()
        val sub = subscriber(db) { now }
        fun frame(first: Int, type: RingDeviceType = RingDeviceType.JSTYLE_2301, dir: PacketDirection = PacketDirection.INCOMING) =
            PulseEvent.RawPacket(dir, byteArrayOf(first.toByte(), 0x51, 0x10, 0x00), RingDecodedEvent.SportTelemetry(81, Instant.EPOCH), type, "V0789")
        try {
            sub.persistBatch(listOf(frame(0x18), frame(0x55), frame(0x18, type = RingDeviceType.COLMI_R02), frame(0x18, dir = PacketDirection.OUTGOING)))
            fun captured(): List<String> = db.openHelper.readableDatabase.query("SELECT hexPayload FROM ring_sport_frames ORDER BY id").use { c ->
                generateSequence { if (c.moveToNext()) c.getString(0) else null }.toList()
            }
            assertEquals(listOf("18511000"), captured())
            now += 8L * 86_400_000L
            sub.persistBatch(listOf(frame(0x18)))
            assertEquals("the first frame aged out after seven days", 1, captured().size)
            assertEquals(0, db.hubOutboxDao().pendingCount())
        } finally { sub.stop(); db.close() }
    }

    @Test fun `coverage and sport telemetry reach the hub outbox`() = runBlocking {
        val db = memoryDb()
        val sub = subscriber(db)
        try {
            sub.persistBatch(listOf(
                PulseEvent.HistoryCoverage("activity_detail", at.minusSeconds(86_400 * 2), at, true, "drained"),
                PulseEvent.SportTelemetrySample(at, 1_234, 56.78, 112),
            ))
            assertEquals(listOf("activity/sport_telemetry", "state/sync"), db.hubOutboxDao().pending(10).map { it.category }.sorted())
        } finally { sub.stop(); db.close() }
    }
}
