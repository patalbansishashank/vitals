package com.pulseloop.data

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.pulseloop.hub.HubPendingDeletions
import com.pulseloop.ring.RingClockSegment
import com.pulseloop.util.TimeUtil
import java.time.Instant
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

/** v32 → v33 on a phone that ran 2.7.3: the duplicate buckets go, their days are re-summed. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class ClockDuplicateMigrationTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val offset = 383_118L
    private val segment = RingClockSegment(Instant.parse("2026-10-26T23:36:41.882Z").toEpochMilli(), offset)
    private val migratedAt = Instant.parse("2026-10-27T15:00:00Z").toEpochMilli()

    @Test fun `32 to 33 removes raw twins and sub-second copies, re-sums the days, and queues server deletions`() {
        val name = "clock-duplicate-migration.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        // Back to the v32 shape: no deviceSteps column, no pending-deletion table.
        sql.execSQL("DROP TABLE hub_pending_deletions")
        sql.execSQL("DROP TABLE activity_daily")
        sql.execSQL(
            "CREATE TABLE activity_daily (id TEXT NOT NULL PRIMARY KEY, date INTEGER NOT NULL, steps INTEGER NOT NULL, " +
                "calories REAL NOT NULL, distanceMeters REAL NOT NULL, activeMinutes INTEGER NOT NULL, source TEXT NOT NULL, " +
                "syncedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, estimatedActiveCalories REAL)",
        )
        sql.execSQL("CREATE UNIQUE INDEX index_activity_daily_date ON activity_daily (date)")

        fun bucket(start: Long, steps: Int, updatedAt: Long = 1) = sql.execSQL(
            "INSERT INTO activity_buckets(startEpoch,date,steps,distanceMeters,source,updatedAt) VALUES(?,?,?,?,'ring_history',?)",
            arrayOf<Any>(start, TimeUtil.startOfDayLocal(start), steps, steps * 0.7, updatedAt),
        )
        // Oct 22: ten raw minutes stored by 2.7.2 at hh:mm:19, and 2.7.3's corrected re-pull of each.
        val raw0 = Instant.parse("2026-10-22T04:29:19Z").toEpochMilli()
        val minutes = listOf(80, 103, 103, 89, 106, 100, 104, 82, 103, 105)
        val raws = minutes.indices.map { raw0 + it * 60_000L }
        raws.zip(minutes).forEach { (r, s) -> bucket(r, s); bucket(r - offset, s) }
        // A raw bucket whose "twin" differs in steps is a different record: both stay.
        val oddRaw = raw0 + 3_600_000L
        bucket(oddRaw, 50); bucket(oddRaw - offset, 51)
        // Oct 27: one record stored under three keys by three connections (2.7.3's read-back noise).
        val t = Instant.parse("2026-10-27T05:30:19Z").toEpochMilli()
        bucket(t - 679, 110, updatedAt = 5); bucket(t, 110, updatedAt = 3); bucket(t + 299, 110, updatedAt = 9)
        // ... and one with no whole-second copy: the newest stays.
        val u = t + 600_000L
        bucket(u - 321, 90, updatedAt = 5); bucket(u + 311, 90, updatedAt = 9)
        val neighbour = t + 60_000L
        bucket(neighbour, 70)
        // Oct 20: untouched.
        val clean = Instant.parse("2026-10-20T06:00:19Z").toEpochMilli()
        bucket(clean, 500)

        val oct22 = TimeUtil.startOfDayLocal(raw0)
        val oct27 = TimeUtil.startOfDayLocal(t)
        val oct20 = TimeUtil.startOfDayLocal(clean)
        fun daily(day: Long, steps: Int) = sql.execSQL(
            "INSERT INTO activity_daily(id,date,steps,calories,distanceMeters,activeMinutes,source,createdAt,updatedAt) VALUES(?,?,?,0,?,0,'ring_history',1,1)",
            arrayOf<Any>("d$day", day, steps, steps * 0.7),
        )
        daily(oct22, 2 * minutes.sum() + 101); daily(oct27, 110 * 3 + 90 * 2 + 70); daily(oct20, 5_000)
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 32 }

        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(ClockDuplicateMigration({ listOf(segment) }, now = { migratedAt }), PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37)
            .allowMainThreadQueries().build()
        try {
            val db = migrated.openHelper.writableDatabase // Room validates the full current schema here.
            assertEquals(DATABASE_VERSION, db.version)
            runBlocking {
                val buckets = migrated.activityBucketDao()
                assertEquals(raws.map { it - offset } + listOf(oddRaw - offset, oddRaw), buckets.byDay(oct22).map { it.startEpoch })
                assertEquals(listOf(t, neighbour, u + 311), buckets.byDay(oct27).map { it.startEpoch })
                assertEquals(listOf(clean), buckets.byDay(oct20).map { it.startEpoch })

                val days = migrated.activityDailyDao()
                assertEquals(minutes.sum() + 101, days.byDay(oct22)!!.steps)
                assertNull(days.byDay(oct22)!!.deviceSteps)
                assertEquals(110 + 70 + 90, days.byDay(oct27)!!.steps)
                assertEquals(5_000, days.byDay(oct20)!!.steps)
                assertEquals(5_000, days.byDay(oct20)!!.deviceSteps)

                val removed = (raws + listOf(t - 679, t + 299, u - 321)).sorted()
                val pending = migrated.hubPendingDeletionDao().next(100)
                assertEquals(removed, pending.map { it.fromMs }.sorted())
                assertTrue(pending.all { it.fromMs == it.toMs && it.category == "activity/buckets" && it.kind == "activity_bucket" })

                // While paired, the uploader turns them into deletion events: exact instants, joined
                // into one range only where no bucket that stays lies between (0.6.3).
                assertEquals(removed.size, HubPendingDeletions.drain(migrated, "inst", Instant.ofEpochMilli(migratedAt)))
                assertTrue(migrated.hubPendingDeletionDao().next(100).isEmpty())
                val targets = migrated.hubOutboxDao().pending(100).map {
                    val envelope = Json.parseToJsonElement(it.payloadJson).jsonObject
                    assertEquals("com.pulseloop.deletion.v1", envelope["type"]!!.jsonPrimitive.content)
                    envelope["data"]!!.jsonObject["target"]!!.jsonObject
                }
                val kept = (buckets.byDay(oct22) + buckets.byDay(oct27) + buckets.byDay(oct20)).map { it.startEpoch }
                com.pulseloop.hub.assertCoversExactly(removed, kept, targets.map {
                    Instant.parse(it["from"]!!.jsonPrimitive.content).toEpochMilli() to Instant.parse(it["to"]!!.jsonPrimitive.content).toEpochMilli()
                })
                assertTrue("the raw twins of one stretch join", targets.size < removed.size)
            }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }

    @Test fun `without clock segments only sub-second copies are removed`() {
        val name = "clock-duplicate-migration-plain.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("DROP TABLE hub_pending_deletions")
        val t = Instant.parse("2026-10-27T05:30:19Z").toEpochMilli()
        for (start in listOf(t, t - 679, t - offset)) sql.execSQL(
            "INSERT INTO activity_buckets(startEpoch,date,steps,distanceMeters,source,updatedAt) VALUES(?,?,10,7,'ring_history',1)",
            arrayOf<Any>(start, TimeUtil.startOfDayLocal(start)),
        )
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 32 }
        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(PulseLoopDatabase.MIGRATION_32_33, PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            migrated.openHelper.writableDatabase
            runBlocking {
                assertEquals(listOf(t - offset, t), migrated.activityBucketDao().startingBetween(0, Long.MAX_VALUE).map { it.startEpoch })
                assertEquals(listOf(t - 679), migrated.hubPendingDeletionDao().next(10).map { it.fromMs })
            }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }

    @Test fun `32 to 33 removes duplicate readings of every kind and cuts the doubled sleep tail`() {
        val name = "clock-duplicate-migration-history.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("DROP TABLE hub_pending_deletions")
        fun reading(id: String, kind: String, at: Long, value: Double, source: String = "history") = sql.execSQL(
            "INSERT INTO measurements(id,kindRaw,value,unit,timestamp,sourceRaw,confidenceRaw,createdAt) VALUES(?,?,?,'',?,?,'known',1)",
            arrayOf<Any>(id, kind, value, at, source),
        )
        // Oct 22 03:29:30 IST (the owner's HRV record) and the real HR reading one second later,
        // each stored raw by 2.7.2 and corrected by 2.7.3.
        val r = Instant.parse("2026-10-21T21:59:30Z").toEpochMilli()
        for ((at, kind, v) in listOf(Triple(r, "HEART_RATE", 65.0), Triple(r + 1_000, "HEART_RATE", 65.0), Triple(r, "HRV", 19.0))) {
            reading("history:$kind:$at", kind, at, v); reading("history:$kind:${at - offset}", kind, at - offset, v)
        }
        reading("vendor:hrv_raw:$r", "VENDOR_HRV_RAW", r, 28.0, "vendor_history")
        reading("vendor:hrv_raw:${r - offset}", "VENDOR_HRV_RAW", r - offset, 28.0, "vendor_history")
        // The day total is date-stamped: 2.7.3 filed a shifted copy under 23:53 the evening before.
        val midnight = TimeUtil.startOfDayLocal(r)
        reading("vendor:exercise_duration_raw:$midnight", "VENDOR_EXERCISE_DURATION_RAW", midnight, 300.0, "vendor_history")
        reading("vendor:exercise_duration_raw:${midnight - offset}", "VENDOR_EXERCISE_DURATION_RAW", midnight - offset, 120.0, "vendor_history")
        // Oct 27: a sub-second copy (same value) goes; an off-grid reading with its own value and
        // a live reading are not copies and stay.
        val t = Instant.parse("2026-10-27T05:30:19Z").toEpochMilli()
        reading("history:hr:$t", "HEART_RATE", t, 70.0)
        reading("history:hr:${t - 679}", "HEART_RATE", t - 679, 70.0)
        reading("history:hr:${t + 311}", "HEART_RATE", t + 311, 72.0)
        reading("live-1", "HEART_RATE", t - 500, 70.0, "live")

        // The Oct 22 night as 2.7.3 left it: the corrected packet (30 min, 29 asleep) plus the
        // raw copy's last 6 minutes of deep sleep surviving past it.
        val c = Instant.parse("2026-10-21T20:13:59Z").toEpochMilli() - offset
        val night = listOf("AWAKE" to 1, "LIGHT" to 16, "DEEP" to 3, "LIGHT" to 1, "DEEP" to 9, "DEEP" to 6)
        fun session(id: String, start: Long, blocks: List<Pair<String, Int>>, createdAt: Long) {
            val minutes = blocks.sumOf { it.second }
            sql.execSQL(
                "INSERT INTO sleep_sessions(id,date,startAt,endAt,totalMinutes,score,sourceRaw,createdAt,updatedAt) VALUES(?,?,?,?,?,NULL,'ring',?,?)",
                arrayOf<Any>(id, TimeUtil.wakingDayLocal(start), start, start + minutes * 60_000L, blocks.filter { it.first != "AWAKE" }.sumOf { it.second }, createdAt, createdAt),
            )
            var at = start; var minute = 0
            blocks.forEachIndexed { i, (stage, n) ->
                sql.execSQL(
                    "INSERT INTO sleep_stage_blocks(id,sessionId,startAt,startMinute,durationMinutes,stageRaw) VALUES(?,?,?,?,?,?)",
                    arrayOf<Any>("$id-$i", id, at, minute, n, stage),
                )
                at += n * 60_000L; minute += n
            }
        }
        session("oct22", c, night, createdAt = Instant.parse("2026-10-22T02:00:00Z").toEpochMilli())
        // A later run the same night, 30 minutes on, that 2.7.3 never re-pulled: not to be touched.
        val later = Instant.parse("2026-10-21T21:20:00Z").toEpochMilli()
        sql.execSQL(
            "INSERT INTO sleep_stage_blocks(id,sessionId,startAt,startMinute,durationMinutes,stageRaw) VALUES('oct22-later','oct22',?,0,20,'LIGHT')",
            arrayOf<Any>(later),
        )
        // The Oct 27 night, first received corrected at the set and finished on the new clock: untouched.
        val n27 = Instant.parse("2026-10-26T18:00:00Z").toEpochMilli() - offset
        session("oct27", n27, listOf("LIGHT" to 300, "DEEP" to 60, "AWAKE" to 10), createdAt = segment.setAtMs)
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 32 }

        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(ClockDuplicateMigration({ listOf(segment) }, now = { migratedAt }), PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37)
            .allowMainThreadQueries().build()
        try {
            migrated.openHelper.writableDatabase
            runBlocking {
                val m = migrated.measurementDao()
                assertEquals(listOf(r - offset, r + 1_000 - offset), m.historyBetween("HEART_RATE", r - 3_600_000, r + 3_600_000).map { it.timestamp })
                assertEquals(listOf(r - offset), m.historyBetween("HRV", 0, Long.MAX_VALUE).map { it.timestamp })
                assertEquals(listOf(r - offset), m.historyBetween("VENDOR_HRV_RAW", 0, Long.MAX_VALUE).map { it.timestamp })
                assertEquals(listOf(midnight), m.historyBetween("VENDOR_EXERCISE_DURATION_RAW", 0, Long.MAX_VALUE).map { it.timestamp })
                assertEquals(listOf(t, t + 311), m.historyBetween("HEART_RATE", t - 5_000, t + 5_000).map { it.timestamp })
                assertEquals(1, m.byIds(listOf("live-1")).size)

                val oct22 = migrated.sleepSessionDao().ringAllByDay(TimeUtil.wakingDayLocal(c)).single()
                assertEquals(29 + 20, oct22.totalMinutes)
                assertEquals(later + 20 * 60_000L, oct22.endAt)
                val blocks = migrated.sleepStageBlockDao().forSession(oct22.id)
                assertEquals(30 + 20, blocks.sumOf { it.durationMinutes })
                assertEquals(c + 30 * 60_000L, blocks.filter { it.startAt < later }.maxOf { it.startAt + it.durationMinutes * 60_000L })
                val oct27 = migrated.sleepSessionDao().ringAllByDay(TimeUtil.wakingDayLocal(n27)).single()
                assertEquals(360, oct27.totalMinutes)

                val pending = migrated.hubPendingDeletionDao().next(100).map { Triple(it.category, it.kind, it.fromMs) }.toSet()
                assertEquals(
                    setOf(
                        Triple("metrics/hr", "hr", r), Triple("metrics/hr", "hr", r + 1_000), Triple("metrics/hr", "hr", t - 679),
                        Triple("metrics/hrv", "hrv", r), Triple("vendor/hrv_raw", "hrv_raw", r),
                        Triple("vendor/exercise_duration_raw", "exercise_duration_raw", midnight - offset),
                    ),
                    pending,
                )
            }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}
