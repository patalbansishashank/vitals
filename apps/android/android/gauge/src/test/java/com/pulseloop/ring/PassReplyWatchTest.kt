package com.pulseloop.ring

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Test

/** (r087, A3) A pass that draws no packet at all means a deaf link; any packet means a live one. */
@OptIn(ExperimentalCoroutinesApi::class)
class PassReplyWatchTest {
    private val scope = TestScope(StandardTestDispatcher())
    private var silent = 0
    private val watch = PassReplyWatch(scope) { silent++ }
    private val window = PassReplyWatch.SILENCE_MS

    @Test fun `a pass nothing answers reports the link once`() = scope.run {
        watch.passRequested()
        advanceTimeBy(window - 1)
        runCurrent()
        assertEquals(0, silent)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, silent)
        advanceUntilIdle()
        assertEquals(1, silent)
    }

    @Test fun `one packet, however late within the window, clears the pass`() = scope.run {
        watch.passRequested()
        advanceTimeBy(window - 1)
        watch.packetReceived()
        advanceUntilIdle()
        assertEquals(0, silent)
    }

    @Test fun `a healthy slow ring is never reported, pass after pass`() = scope.run {
        repeat(20) {
            watch.passRequested()
            // The first packet takes most of the window, then the transfer trickles for minutes.
            advanceTimeBy(window - 500)
            watch.packetReceived()
            repeat(8) { advanceTimeBy(15_000); watch.packetReceived() }
            // Then the ring is quiet until the next pass: silence without a request is not a fault.
            advanceTimeBy(60_000)
        }
        advanceUntilIdle()
        assertEquals(0, silent)
    }

    @Test fun `silence is judged per pass, not from the last packet of an earlier one`() = scope.run {
        watch.passRequested()
        watch.packetReceived()
        advanceTimeBy(10 * window)
        assertEquals(0, silent)
        watch.passRequested()
        advanceTimeBy(window + 1)
        runCurrent()
        assertEquals(1, silent)
    }

    @Test fun `a new pass restarts the wait`() = scope.run {
        watch.passRequested()
        advanceTimeBy(window - 1)
        watch.passRequested()
        advanceTimeBy(window - 1)
        runCurrent()
        assertEquals(0, silent)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, silent)
    }

    @Test fun `a link that ended owes no answer`() = scope.run {
        watch.passRequested()
        advanceTimeBy(window / 2)
        watch.linkEnded()
        advanceUntilIdle()
        assertEquals(0, silent)
    }

    @Test fun `packets with no pass waiting are ignored`() = scope.run {
        watch.packetReceived()
        watch.linkEnded()
        advanceUntilIdle()
        assertEquals(0, silent)
    }
}
