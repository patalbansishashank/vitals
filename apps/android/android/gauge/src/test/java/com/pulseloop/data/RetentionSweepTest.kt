package com.pulseloop.data

import androidx.room.Room
import com.pulseloop.data.entity.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RetentionSweepTest {
    @Test fun `workout poll policy is present but disabled and never deletes sessions`() {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java)
            .allowMainThreadQueries().build()
        try {
            val now = 500 * RetentionSweep.DAY_MS
            assertFalse(RetentionSweep.PRUNE_FINISHED_WORKOUT_POLLS)
            assertFalse(RetentionSweep.policies(now, false).any { it.table == "activity_sensor_polls" })
            val dormant = RetentionSweep.sensorPollPolicy(now)
            assertEquals(now - 90 * RetentionSweep.DAY_MS, dormant.cutoff)
            assertTrue(dormant.sql.startsWith("DELETE FROM activity_sensor_polls "))
            // Validate the real schema/column names without executing the disabled deletion.
            db.openHelper.writableDatabase.compileStatement(dormant.sql).close()
        } finally { db.close() }
    }
    @Test fun `sweep keeps health history and scopes while pruning only expired telemetry`() = runBlocking {
        val statements = java.util.concurrent.CopyOnWriteArrayList<String>()
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java)
            .setQueryCallback({ sql, _ -> statements += sql }, java.util.concurrent.Executor { it.run() }).build()
        try {
            val now = 500 * RetentionSweep.DAY_MS
            val sql = db.openHelper.writableDatabase
            sql.execSQL("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5100) INSERT INTO raw_packets(timestamp,directionRaw,commandId,hexPayload,confidenceRaw,createdAt) SELECT x,'INCOMING',1,'aa','unknown',x FROM n")
            db.rawPacketDao().insert(RawPacketEntity(timestamp = now, directionRaw = "INCOMING", commandId = 1, hexPayload = "ff"))
            db.measurementDao().insert(MeasurementEntity(id = "history:hr:1", kindRaw = "HEART_RATE", value = 70.0, unit = "bpm", timestamp = 1, sourceRaw = "history"))
            db.derivedUpdateDao().upsert(DerivedUpdateEntity("old", 1, "score", "local_insight", "day", null))
            db.derivedUpdateDao().upsert(DerivedUpdateEntity("new", 2, "score", "local_insight", "day", null))
            db.derivedUpdateDao().upsert(DerivedUpdateEntity("other", 1, "score", "local_insight", "other", null))
            for (at in listOf(1L, now)) {
                sql.execSQL("INSERT INTO battery_samples(id,percent,timestamp,createdAt) VALUES(?,50,?,?)", arrayOf(at.toString(), at, at))
                sql.execSQL("INSERT INTO wearable_logs(id,timestamp,deviceTypeRaw,categoryRaw,levelRaw,message) VALUES(?,?,'', 'connection','info','test')", arrayOf(at.toString(), at))
                db.broadcastOutboxDao().enqueue(BroadcastOutboxEntity("pending:$at", "hr", "{}", createdAt = at))
                db.broadcastOutboxDao().enqueue(BroadcastOutboxEntity("receipt:$at", "hr", "", createdAt = at, publishedAt = at))
            }
            statements.clear()
            RetentionSweep.run(db, now)
            val deletes = statements.filter { it.startsWith("DELETE FROM", ignoreCase = true) }
            assertEquals(6, deletes.size)
            val allowed = RetentionSweep.policies(now, false).map { it.table }.toSet()
            assertTrue(deletes.all { it.split(' ')[2] in allowed })
            val plan = sql.query("EXPLAIN QUERY PLAN " + RetentionSweep.policies(now, false).first { it.table == "broadcast_outbox" }.sql, arrayOf<Any>(now, now)).use { cursor ->
                buildList { while (cursor.moveToNext()) add(cursor.getString(3)) }.joinToString("\n")
            }
            assertTrue(plan, plan.contains("INDEX"))
            fun count(table: String) = sql.query("SELECT COUNT(*) FROM $table").use { it.moveToFirst(); it.getInt(0) }
            assertEquals(5000, count("raw_packets"))
            assertEquals(1, count("measurements"))
            assertEquals(2, count("derived_updates"))
            assertEquals(1, count("battery_samples"))
            assertEquals(1, count("wearable_logs"))
            assertEquals(2, count("broadcast_outbox"))
            assertEquals(setOf("raw_packets", "broadcast_outbox", "hub_outbox", "derived_updates", "battery_samples", "wearable_logs"), RetentionSweep.policies(now, false).map { it.table }.toSet())
        } finally { db.close() }
    }

    @Test fun `full capture expires exactly at 24 hours and does not survive clock rollback`() {
        val start = 1000L
        assertTrue(RawPacketRetention.fullCaptureActive(start, start + RawPacketRetention.WINDOW_MS - 1))
        assertFalse(RawPacketRetention.fullCaptureActive(start, start + RawPacketRetention.WINDOW_MS))
        assertFalse(RawPacketRetention.fullCaptureActive(start, start - 1))
        assertFalse(RawPacketRetention.fullCaptureActive(0, start))
        assertFalse(RetentionSweep.policies(start, true).any { it.table == "raw_packets" })
    }

    @Test fun `24 hour window can exceed row floor and equal timestamps prune deterministically`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java).build()
        try {
            val sql = db.openHelper.writableDatabase
            sql.execSQL("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5100) INSERT INTO raw_packets(timestamp,directionRaw,commandId,hexPayload,confidenceRaw,createdAt) SELECT 100,'INCOMING',1,'aa','unknown',x FROM n")
            assertEquals(0, db.rawPacketDao().prune(99))
            assertEquals(100, db.rawPacketDao().prune(101))
        } finally { db.close() }
    }
}
