package com.pulseloop.shortvideo

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.pulseloop.data.DATABASE_VERSION
import com.pulseloop.data.PulseLoopDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class ShortVideoMigrationTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test fun `31 to 32 adds short_video_days and keeps existing rows`() {
        val name = "short-video-migration.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("DROP TABLE short_video_days")
        sql.execSQL("INSERT INTO measurements(id,kindRaw,value,unit,timestamp,sourceRaw,confidenceRaw,createdAt) VALUES('history:hr:1','HEART_RATE',70,'bpm',1,'history','known',1)")
        sql.execSQL("INSERT INTO hub_outbox(eventId,category,payloadJson,createdAt,attemptCount,rejected) VALUES('pl-1','metrics/hr','{}',1,0,0)")
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 31 }

        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(PulseLoopDatabase.MIGRATION_31_32, PulseLoopDatabase.MIGRATION_32_33, PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            val db = migrated.openHelper.writableDatabase // Room validates the full current schema here.
            assertEquals(DATABASE_VERSION, db.version)
            for (table in listOf("measurements", "hub_outbox")) {
                db.query("SELECT COUNT(*) FROM $table").use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
            }
            runBlocking {
                val dao = migrated.shortVideoDao()
                dao.increment("2026-10-22", "youtube", ShortVideoDao.Field.COUNT, 30, 10)
                dao.increment("2026-10-22", "youtube", ShortVideoDao.Field.COUNT, 30, 20)
                dao.increment("2026-10-22", "youtube", ShortVideoDao.Field.CANCEL, 25, 30)
                val row = dao.day("2026-10-22").single()
                assertEquals(2, row.count)
                assertEquals(1, row.cancels)
                assertEquals(25, row.dailyLimit)
                assertEquals(30L, row.updatedAt)
            }
            assertTrue("short_video_days" in PulseLoopDatabase.ALL_TABLES)
        } finally {
            migrated.close()
            context.deleteDatabase(name)
        }
    }
}
