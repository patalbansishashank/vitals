package com.pulseloop.service

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LocalInsightThrottleTest {
    @Test fun `failed computation retains the same changed inputs for trailing retry`() = runTest {
        var runs = 0
        val inputs = mutableListOf<Set<String>>()
        val throttle = LocalInsightThrottle(backgroundScope, { testScheduler.currentTime }) {
            inputs += it
            runs++
            if (runs == 1) error("transient computation failure")
        }
        throttle.request(true, setOf("HR")); runCurrent()
        advanceTimeBy(60_001)
        runCurrent()
        assertEquals(2, runs)
        assertEquals(listOf(setOf("HR"), setOf("HR")), inputs)
        // The failed done marker travelled with the retained inputs, so the successful retry is
        // now the five-minute suppression authority.
        advanceTimeBy(299_000)
        throttle.request(false, setOf("TEMP")); runCurrent()
        assertEquals(2, runs)
        throttle.stop()
    }
    @Test fun `five done signals coalesce with trailing work and recent done suppresses disconnect`() = runTest {
        val runs = mutableListOf<Set<String>>()
        val throttle = LocalInsightThrottle(backgroundScope, { testScheduler.currentTime }) { runs += it }
        repeat(5) {
            throttle.request(true, setOf("HR")); runCurrent(); advanceTimeBy(2000)
        }
        assertEquals(1, runs.size)
        advanceTimeBy(50_001); runCurrent()
        assertEquals(2, runs.size)
        throttle.request(false, setOf("HRV")); runCurrent()
        advanceTimeBy(60_000); runCurrent()
        assertEquals(2, runs.size)
        throttle.request(true, emptySet()); runCurrent()
        assertEquals(2, runs.size)
        throttle.stop()
    }

    @Test fun `disconnect suppression is measured from trailing done run not queued request`() = runTest {
        val runs = mutableListOf<Pair<Long, Set<String>>>()
        val throttle = LocalInsightThrottle(backgroundScope, { testScheduler.currentTime }) {
            runs += testScheduler.currentTime to it
        }
        throttle.request(true, setOf("HR")); runCurrent() // leading done run at t=0
        advanceTimeBy(10_000)
        throttle.request(true, setOf("HRV")); runCurrent() // queued at t=10s
        advanceTimeBy(50_000); runCurrent() // trailing done run at t=60s
        assertEquals(listOf(0L, 60_000L), runs.map { it.first })

        advanceTimeBy(255_000) // t=315s: >5m from request, only 4m15s from the run
        throttle.request(false, setOf("TEMP")); runCurrent()
        advanceTimeBy(60_000); runCurrent()
        assertEquals(2, runs.size)

        // Once five minutes have elapsed from the real run, the fallback becomes eligible.
        advanceTimeBy(46_000)
        throttle.request(false, setOf("TEMP")); runCurrent()
        assertEquals(3, runs.size)
        assertEquals(setOf("TEMP"), runs.last().second)
        throttle.stop()
    }
}
