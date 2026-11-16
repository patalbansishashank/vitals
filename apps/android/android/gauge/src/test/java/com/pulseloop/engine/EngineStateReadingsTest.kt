package com.pulseloop.engine

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.hub.FakeHubSettings
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.social.SocialPrefs
import com.pulseloop.util.TimeUtil
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * (r087) Today's ring steps and the newest heart rate, as the state carries them from the engine's own database, and the
 * signals that have the state built again when either is stored.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class EngineStateReadingsTest {
    private val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java).build()
    private val zone = ZoneId.of("Asia/Kolkata")
    private val now = Instant.parse("2026-11-15T09:30:00Z").toEpochMilli() // 15:00 local
    private val today = TimeUtil.startOfDayLocal(now, zone)

    @After fun tearDown() = db.close()

    private fun hr(id: String, bpm: Double, at: Long, source: String = "history") = MeasurementEntity(id, "HEART_RATE", bpm, "bpm", at, source)

    private val hub = FakeHubSettings("https://hub.test")
    private val permissions = EngineState.Permissions(Perm.GRANTED, Perm.GRANTED, Perm.GRANTED, Perm.GRANTED, shortVideoAccessibility = false, batteryUnrestricted = true)

    /** The state the plugin sends while the engine runs the ring, with no ring linked. */
    private suspend fun activeState(at: Long = now) =
        EngineStateReader.active(db, RingBLEClient.BLEState(), { false }, hub, ShortVideoPrefs(), SocialPrefs(), usageAccess = false, permissions, at, zone)

    @Test fun `the active state carries today's ring steps and the newest heart rate, and leaves out what it does not have`() = runBlocking {
        val empty = activeState()
        assertEquals(EngineMode.ACTIVE, empty.mode)
        assertNull(empty.today)
        assertNull(empty.latestHr)
        assertFalse(empty.toJson().has("today"))
        assertFalse(empty.toJson().has("latestHr"))

        db.activityDailyDao().upsert(ActivityDailyEntity(date = today, steps = 4321, source = "ring", updatedAt = now - 60_000))
        db.measurementDao().insert(hr("a", 72.6, now - 120_000, "manual"))
        val state = activeState()
        assertEquals(EngineState.Today("2026-11-15", 4321, "2026-11-15T09:29:00Z"), state.today)
        assertEquals(EngineState.LatestHr(73, "2026-11-15T09:28:00Z"), state.latestHr)
        val wire = state.toJson()
        assertEquals("""{"date":"2026-11-15","ringSteps":4321,"ringStepsAt":"2026-11-15T09:29:00Z"}""", wire.getJSONObject("today").toString())
        assertEquals("""{"bpm":73,"at":"2026-11-15T09:28:00Z"}""", wire.getJSONObject("latestHr").toString())

        // once the phone's date has moved on the count is yesterday's; the reading is still the newest one held
        val late = activeState(Instant.parse("2026-11-15T19:00:00Z").toEpochMilli())
        assertNull(late.today)
        assertEquals(state.latestHr, late.latestHr)
    }

    @Test fun `today's steps are the ring's count for the phone's own date, with the time it was written`() = runBlocking {
        assertNull(EngineReadings.today(db, now, zone))
        db.activityDailyDao().upsert(ActivityDailyEntity(date = today - 86_400_000L, steps = 9000, source = "ring", updatedAt = now - 86_400_000L))
        // yesterday's row says nothing about today
        assertNull(EngineReadings.today(db, now, zone))
        db.activityDailyDao().upsert(ActivityDailyEntity(date = today, steps = 4321, source = "ring", updatedAt = now - 60_000))
        assertEquals(EngineState.Today("2026-11-15", 4321, "2026-11-15T09:29:00Z"), EngineReadings.today(db, now, zone))
        // the same row the plugin's local snapshot answers with
        assertEquals(EngineReadings.RingDay(LocalDate.parse("2026-11-15"), 4321, now - 60_000), EngineReadings.ringDay(db, now, zone))
        // late in the evening UTC it is already tomorrow on the phone
        val late = Instant.parse("2026-11-15T19:00:00Z").toEpochMilli()
        assertNull(EngineReadings.today(db, late, zone))
        assertEquals(LocalDate.parse("2026-11-16"), EngineReadings.ringDay(db, late, zone).date)
    }

    @Test fun `a demo day is never a count`() = runBlocking {
        db.activityDailyDao().upsert(ActivityDailyEntity(date = today, steps = 7000, source = "demo"))
        assertNull(EngineReadings.today(db, now, zone))
        assertNull(EngineReadings.ringDay(db, now, zone).steps)
    }

    @Test fun `the day key is the local midnight the writers file a day under`() {
        assertEquals(today, EngineReadings.dayStart(LocalDate.parse("2026-11-15"), zone))
        // a day with a clock change still has one key
        val berlin = ZoneId.of("Europe/Berlin")
        val springForward = LocalDate.parse("2026-03-29")
        assertEquals(
            TimeUtil.startOfDayLocal(springForward.atTime(23, 0).atZone(berlin).toInstant().toEpochMilli(), berlin),
            EngineReadings.dayStart(springForward, berlin),
        )
    }

    @Test fun `the latest heart rate is the newest real reading with its own time`() = runBlocking {
        assertNull(EngineReadings.latestHr(db))
        db.measurementDao().insert(hr("demo", 99.0, now, "demo"))
        assertNull(EngineReadings.latestHr(db))
        db.measurementDao().insert(hr("a", 61.4, now - 600_000))
        db.measurementDao().insert(hr("b", 72.6, now - 120_000, "manual"))
        db.measurementDao().insert(MeasurementEntity("o", "SPO2", 97.0, "%", now, "history"))
        assertEquals(EngineState.LatestHr(73, "2026-11-15T09:28:00Z"), EngineReadings.latestHr(db))
        // a reading of nothing is not a heart rate, and an older one is not passed off as the latest
        db.measurementDao().insert(hr("c", 0.0, now - 30_000))
        assertNull(EngineReadings.latestHr(db))
    }

    @Test fun `a new count or a newer reading is a change, the same one again is not`() = runBlocking {
        val steps = Channel<Unit>(Channel.UNLIMITED)
        val heart = Channel<Unit>(Channel.UNLIMITED)
        val jobs = listOf(
            launch(Dispatchers.IO) { EngineReadings.stepsChanges(db, LocalDate.parse("2026-11-15"), zone).collect { steps.send(it) } },
            launch(Dispatchers.IO) { EngineReadings.heartRateChanges(db).collect { heart.send(it) } },
        )
        suspend fun Channel<Unit>.next() = withTimeout(5000) { receive() }
        suspend fun Channel<Unit>.quiet() = assertNull(withTimeoutOrNull(300) { receive() })
        try {
            // the first read of each
            steps.next(); heart.next()
            val row = ActivityDailyEntity(date = today, steps = 100, source = "ring", updatedAt = now)
            db.activityDailyDao().upsert(row); steps.next()
            db.activityDailyDao().upsert(row.copy(steps = 180, updatedAt = now + 60_000)); steps.next()
            // another day's row and an unchanged one wake nobody
            db.activityDailyDao().upsert(ActivityDailyEntity(date = today - 86_400_000L, steps = 5, source = "ring"))
            db.activityDailyDao().upsert(row.copy(steps = 180, updatedAt = now + 60_000))
            steps.quiet(); heart.quiet()
            db.measurementDao().insert(hr("a", 64.0, now)); heart.next()
            // an older reading and another kind leave the newest as it was
            db.measurementDao().insert(hr("b", 80.0, now - 60_000))
            db.measurementDao().insert(MeasurementEntity("o", "SPO2", 97.0, "%", now + 1, "history"))
            heart.quiet()
            db.measurementDao().insert(hr("c", 66.0, now + 60_000)); heart.next()
            steps.quiet()
        } finally {
            jobs.forEach { it.cancelAndJoin() }
        }
    }

    @Test fun `a stored step count or heart-rate reading has the state built again, for the phone's own date`() = runBlocking {
        val link = MutableStateFlow(RingBLEClient.BLEState())
        val days = MutableStateFlow(LocalDate.parse("2026-11-15"))
        val signals = Channel<Unit>(Channel.UNLIMITED)
        val job = launch(Dispatchers.IO) {
            EngineSignals.active(db, link, hub, MutableStateFlow(ShortVideoPrefs()), MutableStateFlow(SocialPrefs()), { zone }, days).collect { signals.send(it) }
        }
        suspend fun quiet() = assertNull(withTimeoutOrNull(300) { signals.receive() })
        // at least one signal, then whatever came with it
        suspend fun signalled() {
            withTimeout(5000) { signals.receive() }
            while (withTimeoutOrNull(300) { signals.receive() } != null) Unit
        }
        try {
            // every part is read once when the engine starts
            signalled()
            val row = ActivityDailyEntity(date = today, steps = 100, source = "ring", updatedAt = now)
            db.activityDailyDao().upsert(row); signalled()
            db.measurementDao().insert(hr("a", 64.0, now)); signalled()
            // of the link, the battery is shown and its trace is not
            link.value = link.value.copy(batteryPercent = 61); signalled()
            link.value = link.value.copy(diagnostics = listOf("rx 20 bytes")); quiet()
            hub.recordSuccess(accepted = 3, duplicates = 0, rejected = 0, at = now); signalled()
            // past midnight the new date's count is the one followed
            days.value = LocalDate.parse("2026-11-16"); signalled()
            db.activityDailyDao().upsert(row.copy(steps = 250, updatedAt = now + 60_000)); quiet()
            db.activityDailyDao().upsert(ActivityDailyEntity(date = today + 86_400_000L, steps = 12, source = "ring", updatedAt = now + 61_000)); signalled()
        } finally {
            job.cancelAndJoin()
        }
    }
}
