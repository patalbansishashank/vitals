package com.pulseloop.hub

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.pulseloop.data.MeasurementDeletion
import com.pulseloop.data.DATABASE_VERSION
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.data.entity.DerivedUpdateEntity
import com.pulseloop.data.entity.DeviceEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.SleepStage
import com.pulseloop.service.EventPersistenceSubscriber
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The hub outbox against a real Room database: migration, persistence, deletion, backfill. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HubPersistenceTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun memoryDb() = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()

    @Test fun `30 to 31 adds the hub outbox and keeps existing rows`() {
        val name = "hub-migration.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("DROP TABLE hub_outbox")
        sql.execSQL("INSERT INTO measurements(id,kindRaw,value,unit,timestamp,sourceRaw,confidenceRaw,createdAt) VALUES('history:hr:1','HEART_RATE',70,'bpm',1,'history','known',1)")
        sql.execSQL("INSERT INTO broadcast_outbox(eventId,topicSuffix,payloadJson,qos,retain,createdAt,attemptCount,publishedAt) VALUES('pending','metrics/hr','{}',1,0,1,0,NULL)")
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 30 }
        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(PulseLoopDatabase.MIGRATION_30_31, PulseLoopDatabase.MIGRATION_31_32, PulseLoopDatabase.MIGRATION_32_33, PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            val db = migrated.openHelper.writableDatabase // Room validates the full current schema here.
            assertEquals(DATABASE_VERSION, db.version)
            for (table in listOf("measurements", "broadcast_outbox")) {
                db.query("SELECT COUNT(*) FROM $table").use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
            }
            db.query("SELECT COUNT(*) FROM hub_outbox").use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
            assertTrue("hub_outbox" in PulseLoopDatabase.ALL_TABLES)
        } finally { migrated.close(); context.deleteDatabase(name) }
    }

    @Test fun `persisted events queue hub rows in the same transaction, independent of MQTT`() = runBlocking {
        val db = memoryDb()
        var hubFlushes = 0
        var paired: String? = "install123"
        val failOn = 62
        val subscriber = EventPersistenceSubscriber(
            context, db,
            enabledOverride = { false },
            afterEventPersistOverride = { if (it is PulseEvent.HeartRateSample && it.bpm == failOn) error("boom") },
            hubInstallationIdOverride = { paired },
            hubFlushOverride = { hubFlushes++ },
        )
        fun sample(value: Int) = PulseEvent.HeartRateSample(value, Instant.ofEpochMilli(value * 1_000L))
        try {
            subscriber.persistBatch(listOf(sample(60), sample(61), sample(failOn)))
            // The failed event rolled back its health row and its hub row together.
            assertEquals(listOf(60.0, 61.0), db.measurementDao().range("HEART_RATE", 0, 100_000).map { it.value })
            val pending = db.hubOutboxDao().pending(10)
            assertEquals(2, pending.size)
            assertTrue(pending.all { it.category == "metrics/hr" })
            assertEquals(0, db.broadcastOutboxDao().pendingCount())
            assertEquals(1, hubFlushes)

            paired = null
            subscriber.persistBatch(listOf(sample(63)))
            assertEquals(2, db.hubOutboxDao().pendingCount())
            assertEquals(1, hubFlushes)
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `deleting a reading queues a deletion event only while paired`() = runBlocking {
        val db = memoryDb()
        try {
            val at = 1_700_000_000_000L
            val hr = MeasurementEntity(id = "history:hr:$at", kindRaw = "HEART_RATE", value = 70.0, unit = "bpm", timestamp = at, sourceRaw = "history")
            val spo2 = MeasurementEntity(id = "history:spo2:$at", kindRaw = "SPO2", value = 97.0, unit = "%", timestamp = at, sourceRaw = "history")
            db.measurementDao().upsert(hr); db.measurementDao().upsert(spo2)
            var asked = 0
            assertEquals(1, MeasurementDeletion.delete(db, listOf(hr), hubInstallationId = "install123", onHubQueued = { asked++ }))
            val events = db.hubOutboxDao().pending(10)
            assertEquals(1, events.size)
            assertEquals("deletion", events.single().category)
            val target = Json.parseToJsonElement(events.single().payloadJson).jsonObject
                .getValue("data").jsonObject.getValue("target").jsonObject
            assertEquals("metrics/hr", target.getValue("category").jsonPrimitive.content)
            assertEquals(1, asked)
            assertEquals(1, db.measurementBatchDeletionDao().deletedIds(listOf(hr.id)).size)

            assertEquals(1, MeasurementDeletion.delete(db, listOf(spo2), hubInstallationId = null, onHubQueued = { asked++ }))
            assertEquals(1, db.hubOutboxDao().pendingCount())
            assertEquals(1, asked)
        } finally { db.close() }
    }

    @Test fun `first-pair backfill walks every history table in chunks and skips demo rows`() = runBlocking {
        val db = memoryDb()
        try {
            val base = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli()
            val m = db.measurementDao()
            m.upsert(MeasurementEntity(id = "history:hr:1", kindRaw = "HEART_RATE", value = 60.0, unit = "bpm", timestamp = base + 1, sourceRaw = "history"))
            m.upsert(MeasurementEntity(id = "history:hr:2", kindRaw = "HEART_RATE", value = 61.0, unit = "bpm", timestamp = base + 2, sourceRaw = "history"))
            m.upsert(MeasurementEntity(id = "demo-hr", kindRaw = "HEART_RATE", value = 99.0, unit = "bpm", timestamp = base + 3, sourceRaw = "demo"))
            m.upsert(MeasurementEntity(id = "bp-s", kindRaw = "BLOOD_PRESSURE_SYSTOLIC", value = 121.0, unit = "mmHg", timestamp = base + 4, sourceRaw = "history"))
            m.upsert(MeasurementEntity(id = "bp-d", kindRaw = "BLOOD_PRESSURE_DIASTOLIC", value = 79.0, unit = "mmHg", timestamp = base + 4, sourceRaw = "history"))
            m.upsert(MeasurementEntity(id = "vendor:vascular_age:5", kindRaw = "VENDOR_VASCULAR_AGE", value = 39.0, unit = "years", timestamp = base + 5, sourceRaw = "vendor_history"))
            db.activityDailyDao().upsert(ActivityDailyEntity(id = "day1", date = base, steps = 5000, distanceMeters = 3500.0, calories = 200.0, source = "ring"))
            db.activityDailyDao().upsert(ActivityDailyEntity(id = "demo-day", date = base + 86_400_000, steps = 1, source = "demo"))
            db.activityBucketDao().upsert(ActivityBucketEntity(startEpoch = base + 600_000, date = base, steps = 120, distanceMeters = 80.0))
            val sql = db.openHelper.writableDatabase
            sql.execSQL("INSERT INTO sleep_sessions(id,date,startAt,endAt,totalMinutes,sourceRaw,createdAt,updatedAt) VALUES('night',$base,$base,${base + 600_000},9,'ring',1,1)")
            sql.execSQL("INSERT INTO sleep_stage_blocks(id,sessionId,startAt,startMinute,durationMinutes,stageRaw) VALUES('b1','night',$base,0,3,'LIGHT'),('b2','night',${base + 180_000},3,2,'DEEP'),('b3','night',${base + 360_000},6,4,'REM')")
            db.derivedUpdateDao().upsert(DerivedUpdateEntity(
                id = "insight:sleep_score:$base", timestamp = 1, kind = "sleep_score", entityType = "local_insight",
                entityId = Instant.ofEpochMilli(base).toString(),
                payloadJSON = """{"value":82.0,"unit":"score","confidence":"medium","algorithm_version":"v1","inputs":{"minutes":420.0},"note":""}""",
            ))
            db.deviceDao().upsert(DeviceEntity(id = "ring", stateRaw = RingConnectionState.CONNECTED.name, deviceTypeRaw = RingDeviceType.JRING.name, batteryPercent = 64))

            val settings = FakeHubSettings("https://hub.example:8443")
            val backfill = HubBackfill(db, settings, now = { Instant.ofEpochMilli(base + 10_000_000) }, chunkSize = 2)
            assertTrue(backfill.fillIfNeeded())
            assertTrue(settings.status.value.backfillDone)

            val rows = db.hubOutboxDao().pending(100)
            val byCategory = rows.groupingBy { it.category }.eachCount()
            assertEquals(2, byCategory["metrics/hr"])
            assertEquals(1, byCategory["metrics/blood_pressure"])
            assertEquals(null, byCategory["metrics/bp_dia"])
            assertEquals(1, byCategory["vendor/vascular_age"])
            assertEquals(1, byCategory["activity/daily"])
            assertEquals(1, byCategory["activity/buckets"])
            assertEquals(2, byCategory["sleep/timeline"]) // b1+b2 are contiguous, b3 follows a gap
            assertEquals(1, byCategory["insights/sleep_score"])
            assertEquals(1, byCategory["state/battery"])
            assertEquals(1, byCategory["state/device"])
            assertEquals(1, byCategory["state/connection"])
            assertTrue(rows.none { it.payloadJson.contains("99.0") })
            val sleep = rows.filter { it.category == "sleep/timeline" }
                .map { Json.parseToJsonElement(it.payloadJson).jsonObject.getValue("data").jsonObject.getValue("stages").jsonArray.size }
                .sorted()
            assertEquals(listOf(4, 5), sleep)

            // Running again (e.g. after a crash replays a chunk) adds nothing.
            settings.saveBackfillCursor(null, done = false)
            backfill.fillIfNeeded()
            assertEquals(rows.size, db.hubOutboxDao().pendingCount())
        } finally { db.close() }
    }

    @Test fun `backfill timeline splits on gaps and keeps stage order`() {
        val session = com.pulseloop.data.entity.SleepSessionEntity(id = "s", date = 0, startAt = 0, endAt = 0, totalMinutes = 0)
        val blocks = listOf(
            com.pulseloop.data.entity.SleepStageBlockEntity("2", "s", 120_000, 2, 1, "DEEP"),
            com.pulseloop.data.entity.SleepStageBlockEntity("1", "s", 0, 0, 2, "LIGHT"),
            com.pulseloop.data.entity.SleepStageBlockEntity("z", "s", 500_000, 9, 0, "AWAKE"),
        )
        val timelines = HubBackfill.sleepTimelines(session, blocks)
        assertEquals(1, timelines.size)
        assertEquals(listOf(SleepStage.LIGHT, SleepStage.LIGHT, SleepStage.DEEP), timelines.single().stages)
    }
}
