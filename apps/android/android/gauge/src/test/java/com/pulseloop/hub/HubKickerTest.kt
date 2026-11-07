package com.pulseloop.hub

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Test

/** (2.8.7, r069 sync) The in-process upload: debounced, a flush moves it earlier, a request during a drain is kept. */
@OptIn(ExperimentalCoroutinesApi::class)
class HubKickerTest {
    private val scope = TestScope(StandardTestDispatcher())
    private val results = mutableListOf<HubDrainResult>()
    private var drains = 0
    private var next: () -> HubDrainResult = { HubDrainResult.Success(1) }
    private var during: (() -> Unit)? = null
    private val kicker = HubKicker(scope, { scope.testScheduler.currentTime }, {
        drains++
        during?.invoke()
        next()
    }, { results += it })

    @Test fun `a burst of requests is one drain after the debounce`() = scope.run {
        kicker.request(15_000)
        advanceTimeBy(5_000)
        kicker.request(15_000)
        kicker.request(15_000)
        advanceTimeBy(9_999)
        runCurrent()
        assertEquals(0, drains)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, drains)
        advanceUntilIdle()
        assertEquals(1, drains)
    }

    @Test fun `a flush moves the waiting drain to now`() = scope.run {
        kicker.request(15_000)
        kicker.request(0)
        runCurrent()
        assertEquals(1, drains)
        advanceUntilIdle()
        assertEquals(1, drains)
    }

    @Test fun `a request while a drain runs gets one more drain`() = scope.run {
        during = { during = null; kicker.request(15_000) }
        kicker.request(0)
        advanceUntilIdle()
        assertEquals(2, drains)
    }

    @Test fun `a drain that stopped with more left is followed, and its outcome is reported`() = scope.run {
        var n = 0
        next = { if (n++ == 0) HubDrainResult.Success(500, hasMore = true) else HubDrainResult.Empty }
        kicker.request(0)
        advanceUntilIdle()
        assertEquals(2, drains)
        assertEquals(listOf(HubDrainResult.Success(500, hasMore = true), HubDrainResult.Empty), results)
    }

    @Test fun `a drain that throws is reported as a retry`() = scope.run {
        next = { throw IllegalStateException("boom") }
        kicker.request(0)
        advanceUntilIdle()
        assertEquals(listOf<HubDrainResult>(HubDrainResult.Retry("boom")), results)
    }

    @Test fun `retries wait 30 s doubling to 5 minutes, never hours`() {
        assertEquals(30_000L, HubRetryPolicy.delayMs(0))
        assertEquals(30_000L, HubRetryPolicy.delayMs(1))
        assertEquals(60_000L, HubRetryPolicy.delayMs(2))
        assertEquals(120_000L, HubRetryPolicy.delayMs(3))
        assertEquals(240_000L, HubRetryPolicy.delayMs(4))
        assertEquals(300_000L, HubRetryPolicy.delayMs(5))
        assertEquals(300_000L, HubRetryPolicy.delayMs(500))
    }
}
