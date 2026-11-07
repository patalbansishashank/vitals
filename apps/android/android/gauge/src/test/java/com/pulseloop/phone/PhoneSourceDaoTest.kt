package com.pulseloop.phone

import androidx.room.Room
import com.pulseloop.data.sources.SourcesDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The counter core against the real Room store: a sample, its delta and the records persist together. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class PhoneSourceDaoTest {
    private val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), SourcesDatabase::class.java)
        .allowMainThreadQueries().build()

    @After fun close() = db.close()

    @Test fun `samples, pending deltas, records and intervals round-trip through Room`() = runBlocking {
        val dao = db.phoneDao()
        val clock = PhoneStepCounterTest.FakeClock(1_790_000_000_000L, 1_000_000_000_000L)
        val sensors = PhoneStepCounterTest.FakeSensors(hasDetector = false)
        val counter = PhoneStepCounter(PhoneStepCounter.DaoStore(dao), sensors, clock, PhoneAcquisitionLog(PhoneAcquisitionLog.DaoStore(dao)), { true })
        counter.start()
        counter.onCounter(clock.elapsed, 1_000)
        clock.advance(20.0)
        counter.onCounter(clock.elapsed, 1_030)
        clock.advance(200.0)
        counter.onCounter(clock.elapsed, 1_100)
        counter.stop()
        assertEquals(1_100L, dao.last()!!.count)
        assertTrue(dao.pending().isEmpty())
        val records = dao.recordsAfter(0, 100)
        assertEquals(listOf(30L, 70L), records.map { it.steps })
        assertEquals(listOf("minute", "counterSpan"), records.map { it.support })
        // A resolved span written twice (same subject) is ignored, never duplicated.
        dao.insertRecords(records.map { it.copy(seq = 0) })
        assertEquals(2, dao.recordsAfter(0, 100).size)
        val closed = dao.closedIntervalsAfter(0, 10)
        assertEquals(listOf("listening"), closed.map { it.state })
        assertEquals("stopped", dao.openInterval()!!.state)
    }
}
