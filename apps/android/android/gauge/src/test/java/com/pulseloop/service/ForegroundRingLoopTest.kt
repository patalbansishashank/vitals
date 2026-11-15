package com.pulseloop.service

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

/** (r087, A1 and A8) Coming to the front reads the ring at once, and a dropped link is not left to the long backoff. */
@OptIn(ExperimentalCoroutinesApi::class)
class ForegroundRingLoopTest {
    private val scope = TestScope(StandardTestDispatcher())
    private var wanted = true
    private var mayUseRing = true
    private var connected = true
    private var connecting = false
    private var passAllowed = true
    private var passEndsAt = Long.MIN_VALUE
    private var passMs = 0L
    private val passes = mutableListOf<Long>()
    private val reconnects = mutableListOf<Long>()
    private val now get() = scope.testScheduler.currentTime

    private val loop = ForegroundRingLoop(
        wanted = { wanted },
        mayUseRing = { mayUseRing },
        connected = { connected },
        connecting = { connecting },
        reconnect = { reconnects += now },
        startPass = {
            if (passAllowed) { passes += now; passEndsAt = now + passMs }
            passAllowed
        },
        passRunning = { now < passEndsAt },
    )
    private val refresh = ForegroundRingLoop.REFRESH_MS
    private val redial = ForegroundRingLoop.RECONNECT_MS

    private fun start() = scope.launch { loop.run() }

    @Test fun `the first pass starts at once, the next a full wait after the last one ended`() = scope.run {
        passMs = 30_000
        val job = start()
        runCurrent()
        assertEquals(listOf(0L), passes)
        advanceTimeBy(30_000 + refresh - 1)
        runCurrent()
        assertEquals(1, passes.size)
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(2, passes.size)
        assertTrue("counted from the end of the pass", passes[1] >= 30_000 + refresh)
        job.cancel()
    }

    @Test fun `a pass that may not run now is asked for again after the usual wait`() = scope.run {
        passAllowed = false
        val job = start()
        runCurrent()
        advanceTimeBy(refresh - 1)
        runCurrent()
        assertTrue(passes.isEmpty())
        passAllowed = true
        advanceTimeBy(2)
        runCurrent()
        assertEquals(listOf(refresh), passes)
        job.cancel()
    }

    @Test fun `a pass that never ends does not hold up the cadence for ever`() = scope.run {
        passMs = Long.MAX_VALUE / 4
        val job = start()
        runCurrent()
        advanceTimeBy(ForegroundRingLoop.PASS_TIMEOUT_MS + refresh + 1_000)
        runCurrent()
        assertEquals(2, passes.size)
        job.cancel()
    }

    @Test fun `while the link is down the saved ring is dialled again after a short wait`() = scope.run {
        connected = false
        val job = start()
        runCurrent()
        assertTrue("the caller dials on entry; the loop waits first", reconnects.isEmpty())
        advanceTimeBy(redial + 1)
        runCurrent()
        assertEquals(1, reconnects.size)
        advanceTimeBy(redial * 4)
        runCurrent()
        assertEquals(5, reconnects.size)
        assertTrue(passes.isEmpty())
        job.cancel()
    }

    @Test fun `an attempt already under way is left alone`() = scope.run {
        connected = false
        connecting = true
        val job = start()
        advanceTimeBy(redial * 3 + 1)
        runCurrent()
        assertTrue(reconnects.isEmpty())
        connecting = false
        advanceTimeBy(redial)
        runCurrent()
        assertEquals(1, reconnects.size)
        job.cancel()
    }

    @Test fun `a new connection reads the ring by itself, so the loop waits before its own pass`() = scope.run {
        connected = false
        val job = start()
        advanceTimeBy(10_000)
        connected = true
        advanceTimeBy(redial)
        runCurrent()
        assertTrue(passes.isEmpty())
        assertTrue(reconnects.isEmpty())
        advanceTimeBy(refresh)
        runCurrent()
        assertEquals(1, passes.size)
        job.cancel()
    }

    @Test fun `after Disconnect or without permission nothing is dialled or read`() = scope.run {
        mayUseRing = false
        connected = false
        val job = start()
        advanceTimeBy(10 * refresh)
        runCurrent()
        assertTrue(reconnects.isEmpty())
        connected = true
        advanceTimeBy(10 * refresh)
        runCurrent()
        assertTrue(passes.isEmpty())
        job.cancel()
    }

    @Test fun `Disconnect during the wait cancels the dial`() = scope.run {
        connected = false
        val job = start()
        advanceTimeBy(redial - 1)
        mayUseRing = false
        advanceTimeBy(2)
        runCurrent()
        assertTrue(reconnects.isEmpty())
        job.cancel()
    }

    @Test fun `the loop ends when the app leaves the front or the engine turns off`() = scope.run {
        val job = start()
        runCurrent()
        assertEquals(1, passes.size)
        wanted = false
        advanceTimeBy(refresh + 1)
        runCurrent()
        assertTrue(job.isCompleted)
        assertEquals(1, passes.size)
        assertFalse(job.isCancelled)
    }
}
