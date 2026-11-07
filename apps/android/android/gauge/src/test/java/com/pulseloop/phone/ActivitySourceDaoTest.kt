package com.pulseloop.phone

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.DetectedActivity
import com.pulseloop.data.sources.ActivityAcquisitionEntity
import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.PhoneAnchorEntity
import com.pulseloop.data.sources.SourcesDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** sources.db v3 (Gauge 2.8.3): activity transitions persist idempotently; v2 → v3 keeps the phone rows. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class ActivitySourceDaoTest {

    @Test fun `transitions persist once through Room, with the counter's anchor and the acquisition log`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), SourcesDatabase::class.java).allowMainThreadQueries().build()
        try {
            val dao = db.activityDao()
            val clock = PhoneStepCounterTest.FakeClock(1_790_000_000_000L, 1_000_000_000_000L, "b3")
            // The step counter's anchor, written through its own DAO.
            db.phoneDao().putAnchor(PhoneAnchorEntity("b3:${clock.utc}:${clock.elapsed}", "b3", clock.utc, clock.elapsed, "start", clock.utc))
            val registrar = PhoneActivityRecognitionTest.FakeRegistrar()
            val ar = PhoneActivityRecognition(PhoneActivityRecognition.DaoStore(dao), registrar, clock, ActivityRecognitionLog(ActivityRecognitionLog.DaoStore(dao)), { true })
            assertEquals("listening", ar.start("service"))
            clock.advance(300.0)
            val batch = listOf(
                PhoneActivityRecognition.RawTransition(DetectedActivity.STILL, ActivityTransition.ACTIVITY_TRANSITION_EXIT, clock.elapsed - 10_000_000_000L),
                PhoneActivityRecognition.RawTransition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_ENTER, clock.elapsed - 10_000_000_000L),
            )
            assertEquals(2, ar.onTransitions(batch, null))
            assertEquals(0, ar.onTransitions(batch, null))
            val rows = dao.transitionsAfter(0, 10)
            assertEquals(2, rows.size)
            assertTrue(rows.all { it.anchorId == "b3:1790000000000:1000000000000" && it.occurredAtMs == clock.utc - 10_000 && it.registrationEpoch == 1 })
            assertEquals(1, dao.maxEpoch())
            ar.stop()
            assertEquals(listOf("listening"), dao.closedIntervalsAfter(0, 10).map { it.state })
            assertEquals(clock.utc, dao.openInterval()!!.fromMs)
        } finally {
            db.close()
        }
    }

    @Test fun `v2 rows survive and v3 adds the activity tables`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val name = "sources-migration-v3-test.db"
        context.deleteDatabase(name)
        Room.databaseBuilder(context, SourcesDatabase::class.java, name).allowMainThreadQueries().build().also {
            it.openHelper.writableDatabase
            it.close()
        }
        // Back to v2: no activity tables, one phone interval.
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { raw ->
            raw.execSQL("DROP TABLE `activity_transitions`")
            raw.execSQL("DROP TABLE `activity_acquisition`")
            raw.execSQL("INSERT INTO `phone_acquisition` (`fromMs`, `toMs`, `state`, `lastSeenMs`, `detector`) VALUES (1000, 2000, 'listening', 2000, 'registered')")
            raw.version = 2
        }
        val db = Room.databaseBuilder(context, SourcesDatabase::class.java, name)
            .addMigrations(SourcesDatabase.MIGRATION_1_2, SourcesDatabase.MIGRATION_2_3).allowMainThreadQueries().build()
        try {
            assertEquals(listOf<PhoneAcquisitionEntity>(PhoneAcquisitionEntity(seq = 1, fromMs = 1000, toMs = 2000, state = "listening", lastSeenMs = 2000, detector = "registered")),
                db.phoneDao().closedIntervalsAfter(0, 10))
            val dao = db.activityDao()
            assertEquals(0, dao.maxEpoch())
            dao.putInterval(ActivityAcquisitionEntity(fromMs = 1, toMs = 2, state = "listening", lastSeenMs = 2, registrationEpoch = 1))
            assertEquals(1, dao.closedIntervalsAfter(0, 10).size)
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }
}
