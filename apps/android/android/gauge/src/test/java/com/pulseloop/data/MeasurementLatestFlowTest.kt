package com.pulseloop.data

import androidx.room.Room
import com.pulseloop.data.entity.MeasurementEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class MeasurementLatestFlowTest {
    @Test fun `latest flows retain timestamps and exclude demo and mock from real series`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java).build()
        try {
            val dao = db.measurementDao()
            assertNull(dao.latestRealFlow("HEART_RATE").first())
            dao.insert(MeasurementEntity("demo", "HEART_RATE", 99.0, "bpm", 200, "demo"))
            dao.insert(MeasurementEntity("mock", "HEART_RATE", 98.0, "bpm", 300, "mock"))
            assertNull(dao.latestRealFlow("HEART_RATE").first())
            dao.insert(MeasurementEntity("real", "HEART_RATE", 65.0, "bpm", 100, "history"))
            assertEquals("mock", dao.latestFlow("HEART_RATE").first()?.id)
            val real = dao.latestRealFlow("HEART_RATE").first()!!
            assertEquals(65.0, real.value, 0.0)
            assertEquals(100L, real.timestamp)
        } finally { db.close() }
    }
}
