package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.MeasurementDeletionEntity
import com.pulseloop.ring.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HistoryTombstoneBatchTest {
    @Test fun `batch membership agrees with individual id and inclusive spot window queries`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val subscriber = EventPersistenceSubscriber(context, db, enabledOverride = { false })
        try {
            val center = 1_000_000L
            // Distinct values on purpose. The boundary pairs (-90 001 / -90 000, 90 000 / 90 001) are
            // 1 ms apart, and since 2.7.4 two history samples of one kind under a second apart with
            // the SAME value are one record re-stamped by a clock correction
            // (ClockDuplicates.SAME_RECORD_MS), so the later write retires the earlier row. With one
            // shared value this test measured that rule instead of the tombstone windows.
            val events = listOf(-90_001L, -90_000, 0, 90_000, 90_001, 500_000).mapIndexed { i, offset -> PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 70.0 + i, Instant.ofEpochMilli(center + offset)) }
            db.measurementDeletionDao().insertAll(listOf(
                MeasurementDeletionEntity("spot:HEART_RATE:$center", "HEART_RATE", center),
                MeasurementDeletionEntity(historyMeasurementId(MeasurementKind.HEART_RATE, center + 500_000), "HEART_RATE", center + 500_000),
            ))
            val expected = events.filterNot {
                val at = it.timestamp.toEpochMilli()
                db.measurementDeletionDao().isDeleted(historyMeasurementId(it.kind, at)) || db.measurementDeletionDao().isSpotDeleted(it.kind.name, at - 90_000, at + 90_000)
            }.map { it.timestamp.toEpochMilli() }
            subscriber.persistBatch(events)
            assertEquals(expected, db.measurementDao().range("HEART_RATE", 0, 2_000_000).map { it.timestamp })
        } finally { subscriber.stop(); db.close() }
    }
}
