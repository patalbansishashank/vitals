package com.pulseloop.data

import androidx.room.Room
import com.pulseloop.data.entity.MeasurementEntity
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class MeasurementChangeFlowTest {
    @Test fun `insert update and non maximum delete all emit even if max rowid is unchanged`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java).build()
        val changes = Channel<Long?>(Channel.UNLIMITED)
        val collector = launch(Dispatchers.IO) { db.measurementDao().changeFlow().collect { changes.send(it) } }
        suspend fun next() = withTimeout(5000) { changes.receive() }
        try {
            assertNull(next())
            val a = MeasurementEntity("a", "HEART_RATE", 60.0, "bpm", 1, "history")
            db.measurementDao().insert(a); assertEquals(1L, next())
            db.measurementDao().insert(a.copy(id = "b", timestamp = 2)); assertEquals(2L, next())
            db.measurementDao().upsert(a.copy(value = 70.0)); assertEquals(2L, next())
            db.measurementDao().deleteByIds(listOf("a")); assertEquals(2L, next())
        } finally { collector.cancelAndJoin(); db.close() }
    }
}
