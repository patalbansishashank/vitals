package com.pulseloop.ring

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (r087, A3) A ring that never answers the firmware or authentication request used to leave the pass "running" until
 * the link dropped: every later pass and Sync was refused as busy, and only a new process cleared it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class JStyleHandshakeDeadlineTest {
    private val scope = TestScope(StandardTestDispatcher())
    private val sent = mutableListOf<ByteArray>()
    private val writer = RingCommandWriter { sent += it.copyOf() }
    private val builtIn = { "TEST1234".toByteArray(Charsets.US_ASCII) }
    private val deadline = JStyle2301SyncEngine.HANDSHAKE_TIMEOUT_MS

    private fun engine(
        secret: String? = null,
        history: JStyle2301HistorySync = JStyle2301HistorySync(writer, scope = scope, progressSink = {}),
        mayReadSleep: () -> Boolean = { true },
        mayReadSleepUnattended: () -> Boolean = { true },
    ) = JStyle2301SyncEngine(
        writer, history, secret, scope = scope,
        mayReadSleep = mayReadSleep, mayReadSleepUnattended = mayReadSleepUnattended, firmwarePasscode = builtIn,
    )

    private fun opcode(frame: ByteArray) = frame[0].toInt() and 0xFF
    private fun count(opcode: Int) = sent.count { opcode(it) == opcode }
    private fun firmwareQueries() = sent.count { it.contentEquals(JStyle2301Protocol.infoRequest(JStyle2301Protocol.INFO_FIRMWARE)) }
    private fun authentications() = sent.filter { opcode(it) == JStyle2301Protocol.AUTHENTICATE }
    private val firstStream = JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode

    @Test fun `an unanswered firmware request stops counting as a running pass, and the next pass asks again`() = scope.run {
        val engine = engine()
        engine.runStartup()
        assertTrue(engine.isHistorySyncRunning)
        assertEquals(1, firmwareQueries())

        advanceTimeBy(deadline - 1)
        runCurrent()
        assertTrue("still inside the deadline", engine.isHistorySyncRunning)
        advanceTimeBy(2)
        runCurrent()
        assertFalse(engine.isHistorySyncRunning)

        assertTrue(engine.refreshForeground())
        assertEquals(2, firmwareQueries())
        assertTrue(engine.isHistorySyncRunning)
        // This time the ring answers, and the pass runs.
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertEquals(1, count(firstStream))
    }

    @Test fun `a ring that goes on not answering is asked once per pass and never blocks the next`() = scope.run {
        val engine = engine()
        engine.runStartup()
        repeat(5) { pass ->
            advanceTimeBy(deadline + 1)
            runCurrent()
            assertFalse("pass $pass", engine.isHistorySyncRunning)
            assertTrue("pass $pass", engine.refreshForeground())
        }
        assertEquals(6, firmwareQueries())
    }

    @Test fun `an answer inside the deadline is never followed by a lapse`() = scope.run {
        val history = JStyle2301HistorySync(writer, settleMs = 600_000, stallMs = 600_000, scope = scope, progressSink = {})
        val engine = engine(history = history)
        engine.runStartup()
        advanceTimeBy(deadline - 1)
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertTrue(history.isRunning)
        advanceTimeBy(deadline * 3)
        runCurrent()
        // The pass the answer started is still the one running: nothing was cleared, nothing can start over it.
        assertTrue(history.isRunning)
        assertTrue(engine.isHistorySyncRunning)
        assertFalse(engine.refreshForeground())
        assertEquals(1, firmwareQueries())
    }

    @Test fun `a slow ring that answers each step late but in time is authenticated and read`() = scope.run {
        val engine = engine()
        engine.runStartup()
        advanceTimeBy(deadline - 1)
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(1, authentications().size)
        // The authentication answer has a deadline of its own, counted from its request.
        advanceTimeBy(deadline - 1)
        runCurrent()
        assertTrue(engine.isHistorySyncRunning)
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals(1, count(firstStream))
        assertEquals(1, authentications().size)
        assertFalse(engine.credentialAuthenticationFailed)
    }

    @Test fun `an unanswered authentication is asked again with the same passcode, not reported as refused`() = scope.run {
        val engine = engine()
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(1, authentications().size)
        assertTrue(engine.isHistorySyncRunning)

        advanceTimeBy(deadline + 1)
        runCurrent()
        assertFalse(engine.isHistorySyncRunning)
        assertFalse(engine.credentialAuthenticationFailed)
        // The pass that waited is over: nothing is read on its behalf.
        assertEquals(0, count(firstStream))

        // The next automatic pass may run although the ring is not authenticated yet: it is how the ring is asked.
        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        val attempts = authentications()
        assertEquals(2, attempts.size)
        assertArrayEquals(attempts[0], attempts[1])
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals(1, count(firstStream))
        assertFalse(engine.credentialAuthenticationFailed)
    }

    @Test fun `after a refused stored passcode, an unanswered built-in attempt is repeated alone`() = scope.run {
        val engine = engine(secret = "OLD12345")
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertEquals(2, authentications().size)
        advanceTimeBy(deadline + 1)
        runCurrent()
        assertFalse(engine.credentialAuthenticationFailed)

        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        val attempts = authentications()
        assertEquals(3, attempts.size)
        // The refused stored passcode is not sent again; the built-in one is.
        assertArrayEquals(attempts[1], attempts[2])
        assertFalse(attempts[0].contentEquals(attempts[2]))
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertTrue(engine.credentialAuthenticationFailed)
    }

    @Test fun `a final refusal stays final, deadline or not`() = scope.run {
        val engine = engine()
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertTrue(engine.credentialAuthenticationFailed)
        val before = sent.size
        advanceTimeBy(deadline * 4)
        runCurrent()
        assertTrue(engine.credentialAuthenticationFailed)
        assertFalse(engine.refreshForeground())
        assertEquals(before, sent.size)
    }

    @Test fun `a yes that arrives after the deadline still opens the ring, and starts what waited for it`() = scope.run {
        val engine = engine()
        // A workout start on a ring that has not been authenticated yet.
        engine.startWorkoutHeartRate("run")
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(1, authentications().size)
        assertEquals(0, count(JStyle2301Protocol.SPORT_MODE))

        advanceTimeBy(deadline + 1_000)
        runCurrent()
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals("the ring's heart-rate stream starts", 1, count(JStyle2301Protocol.SPORT_MODE))
        assertFalse(engine.credentialAuthenticationFailed)

        // The next pass reads at once: no second firmware query, no second passcode.
        val queries = firmwareQueries()
        assertTrue(engine.refreshForeground())
        assertEquals(1, count(firstStream))
        assertEquals(queries, firmwareQueries())
        assertEquals(1, authentications().size)
    }

    @Test fun `a late yes starts the pass that is already asking again, once`() = scope.run {
        val history = JStyle2301HistorySync(writer, settleMs = 600_000, stallMs = 600_000, scope = scope, progressSink = {})
        val engine = engine(history = history)
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        advanceTimeBy(deadline + 1)
        runCurrent()
        assertTrue(engine.refreshForeground())

        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals(1, count(firstStream))
        // The firmware answer that pass was waiting for changes nothing now, and its deadline is gone.
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        advanceTimeBy(deadline * 2)
        runCurrent()
        assertEquals(1, count(firstStream))
        assertEquals(1, authentications().size)
        assertTrue(history.isRunning)
    }

    @Test fun `a no that arrives after the deadline settles nothing`() = scope.run {
        val engine = engine()
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        advanceTimeBy(deadline + 1_000)
        runCurrent()
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertFalse(engine.credentialAuthenticationFailed)
        assertEquals("no second passcode is tried on the strength of it", 1, authentications().size)

        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        val attempts = authentications()
        assertEquals(2, attempts.size)
        assertArrayEquals(attempts[0], attempts[1])
    }

    @Test fun `an answer at the very moment of the deadline wins`() = scope.run {
        val history = JStyle2301HistorySync(writer, settleMs = 600_000, stallMs = 600_000, scope = scope, progressSink = {})
        val engine = engine(history = history)
        engine.runStartup()
        // The deadline is due but has not run yet.
        advanceTimeBy(deadline)
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        runCurrent()
        assertTrue(history.isRunning)
        assertEquals(1, count(firstStream))
        assertFalse("the pass was not also reported unanswered", engine.refreshForeground())
    }

    /** Whether the pass read past the first page of a stream, which only the archive plan does. */
    private fun readsDeep(history: JStyle2301HistorySync): Boolean {
        // ACTIVITY_TOTAL is the undrained stream the archive plan queues last; the others end at once.
        for (stream in JStyle2301HistorySync.catalog - JStyle2301HistoryStream.ACTIVITY_TOTAL) {
            history.notePacket(byteArrayOf(stream.opcode.toByte(), 0xFF.toByte()))
        }
        repeat(50) { history.notePacket(byteArrayOf(firstStream.toByte(), 0)) }
        return sent.any { opcode(it) == firstStream && it.getOrNull(1)?.toInt() == 2 }
    }

    @Test fun `the one-time recovery pass the ring never answered is run by the next routine pass`() = scope.run {
        val history = JStyle2301HistorySync(writer, scope = scope, progressSink = {},
            cursorStore = InMemoryJStyle2301HistoryCursorStore())
        val engine = engine(history = history)
        engine.refreshUnattendedBackfill()
        advanceTimeBy(deadline + 1)
        runCurrent()
        assertFalse(engine.isHistorySyncRunning)

        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertTrue(readsDeep(history))
        assertTrue(history.isRunning)
    }

    @Test fun `a Sync the ring never answered is not run later by a routine pass`() = scope.run {
        val history = JStyle2301HistorySync(writer, scope = scope, progressSink = {},
            cursorStore = InMemoryJStyle2301HistoryCursorStore())
        val engine = engine(history = history)
        engine.refresh()
        advanceTimeBy(deadline + 1)
        runCurrent()
        assertFalse(engine.isHistorySyncRunning)

        // The routine pass may run with nobody watching, so it stays shallow.
        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertFalse(readsDeep(history))
    }

    @Test fun `a Sync replaces a recovery pass that was waiting to be run`() = scope.run {
        val history = JStyle2301HistorySync(writer, scope = scope, progressSink = {},
            cursorStore = InMemoryJStyle2301HistoryCursorStore())
        val engine = engine(history = history)
        engine.refreshUnattendedBackfill()
        advanceTimeBy(deadline + 1)
        runCurrent()
        // A Sync reads the whole archive itself, so the recovery is no longer owed, even when the Sync goes
        // unanswered as well.
        engine.refresh()
        advanceTimeBy(deadline + 1)
        runCurrent()

        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertFalse(readsDeep(history))
    }

    @Test fun `a carried recovery pass leaves sleep alone when the pass that runs it must`() = scope.run {
        var asleep = false
        val engine = engine(mayReadSleepUnattended = { !asleep })
        engine.refreshUnattendedBackfill()
        advanceTimeBy(deadline + 1)
        runCurrent()
        asleep = true
        assertTrue(engine.refreshForeground())
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        // Every stream stalls in turn (nothing answers), so the whole plan is requested.
        advanceTimeBy(60_000)
        runCurrent()
        assertTrue(count(JStyle2301HistoryStream.HEART_RATE.opcode) > 0)
        assertEquals(0, count(JStyle2301HistoryStream.SLEEP.opcode))
    }

    @Test fun `the sleep read does not replace a pass still waiting for the handshake`() = scope.run {
        val engine = engine()
        engine.runStartup()
        engine.querySleep()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertEquals("the whole pass started, not sleep alone", 1, count(firstStream))
    }

    @Test fun `a link that ends takes its deadline with it`() = scope.run {
        val engine = engine()
        engine.runStartup()
        engine.connectionDidEnd()
        advanceTimeBy(deadline * 2)
        runCurrent()
        // Nothing lapsed: the wait would have been cleared (the client builds a new engine for the next link).
        assertTrue(engine.isHistorySyncRunning)
    }

    @Test fun `only this family promises an answer to every pass`() {
        assertTrue(engine().answersEveryPass)
        assertFalse(object : RingSyncEngine {
            override fun runStartup() {}
            override fun handle(event: RingDecodedEvent) {}
            override fun startHeartRate() {}
            override fun stopHeartRate() {}
            override fun startSpO2() {}
            override fun stopSpO2() {}
            override fun findDevice() {}
            override fun setGoal(steps: Int) {}
            override fun powerOff() {}
            override fun factoryReset() {}
        }.answersEveryPass)
    }
}
