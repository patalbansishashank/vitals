package com.pulseloop.hub

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityGpsPointEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.MeasurementEntity
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Workouts reach the hub outbox from the sessions table, once per change, with their route and HR. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HubWorkoutSyncTest {
    private val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java)
        .allowMainThreadQueries().build()
    private val settings = FakeHubSettings("https://hub.example:8443")
    private val cursor = object : HubSourceCursor { override var value: String? = null }
    private val sync = HubWorkoutSync(db, settings, cursor, now = { Instant.parse("2026-10-27T08:00:00Z") }, pageSize = 2)

    @After fun tearDown() = db.close()

    private fun session(id: String, status: String, updatedAt: Long) = ActivitySessionEntity(
        id = id, type = "walk", statusRaw = status, startedAt = 1_000_000L, endedAt = 1_000_000L + 1_800_000L,
        createdAt = 1L, updatedAt = updatedAt,
    )

    private suspend fun hubRows() = db.hubOutboxDao().pending(100)

    @Test fun `queues finished workouts once and deletions for cancelled ones`() = runBlocking {
        db.activitySessionDao().upsert(session("a", "finished", 10))
        db.activitySessionDao().upsert(session("b", "recording", 11))
        db.activitySessionDao().upsert(session("c", "cancelled", 12))
        db.activitySessionDao().upsert(session("d", "finished", 13))
        db.activityGpsPointDao().insert(ActivityGpsPointEntity(sessionId = "a", latitude = 51.5, longitude = -0.12, timestamp = 1_000_500L))
        db.measurementDao().upsert(MeasurementEntity(id = "history:hr:1", kindRaw = "HEART_RATE", value = 120.0, unit = "bpm", timestamp = 1_100_000L, sourceRaw = "history"))
        db.measurementDao().upsert(MeasurementEntity(id = "history:hr:2", kindRaw = "HEART_RATE", value = 130.0, unit = "bpm", timestamp = 1_160_000L, sourceRaw = "history"))

        assertEquals(4, sync.enqueueChanged())
        val rows = hubRows()
        // Session "a" also uploads its one GPS fix as an activity/gps chunk (SPEC GA.6).
        assertEquals(listOf("activity/gps", "activity/session", "activity/session", "deletion"), rows.map { it.category }.sorted())
        val a = rows.first { it.payloadJson.contains("\"subject\":\"a\"") }
        assertTrue(a.payloadJson.contains("\"route\""))
        assertTrue(a.payloadJson.contains("\"zones\""))
        assertTrue(rows.none { it.payloadJson.contains("\"subject\":\"b\"") })

        // Nothing changed: nothing new is queued.
        assertEquals(0, sync.enqueueChanged())
        // An edit bumps updatedAt and is sent again as a newer version.
        db.activitySessionDao().upsert(session("a", "finished", 20).copy(distanceMeters = 2500.0))
        // The new session version and its unchanged GPS chunk; the outbox drops the chunk's duplicate id.
        assertEquals(2, sync.enqueueChanged())
        assertEquals(5, hubRows().size)
    }

    @Test fun `does nothing while unpaired and starts over after a reset`() = runBlocking {
        db.activitySessionDao().upsert(session("a", "finished", 10))
        settings.unpair()
        assertEquals(0, sync.enqueueChanged())
        assertEquals(null, cursor.value)

        val paired = HubWorkoutSync(db, FakeHubSettings("https://hub.example:8443"), cursor, pageSize = 2)
        assertEquals(1, paired.enqueueChanged())
        assertEquals(0, paired.enqueueChanged())
        paired.reset()
        assertEquals(1, paired.enqueueChanged()) // the same id again; the outbox ignores the duplicate
        assertEquals(1, db.hubOutboxDao().pending(100).size)
    }
}
