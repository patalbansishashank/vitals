package com.pulseloop.service

import com.pulseloop.command.WakeHold
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (r087, A5) The link the service holds is read every few minutes, awake only for the pass. The minutes are real ones:
 * [asleepMs] is time that passed while the phone slept, which the loop's clock counts and a coroutine delay does not.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackgroundRingLoopTest {
    private val scope = TestScope(StandardTestDispatcher())
    private var mayRun = true
    private var passAllowed = true
    private var passMs = 20_000L
    private var passEndsAt = Long.MIN_VALUE
    private val passes = mutableListOf<Long>()
    private var holds = 0
    private var held = 0
    private var longestHold = 0L
    private val now get() = scope.testScheduler.currentTime
    private var asleepMs = 0L
    private val wakeRequests = mutableListOf<Long>()

    private val wake = WakeHold { timeoutMs ->
        holds++; held++
        longestHold = maxOf(longestHold, timeoutMs)
        WakeHold.Held { held-- }
    }
    private val loop = BackgroundRingLoop(
        mayRun = { mayRun },
        startPass = {
            if (passAllowed) { passes += now; passEndsAt = now + passMs }
            passAllowed
        },
        passRunning = { now < passEndsAt },
        wake = wake,
        clock = { now + asleepMs },
        wakeAt = { wakeRequests += it },
    )
    private val every = BackgroundRingLoop.INTERVAL_MS

    private fun start() = scope.launch { loop.run() }

    @Test fun `a pass runs every interval, with the phone held awake only around it`() = scope.run {
        val job = start()
        advanceTimeBy(every - 1)
        runCurrent()
        assertTrue(passes.isEmpty())
        assertEquals(0, holds)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, passes.size)
        assertEquals(1, held)
        advanceTimeBy(passMs + BackgroundRingLoop.SETTLE_MS + 1_000)
        runCurrent()
        assertEquals("released once the pass has settled", 0, held)
        advanceTimeBy(every)
        runCurrent()
        assertEquals(2, passes.size)
        assertEquals(2, holds)
        assertTrue("a short hold", longestHold <= 90_000)
        job.cancel()
    }

    @Test fun `time the phone spent asleep counts, so a due pass needs only a moment awake`() = scope.run {
        val job = start()
        // A minute awake, then the phone sleeps through the rest of the wait and three minutes more.
        advanceTimeBy(60_001)
        asleepMs = every + 3 * 60_000
        advanceTimeBy(BackgroundRingLoop.SLICE_MS - 2)
        runCurrent()
        assertTrue("not before the loop next looks at the clock", passes.isEmpty())
        advanceTimeBy(2)
        runCurrent()
        assertEquals("was: only after five minutes of awake time", 1, passes.size)
        assertTrue(passes.single() < 2 * 60_000)
        job.cancel()
    }

    @Test fun `it asks to be woken when the pass is due, and a wake starts the pass at once`() = scope.run {
        val job = start()
        runCurrent()
        assertEquals(listOf(every), wakeRequests)
        // The phone sleeps until the alarm.
        asleepMs = every
        loop.nudge()
        runCurrent()
        assertEquals(listOf(0L), passes)
        assertEquals(1, held)

        // The next wait is counted from the end of that pass, on the same clock.
        advanceTimeBy(passMs + BackgroundRingLoop.SETTLE_MS)
        runCurrent()
        assertEquals(0, held)
        assertEquals(listOf(every, every + now + every), wakeRequests)
        job.cancel()
    }

    @Test fun `a wake before the pass is due starts nothing`() = scope.run {
        val job = start()
        advanceTimeBy(60_000)
        // The screen came on.
        loop.nudge()
        runCurrent()
        assertTrue(passes.isEmpty())
        assertEquals(0, holds)
        advanceTimeBy(every - 60_000)
        runCurrent()
        assertEquals("the wait was not started over", listOf(every), passes)
        job.cancel()
    }

    @Test fun `a wake that finds the guards closed starts nothing and waits a full interval again`() = scope.run {
        mayRun = false
        val job = start()
        runCurrent()
        asleepMs = every
        loop.nudge()
        runCurrent()
        assertTrue(passes.isEmpty())
        assertEquals(0, holds)
        mayRun = true
        advanceTimeBy(every - 1)
        runCurrent()
        assertTrue(passes.isEmpty())
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, passes.size)
        job.cancel()
    }

    @Test fun `nothing is read or held while the guards say no`() = scope.run {
        mayRun = false
        val job = start()
        advanceTimeBy(10 * every)
        runCurrent()
        assertTrue(passes.isEmpty())
        assertEquals(0, holds)
        job.cancel()
    }

    @Test fun `a refused pass lets go of the phone at once`() = scope.run {
        passAllowed = false
        val job = start()
        advanceTimeBy(every + 1)
        runCurrent()
        assertEquals(1, holds)
        assertEquals(0, held)
        job.cancel()
    }

    @Test fun `a pass that never ends is given up, and the hold with it`() = scope.run {
        passMs = Long.MAX_VALUE / 4
        val job = start()
        advanceTimeBy(every + BackgroundRingLoop.PASS_TIMEOUT_MS + BackgroundRingLoop.SETTLE_MS + 1_000)
        runCurrent()
        assertEquals(0, held)
        job.cancel()
    }

    @Test fun `stopping the service mid-pass releases the hold`() = scope.run {
        val job = start()
        advanceTimeBy(every + 1_000)
        runCurrent()
        assertEquals(1, held)
        job.cancel()
        runCurrent()
        assertEquals(0, held)
    }

    @Test fun `a phone that is low and unplugged skips background work`() {
        assertTrue(PhoneBattery.isLow(level = 15, scale = 100, plugged = 0))
        assertTrue(PhoneBattery.isLow(level = 3, scale = 20, plugged = 0))
        assertFalse(PhoneBattery.isLow(level = 16, scale = 100, plugged = 0))
        assertFalse("charging", PhoneBattery.isLow(level = 5, scale = 100, plugged = 2))
        assertFalse("a broken scale never divides by zero", PhoneBattery.isLow(level = 50, scale = 0, plugged = 0))
    }
}
