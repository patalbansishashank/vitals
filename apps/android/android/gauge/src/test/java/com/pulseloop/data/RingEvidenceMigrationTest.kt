package com.pulseloop.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** v35 -> v36 (SPEC GA): bucket support columns, legacy rows stay `legacyUnknown`, the 0x18 capture table. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RingEvidenceMigrationTest {
    private lateinit var context: Context
    private val name = "ring-evidence-migration-test.db"

    @Before fun setUp() { context = RuntimeEnvironment.getApplication(); context.deleteDatabase(name) }
    @After fun tearDown() { context.deleteDatabase(name) }

    /** Rebuild the v35 shape of the tables v36 changes, with one legacy bucket row. */
    private fun createV35() {
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("DROP TABLE activity_buckets")
        sql.execSQL(
            "CREATE TABLE `activity_buckets` (`startEpoch` INTEGER NOT NULL, `date` INTEGER NOT NULL, `steps` INTEGER NOT NULL, " +
                "`distanceMeters` REAL NOT NULL, `source` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`startEpoch`))"
        )
        sql.execSQL("CREATE INDEX IF NOT EXISTS `index_activity_buckets_date` ON `activity_buckets` (`date`)")
        sql.execSQL("INSERT INTO activity_buckets VALUES (1000, 0, 640, 450.0, 'ring_history', 1)")
        sql.execSQL("DROP TABLE ring_sport_frames")
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 35 }
    }

    @Test fun `35 to 36 keeps legacy buckets unlabelled and validates the schema`() {
        createV35()
        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            val db = migrated.openHelper.writableDatabase // Room validates the full current schema here (v36, then v37).
            assertEquals(37, db.version)
            db.query("SELECT steps, durationS, support, parentTotal, parentStart, deviceKey FROM activity_buckets").use {
                assertTrue(it.moveToFirst())
                assertEquals(640, it.getInt(0))
                assertTrue("legacy duration stays unknown", it.isNull(1))
                assertEquals("legacyUnknown", it.getString(2))
                assertTrue(it.isNull(3) && it.isNull(4) && it.isNull(5))
            }
            db.query("SELECT COUNT(*) FROM ring_sport_frames").use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
            assertTrue("ring_sport_frames" in PulseLoopDatabase.ALL_TABLES)
            // Idempotent: re-running over an already-migrated database is harmless.
            PulseLoopDatabase.MIGRATION_35_36.migrate(db)
        } finally { migrated.close() }
    }

    @Test fun `a fresh install has the same columns with the legacy default`() {
        val fresh = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        try {
            val db = fresh.openHelper.writableDatabase
            db.execSQL("INSERT INTO activity_buckets (startEpoch, date, steps, distanceMeters, source, updatedAt) VALUES (1, 0, 5, 3.0, 'ring_history', 1)")
            db.query("SELECT support FROM activity_buckets").use { it.moveToFirst(); assertEquals("legacyUnknown", it.getString(0)) }
        } finally { fresh.close() }
    }
}
