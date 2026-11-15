package com.pulseloop.engine

import com.pulseloop.engine.EngineSignals.paced
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * (r087) When the plugin builds the engine's state again: on the engine's own changes and, while it runs the ring, on
 * what the ring brings; the date as it changes; and signals let through at a pace.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EngineStateSignalsTest {
    @Test fun `an engine change is always a signal, what the ring brings only while the engine runs it`() = runTest {
        val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
        val readings = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
        var mode = EngineMode.PASSIVE
        val seen = mutableListOf<String>()
        val job = launch {
            EngineSignals.forState(changes, onChange = { seen += "change" }, isActive = { mode == EngineMode.ACTIVE }) { readings }
                .collect { seen += "build" }
        }
        fun happened(): List<String> = seen.toList().also { seen.clear() }
        runCurrent()
        // not running the ring: nothing to build for, and nothing the ring brings is listened to
        readings.tryEmit(Unit)
        runCurrent()
        assertEquals(emptyList<String>(), happened())
        // a permission answer: what was kept from before it is dropped, then the state is built
        changes.tryEmit(Unit)
        runCurrent()
        assertEquals(listOf("change", "build"), happened())
        // the take over: from here a new reading is a signal of its own
        mode = EngineMode.ACTIVE
        changes.tryEmit(Unit)
        runCurrent()
        assertEquals(listOf("change", "build"), happened())
        readings.tryEmit(Unit)
        runCurrent()
        assertEquals(listOf("build"), happened())
        // the old ring app is back: the engine stands down and its readings are no longer followed
        mode = EngineMode.PASSIVE
        changes.tryEmit(Unit)
        runCurrent()
        assertEquals(listOf("change", "build"), happened())
        readings.tryEmit(Unit)
        runCurrent()
        assertEquals(emptyList<String>(), happened())
        job.cancel()
    }

    @Test fun `an engine already running the ring is followed from the start, with no change to wait for`() = runTest {
        val readings = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
        var changed = 0
        var built = 0
        val job = launch {
            EngineSignals.forState(MutableSharedFlow(), onChange = { changed++ }, isActive = { true }) { readings }.collect { built++ }
        }
        runCurrent()
        readings.tryEmit(Unit)
        runCurrent()
        assertEquals(1, built)
        assertEquals(0, changed)
        job.cancel()
    }

    @Test fun `the date is followed over midnight`() = runTest {
        val start = Instant.parse("2026-11-15T18:29:30Z").toEpochMilli() // 23:59:30 in Kolkata
        val seen = mutableListOf<LocalDate>()
        val job = launch { EngineSignals.localDays(now = { start + testScheduler.currentTime }, zone = { ZoneId.of("Asia/Kolkata") }).collect { seen += it } }
        runCurrent()
        assertEquals(listOf(LocalDate.parse("2026-11-15")), seen)
        advanceTimeBy(29_000)
        assertEquals(1, seen.size)
        advanceTimeBy(2_000)
        assertEquals(listOf(LocalDate.parse("2026-11-15"), LocalDate.parse("2026-11-16")), seen)
        // a whole further day, one date
        advanceTimeBy(24 * 3_600_000L)
        assertEquals(LocalDate.parse("2026-11-17"), seen.last())
        assertEquals(3, seen.size)
        job.cancel()
    }

    @Test fun `a changed time zone is noticed without waiting for the old midnight`() = runTest {
        val start = Instant.parse("2026-11-15T20:00:00Z").toEpochMilli()
        var zone = ZoneId.of("UTC")
        val seen = mutableListOf<LocalDate>()
        val job = launch { EngineSignals.localDays(now = { start + testScheduler.currentTime }, zone = { zone }).collect { seen += it } }
        runCurrent()
        zone = ZoneId.of("Asia/Kolkata") // already the 16th there
        advanceTimeBy(EngineSignals.DAY_RECHECK_MS + 1)
        assertEquals(listOf(LocalDate.parse("2026-11-15"), LocalDate.parse("2026-11-16")), seen)
        job.cancel()
    }

    @Test fun `the first signal goes through at once, a burst is one more, and the last is never lost`() = runTest {
        val signals = MutableSharedFlow<Unit>(extraBufferCapacity = 64)
        val at = mutableListOf<Long>()
        val job = launch { signals.paced(1_000).collect { at += testScheduler.currentTime } }
        runCurrent()
        signals.tryEmit(Unit)
        runCurrent()
        assertEquals(listOf(0L), at)
        // a history pass: a row every 140 ms for nearly three seconds never leaves a quiet gap
        repeat(20) { advanceTimeBy(140); signals.tryEmit(Unit) }
        runCurrent()
        assertEquals(listOf(0L, 1_000L, 2_000L), at)
        // the rows after the last build are not lost, and with nothing more arriving nothing more is built
        advanceTimeBy(10_000)
        assertEquals(listOf(0L, 1_000L, 2_000L, 3_000L), at)
        // one late signal after the quiet goes through at once again
        signals.tryEmit(Unit)
        runCurrent()
        assertEquals(12_800L, at.last())
        assertEquals(5, at.size)
        job.cancel()
    }
}
