package com.pulseloop.phone

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.SourcesDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** sources.db v1 → v2 (Gauge 2.8.1): `phone_acquisition.detector` is added, existing rows keep null. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class SourcesDatabaseMigrationTest {
    @Test fun `v1 intervals survive and v2 stores the detector`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val name = "sources-migration-test.db"
        context.deleteDatabase(name)
        // Build the current schema, then turn phone_acquisition back into its v1 shape.
        Room.databaseBuilder(context, SourcesDatabase::class.java, name).allowMainThreadQueries().build().also {
            it.openHelper.writableDatabase
            it.close()
        }
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { raw ->
            raw.execSQL("DROP TABLE `phone_acquisition`")
            // v3's tables did not exist at v1 either (2.8.3).
            raw.execSQL("DROP TABLE `activity_transitions`")
            raw.execSQL("DROP TABLE `activity_acquisition`")
            raw.execSQL(
                "CREATE TABLE IF NOT EXISTS `phone_acquisition` (`seq` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`fromMs` INTEGER NOT NULL, `toMs` INTEGER, `state` TEXT NOT NULL, `lastSeenMs` INTEGER NOT NULL)",
            )
            raw.execSQL("CREATE INDEX IF NOT EXISTS `index_phone_acquisition_toMs` ON `phone_acquisition` (`toMs`)")
            raw.execSQL("INSERT INTO `phone_acquisition` (`fromMs`, `toMs`, `state`, `lastSeenMs`) VALUES (1000, 2000, 'listening', 2000)")
            raw.version = 1
        }
        val db = Room.databaseBuilder(context, SourcesDatabase::class.java, name)
            .addMigrations(SourcesDatabase.MIGRATION_1_2, SourcesDatabase.MIGRATION_2_3).allowMainThreadQueries().build()
        try {
            val dao = db.phoneDao()
            val old = dao.closedIntervalsAfter(0, 10).single()
            assertEquals("listening", old.state)
            assertNull(old.detector)
            dao.putInterval(PhoneAcquisitionEntity(fromMs = 2000, toMs = 3000, state = "listening", lastSeenMs = 3000, detector = PhoneAcquisitionLog.DETECTOR_REGISTERED))
            assertEquals(PhoneAcquisitionLog.DETECTOR_REGISTERED, dao.closedIntervalsAfter(old.seq, 10).single().detector)
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }
}
