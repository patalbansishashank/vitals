package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class EventPersistenceBatchTest {
    @Test fun `non database event preparation failure skips only that event`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        var calls = 0
        val subscriber = EventPersistenceSubscriber(context, db, enabledOverride = {
            if (++calls == 2) throw IllegalStateException("malformed event preparation")
            false
        })
        try {
            subscriber.persistBatch((60..62).map { PulseEvent.HeartRateSample(it, Instant.ofEpochMilli(it.toLong())) })
            assertEquals(listOf(60.0, 62.0), db.measurementDao().range("HEART_RATE", 0, 100).map { it.value })
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `malformed history timestamp cannot abort tombstone preload for valid neighbors`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val subscriber = EventPersistenceSubscriber(context, db, enabledOverride = { false })
        try {
            subscriber.persistBatch(listOf(
                PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 60.0, Instant.ofEpochMilli(1)),
                PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 61.0, Instant.MAX),
                PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 62.0, Instant.ofEpochMilli(2)),
            ))
            assertEquals(listOf(60.0, 62.0), db.measurementDao().range("HEART_RATE", 0, 100).map { it.value })
        } finally { subscriber.stop(); db.close() }
    }
    @Test fun `gates preserve order and callbacks and outbox flush once per committed batch`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        var notifications = 0; var flushes = 0; var enabled = true
        val subscriber = EventPersistenceSubscriber(context, db, { notifications++ }, { enabled }, { "test" }, { flushes++ })
        fun sample(value: Int) = PulseEvent.HeartRateSample(value, Instant.ofEpochMilli(value.toLong()))
        try {
            subscriber.persistBatch(listOf(sample(60), PulseEvent.LiveSampleGate(MeasurementKind.HEART_RATE, true), sample(61), PulseEvent.LiveSampleGate(MeasurementKind.HEART_RATE, false), sample(62)))
            assertEquals(listOf(60.0, 62.0), db.measurementDao().range("HEART_RATE", 0, 1000).map { it.value })
            assertEquals(2, db.broadcastOutboxDao().pendingCount())
            assertEquals(1, notifications); assertEquals(1, flushes)
            enabled = false
            subscriber.persistBatch(listOf(sample(63)))
            assertEquals(2, db.broadcastOutboxDao().pendingCount())
            enabled = true
            subscriber.persistBatch(listOf(sample(64)))
            assertEquals(3, db.broadcastOutboxDao().pendingCount())
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `database failure retains and retries the rolled back batch in order`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        var notifications = 0; var flushes = 0; var failOnce = true
        val delays = mutableListOf<Long>()
        val subscriber = EventPersistenceSubscriber(
            context = context,
            db = db,
            onDataPersisted = { notifications++ },
            enabledOverride = { true },
            installationIdOverride = { "test" },
            flushOverride = { flushes++ },
            afterEventPersistOverride = { event ->
                if (failOnce && event is PulseEvent.HeartRateSample && event.bpm == 62) {
                    failOnce = false
                    throw android.database.SQLException("transient write failure")
                }
            },
            batchRetryDelay = { delays += it },
        )
        try {
            subscriber.persistBatch(listOf(
                PulseEvent.HeartRateSample(60, Instant.ofEpochMilli(1)),
                PulseEvent.LiveSampleGate(MeasurementKind.HEART_RATE, true),
                PulseEvent.HeartRateSample(61, Instant.ofEpochMilli(2)),
                PulseEvent.LiveSampleGate(MeasurementKind.HEART_RATE, false),
                PulseEvent.HeartRateSample(62, Instant.ofEpochMilli(3)),
            ))
            assertEquals(listOf(60.0, 62.0), db.measurementDao().range("HEART_RATE", 0, 100).map { it.value })
            assertEquals(2, db.broadcastOutboxDao().pendingCount())
            assertEquals(1, notifications)
            assertEquals(1, flushes)
            assertEquals(listOf(100L), delays)
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `after write non sql failure rolls back only that event and its outbox`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val subscriber = EventPersistenceSubscriber(
            context = context,
            db = db,
            enabledOverride = { true },
            installationIdOverride = { "test" },
            flushOverride = {},
            afterEventPersistOverride = { event ->
                if (event is PulseEvent.HeartRateSample && event.bpm == 61) {
                    throw IllegalStateException("malformed after first DAO write")
                }
            },
        )
        try {
            subscriber.persistBatch((60..62).map {
                PulseEvent.HeartRateSample(it, Instant.ofEpochMilli(it.toLong()))
            })
            assertEquals(listOf(60.0, 62.0), db.measurementDao().range("HEART_RATE", 0, 100).map { it.value })
            assertEquals(2, db.broadcastOutboxDao().pendingCount())
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `savepoint isolates failure inside a real multi write child operation`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val subscriber = EventPersistenceSubscriber(
            context = context,
            db = db,
            enabledOverride = { true },
            installationIdOverride = { "test" },
            flushOverride = {},
            afterAtomicWriteOverride = { step ->
                if (step == "blood_pressure_systolic") {
                    throw IllegalArgumentException("malformed diastolic child write")
                }
            },
        )
        try {
            subscriber.persistBatch(listOf(
                PulseEvent.BloodPressureSample(120, 80, Instant.ofEpochMilli(1)),
                PulseEvent.HeartRateSample(70, Instant.ofEpochMilli(2)),
            ))
            assertTrue(db.measurementDao().range("BLOOD_PRESSURE_SYSTOLIC", 0, 100).isEmpty())
            assertTrue(db.measurementDao().range("BLOOD_PRESSURE_DIASTOLIC", 0, 100).isEmpty())
            assertEquals(listOf(70.0), db.measurementDao().range("HEART_RATE", 0, 100).map { it.value })
            assertEquals(1, db.broadcastOutboxDao().pendingCount())
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `post commit callback failures neither replay data nor block later effects`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        var dataCallbacks = 0; var flushCallbacks = 0; var retryDelays = 0
        val subscriber = EventPersistenceSubscriber(
            context = context,
            db = db,
            onDataPersisted = { dataCallbacks++; error("widget callback failed") },
            enabledOverride = { true },
            installationIdOverride = { "test" },
            flushOverride = { flushCallbacks++; error("flush callback failed") },
            batchRetryDelay = { retryDelays++ },
        )
        try {
            subscriber.persistBatch(listOf(PulseEvent.HeartRateSample(77, Instant.ofEpochMilli(1))))
            assertEquals(1, dataCallbacks)
            assertEquals(1, flushCallbacks)
            assertEquals(0, retryDelays)
            assertEquals(1, db.measurementDao().range("HEART_RATE", 0, 100).size)
            assertEquals(1, db.broadcastOutboxDao().pendingCount())
        } finally { subscriber.stop(); db.close() }
    }

    @Test fun `persistence retry delay grows and caps`() {
        assertEquals(100L, EventPersistenceSubscriber.persistenceRetryDelayMillis(0))
        assertEquals(200L, EventPersistenceSubscriber.persistenceRetryDelayMillis(1))
        assertEquals(5_000L, EventPersistenceSubscriber.persistenceRetryDelayMillis(20))
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `buffer flushes on capacity deadline and control without reordering`() = runTest {
        val input = MutableSharedFlow<PulseEvent>(extraBufferCapacity = 100)
        val batches = mutableListOf<List<PulseEvent>>()
        val job = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { OrderedEventBatcher.collect(input, { testScheduler.currentTime * 1_000_000 }) { batches += it } }
        val samples = (0..63).map { PulseEvent.BatteryLevel(it) }
        samples.forEach { input.emit(it) }; runCurrent()
        assertEquals(samples, batches.single())
        input.emit(PulseEvent.BatteryLevel(80)); runCurrent()
        advanceTimeBy(151); runCurrent()
        assertEquals(2, batches.size)
        input.emit(PulseEvent.BatteryLevel(81)); input.emit(PulseEvent.LiveSampleGate(MeasurementKind.HEART_RATE, true)); runCurrent()
        assertEquals(3, batches.size)
        assertTrue(batches.last().last() is PulseEvent.LiveSampleGate)
        input.emit(PulseEvent.BatteryLevel(82)); runCurrent()
        advanceTimeBy(100)
        input.emit(PulseEvent.BatteryLevel(83)); runCurrent()
        advanceTimeBy(49); runCurrent()
        assertEquals(3, batches.size)
        advanceTimeBy(1); runCurrent()
        assertEquals(4, batches.size)
        assertEquals(listOf(PulseEvent.BatteryLevel(82), PulseEvent.BatteryLevel(83)), batches.last())
        job.cancel()
    }
}
