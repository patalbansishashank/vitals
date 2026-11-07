package com.pulseloop.command

import com.pulseloop.hub.FakeHubSettings
import com.pulseloop.hub.HubPairing
import com.pulseloop.ui.tile.WorkoutControl.Session
import java.io.File
import java.nio.file.Files
import kotlin.random.Random
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The poll loop: lanes, server-clock expiry, the ledger, backoff, 401, a person change, unpair (energy SPEC §A.4 item 8). */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandLoopTest {
    private val serverT0 = 1_793_000_000_000L
    private val dir: File = Files.createTempDirectory("loop").toFile()

    private inner class Rig(scope: TestScope, phoneSkewMs: Long = 0) {
        val phone: () -> Long = { serverT0 + phoneSkewMs + scope.testScheduler.currentTime }
        val server: () -> Long = { serverT0 + scope.testScheduler.currentTime }
        val settings = FakeHubSettings("https://hub.example")
        val api = FakeCommandApi(server)
        val workout = FakeWorkout()
        val reels = FakeReels()
        val hr = FakeHeartRate()
        val sync = FakeRingSync()
        val wake = FakeWake()
        val ledger = CommandLedger(File(dir, "ledger-${System.nanoTime()}.json"), phone)
        var applied = 0
        val loop = CommandLoop(settings, api, CommandExecutor(workout, reels, hr, FakeUpdates(), ringSync = sync), ledger, phone, Random(7), onApplied = { applied++ }, wake = wake)
        val pairing: HubPairing get() = settings.pairing.value!!
        fun acksOf(id: String) = api.acks.filter { it.first == id }.map { it.second }
    }

    @Test fun `a 32 s measurement does not delay a stop`() = runTest {
        val r = Rig(this)
        r.workout.current = Session("w-1", "walk", "recording", serverT0)
        r.api.ok(r.server(), command("hr-0000000000000001", "hr.measure", r.server(), 60_000, seq = 1), command("stop-000000000000001", "workout.stop", r.server(), 1_800_000, seq = 2))
        backgroundScope.launch { r.loop.run(r.pairing) }
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf("running"), r.acksOf("hr-0000000000000001").map { it.status })
        assertEquals(listOf("done"), r.acksOf("stop-000000000000001").map { it.status })
        advanceTimeBy(32_000)
        runCurrent()
        assertEquals(listOf("running", "done"), r.acksOf("hr-0000000000000001").map { it.status })
        assertEquals(2, r.applied)
    }

    @Test fun `expiry follows the server clock, not the phone's`() = runTest {
        // the phone runs 10 min fast: by its own clock the start is long expired, by the server's it is fresh
        val fast = Rig(this, phoneSkewMs = 10 * 60_000)
        fast.api.ok(fast.server(), command("start-00000000000001", "workout.start", fast.server(), 60_000, 1, "type" to "walk"))
        backgroundScope.launch { fast.loop.run(fast.pairing) }
        advanceTimeBy(100)
        runCurrent()
        assertEquals("done", fast.acksOf("start-00000000000001").single().status)

        // the phone runs 10 min slow: a start the server issued 61 s ago must not start
        val slow = Rig(this, phoneSkewMs = -10 * 60_000)
        slow.api.ok(slow.server(), command("start-00000000000002", "workout.start", slow.server() - 61_000, 60_000, 1, "type" to "walk"))
        backgroundScope.launch { slow.loop.run(slow.pairing) }
        advanceTimeBy(100)
        runCurrent()
        assertEquals(CommandAck.expired, slow.acksOf("start-00000000000002").single())
        assertTrue(slow.workout.calls.isEmpty())
    }

    @Test fun `a re-delivered id runs once and re-sends its ack`() = runTest {
        val r = Rig(this)
        val c = command("reels-0000000000001", "reels.set", r.server(), 86_400_000, 1, "dailyLimit" to 20)
        r.api.ok(r.server(), c)
        backgroundScope.launch { r.loop.run(r.pairing) }
        advanceTimeBy(100)
        runCurrent()
        r.api.ok(r.server(), c.copy(attempt = 2))
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(1, r.reels.calls)
        assertEquals(2, r.acksOf(c.id).size)
        assertEquals(r.acksOf(c.id)[0], r.acksOf(c.id)[1])
    }

    @Test fun `an id begun before a process death is never run again`() = runTest {
        val r = Rig(this)
        r.ledger.begin("start-00000000000009")
        r.api.ok(r.server(), command("start-00000000000009", "workout.start", r.server(), 60_000, 1, "type" to "walk"))
        backgroundScope.launch { r.loop.run(r.pairing) }
        advanceTimeBy(100)
        runCurrent()
        assertEquals(CommandAck.failed("interrupted"), r.acksOf("start-00000000000009").single())
        assertTrue(r.workout.calls.isEmpty())
    }

    @Test fun `an out-of-range command is refused without running`() = runTest {
        val r = Rig(this)
        r.api.ok(r.server(), command("reels-0000000000002", "reels.set", r.server(), 86_400_000, 1, "dailyLimit" to 9_999))
        backgroundScope.launch { r.loop.run(r.pairing) }
        advanceTimeBy(100)
        runCurrent()
        assertEquals(CommandAck.rejected("bad_payload"), r.acksOf("reels-0000000000002").single())
        assertEquals(0, r.reels.calls)
    }

    @Test fun `errors back off from 2 s, doubling, with jitter, and success resets`() = runTest {
        val r = Rig(this)
        repeat(4) { r.api.polls.trySend(PollResult.Failed(null, "IOException")) }
        backgroundScope.launch { r.loop.run(r.pairing) }
        advanceTimeBy(60_000)
        runCurrent()
        val gaps = r.api.pollTimes.zipWithNext { a, b -> b - a }.take(4)
        val expected = listOf(2_000L, 4_000L, 8_000L, 16_000L)
        for ((gap, base) in gaps.zip(expected)) assertTrue("gap $gap for $base", gap in (base * 8 / 10)..(base * 12 / 10))
        // after the first success the loop holds 25 s per poll and asks again at once
        assertEquals(25, r.api.pollWaits.last())
    }

    @Test fun `a 401 marks the pairing needsRepair and ends the loop`() = runTest {
        val r = Rig(this)
        r.api.polls.trySend(PollResult.Unauthorized)
        val stop = r.loop.run(r.pairing)
        assertEquals(CommandLoop.Stop.UNAUTHORIZED, stop)
        assertTrue(r.settings.pairing.value!!.needsRepair)
    }

    @Test fun `a changed person ends the loop before anything runs`() = runTest {
        val r = Rig(this)
        r.api.personId = "someone-else"
        r.api.ok(r.server(), command("start-00000000000003", "workout.start", r.server(), 60_000, 1, "type" to "walk"))
        assertEquals(CommandLoop.Stop.PERSON_CHANGED, r.loop.run(r.pairing))
        assertTrue(r.workout.calls.isEmpty())
        assertTrue(r.api.acks.isEmpty())
    }

    @Test fun `one wait=0 poll for the safety-net worker`() = runTest {
        val r = Rig(this)
        r.api.ok(r.server(), command("upd-000000000000001", "update.check", r.server(), 3_600_000))
        assertEquals(CommandLoop.Stop.DRAINED, r.loop.run(r.pairing, once = true))
        assertEquals(listOf(0), r.api.pollWaits)
        assertEquals("done", r.acksOf("upd-000000000000001").single().status)
    }

    @Test fun `the loop runs only while paired and not needsRepair`() = runTest {
        val pairing = HubPairing("https://hub.example", "t1", "person-1", "0.6.0", 500, 1_048_576, 1)
        val flow = MutableStateFlow<HubPairing?>(pairing)
        val started = mutableListOf<String>()
        var running = false
        backgroundScope.launch {
            CommandChannel.supervise(flow) { p ->
                started += p.token
                running = true
                try { awaitCancellation() } finally { running = false }
            }
        }
        runCurrent()
        assertTrue(running)
        flow.value = null // unpair
        runCurrent()
        assertFalse(running)
        flow.value = pairing.copy(token = "t2")
        runCurrent()
        assertTrue(running)
        flow.value = pairing.copy(token = "t2", needsRepair = true)
        runCurrent()
        assertFalse(running)
        assertEquals(listOf("t1", "t2"), started)
    }

    @Test fun `the CPU stays awake through a backoff and a command, never through a held poll (r068 B2)`() = runTest {
        val r = Rig(this)
        r.api.polls.trySend(PollResult.Failed(null, "IOException"))
        backgroundScope.launch { r.loop.run(r.pairing) }
        runCurrent()
        // in the 2 s backoff: held (a sleeping phone would otherwise freeze this delay)
        assertEquals(1, r.wake.open)
        advanceTimeBy(3_000)
        runCurrent()
        // parked in the 25 s held poll: nothing held (the server's answer wakes the phone)
        assertEquals(0, r.wake.open)
        assertTrue(r.loop.lastAnswerAt == 0L)
        advanceTimeBy(25_000)
        runCurrent()
        assertTrue(r.loop.lastAnswerAt > 0L)

        r.api.ok(r.server(), command("sync-00000000000001", "ring.sync", r.server(), 120_000))
        advanceTimeBy(26_000)
        runCurrent()
        assertEquals(listOf("running"), r.acksOf("sync-00000000000001").map { it.status })
        // past the 2 s gap before the next poll, the 60 s sync alone holds the CPU
        advanceTimeBy(3_000)
        runCurrent()
        assertEquals(1, r.wake.open)
        advanceTimeBy(57_000)
        runCurrent()
        assertEquals(listOf("running", "done"), r.acksOf("sync-00000000000001").map { it.status })
        assertEquals(0, r.wake.open)
        // every hold ends on its own, too
        assertTrue(r.wake.asked.all { it in 1..(CommandLoop.RUN_WAKE_MS + CommandLoop.WAKE_SLACK_MS) })
    }
}
