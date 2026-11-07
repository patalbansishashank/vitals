package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.PulseEvent
import com.pulseloop.util.TimeUtil
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
class ActivityBucketRollupTest {
    @Test fun `96 buckets and replay corrections equal individual transactions`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val batchDb = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val singleDb = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).build()
        val batch = EventPersistenceSubscriber(context, batchDb, enabledOverride = { false })
        val single = EventPersistenceSubscriber(context, singleDb, enabledOverride = { false })
        try {
            val day = TimeUtil.startOfDayLocal(System.currentTimeMillis() - 3 * 86_400_000)
            val events = (0..95).map { PulseEvent.ActivityBucket(Instant.ofEpochMilli(day + it * 900_000L), it * 7, it * 1.5) }
            for (pass in listOf(events, events.map { it.copy(steps = it.steps / 2) })) {
                batch.persistBatch(pass)
                pass.forEach { single.persistBatch(listOf(it)) }
                val a = batchDb.activityDailyDao().byDay(day)!!
                val b = singleDb.activityDailyDao().byDay(day)!!
                assertEquals(b.steps, a.steps); assertEquals(b.distanceMeters, a.distanceMeters, 0.00001)
                assertEquals(b.source, a.source); assertEquals(b.calories, a.calories, 0.0)
            }
        } finally { batch.stop(); single.stop(); batchDb.close(); singleDb.close() }
    }
}
