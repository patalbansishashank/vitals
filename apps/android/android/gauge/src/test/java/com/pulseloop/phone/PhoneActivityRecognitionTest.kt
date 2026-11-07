package com.pulseloop.phone

import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.DetectedActivity
import com.pulseloop.data.sources.ActivityAcquisitionEntity
import com.pulseloop.data.sources.ActivityTransitionEntity
import com.pulseloop.data.sources.PhoneAnchorEntity
import com.pulseloop.phone.PhoneActivityRecognition.RawTransition
import com.pulseloop.phone.PhoneActivityRecognition.RegisterResult
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Activity Recognition acquisition (Gauge 2.8.3, auto-detection CONTRACT §1): timing, identity, intervals. */
class PhoneActivityRecognitionTest {

    /** In memory, with the Room rules that matter: unique events, newest anchor per boot. */
    class FakeStore : PhoneActivityRecognition.Store, ActivityRecognitionLog.Store {
        val transitions = mutableListOf<ActivityTransitionEntity>()
        val anchors = mutableListOf<PhoneAnchorEntity>()
        val intervals = mutableListOf<ActivityAcquisitionEntity>()
        private var seq = 1L
        private var iseq = 1L

        override suspend fun insertTransitions(rows: List<ActivityTransitionEntity>): Int {
            var n = 0
            for (r in rows) {
                val known = transitions.any { it.bootId == r.bootId && it.elapsedNs == r.elapsedNs && it.activity == r.activity && it.transition == r.transition }
                if (!known) { transitions += r.copy(seq = seq++); n++ }
            }
            return n
        }
        override suspend fun latestAnchor(bootId: String) = anchors.filter { it.bootId == bootId }.maxWithOrNull(compareBy({ it.takenAtMs }, { it.mNs }))
        override suspend fun putAnchor(anchor: PhoneAnchorEntity) { anchors.removeAll { it.anchorId == anchor.anchorId }; anchors += anchor }
        override suspend fun maxEpoch() = intervals.maxOfOrNull { it.registrationEpoch } ?: 0

        override suspend fun openInterval() = intervals.lastOrNull { it.toMs == null }
        override suspend fun transition(closing: ActivityAcquisitionEntity?, next: ActivityAcquisitionEntity?) {
            for (row in listOfNotNull(closing, next)) {
                val i = intervals.indexOfFirst { it.seq == row.seq && row.seq != 0L }
                if (i >= 0) intervals[i] = row else intervals += row.copy(seq = iseq++)
            }
        }
        override suspend fun touchOpen(at: Long) {
            val i = intervals.indexOfLast { it.toMs == null }
            if (i >= 0 && intervals[i].lastSeenMs < at) intervals[i] = intervals[i].copy(lastSeenMs = at)
        }
        val closed get() = intervals.filter { it.toMs != null }
    }

    class FakeRegistrar(var result: RegisterResult = RegisterResult.Listening, override var supported: Boolean = true) : PhoneActivityRecognition.Registrar {
        val registered = mutableListOf<Int>()
        var unregistered = 0
        override suspend fun register(epoch: Int): RegisterResult { registered += epoch; return result }
        override suspend fun unregister() { unregistered++ }
    }

    private val t0 = Instant.parse("2026-10-28T08:10:00Z").toEpochMilli()

    private class Rig(
        val store: FakeStore = FakeStore(),
        val registrar: FakeRegistrar = FakeRegistrar(),
        val clock: PhoneStepCounterTest.FakeClock,
        var permission: Boolean = true,
    ) {
        var records = 0
        val ar = newProcess()
        fun newProcess() = PhoneActivityRecognition(store, registrar, clock, ActivityRecognitionLog(store), { permission }, { records++ })
    }

    private fun rig(boot: String = "b9") = Rig(clock = PhoneStepCounterTest.FakeClock(t0, 5_000_000_000_000L, boot))

    private fun walkingEnter(ns: Long) = RawTransition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_ENTER, ns)

    // ── timestamps ──────────────────────────────────────────────────────────────────────────

    @Test fun `occurred_at comes from elapsedRealtimeNanos through the step counter's anchor, not the callback time`() = runBlocking {
        val r = rig()
        // The step counter anchored this boot 20 minutes ago (same row format it writes).
        val aUtc = t0 - 20 * 60_000L
        val aNs = r.clock.elapsed - 20 * 60_000_000_000L
        r.store.putAnchor(PhoneAnchorEntity("b9:$aUtc:$aNs", "b9", aUtc, aNs, "start", aUtc))
        // Delivered now, but the walk began 7.5 minutes ago.
        val eventNs = r.clock.elapsed - 450_000_000_000L
        assertEquals(1, r.ar.onTransitions(listOf(walkingEnter(eventNs)), epochHint = 3))
        val row = r.store.transitions.single()
        assertEquals(t0 - 450_000L, row.occurredAtMs)
        assertEquals("b9:$aUtc:$aNs", row.anchorId)
        assertEquals(t0, row.receivedAtMs)
        assertEquals("WALKING", row.activity)
        assertEquals("ENTER", row.transition)
        assertEquals(eventNs, row.elapsedNs)
        assertEquals(3, row.registrationEpoch)
        assertEquals(1, r.store.anchors.size)
    }

    @Test fun `another boot's anchor is never used - this boot gets its own, shared with the counter`() = runBlocking {
        val r = rig(boot = "b10")
        r.store.putAnchor(PhoneAnchorEntity("b9:1:2", "b9", t0 - 86_400_000L, 2, "start", t0 - 86_400_000L))
        r.ar.onTransitions(listOf(walkingEnter(r.clock.elapsed - 60_000_000_000L)), null)
        val row = r.store.transitions.single()
        assertEquals("b10", row.bootId)
        assertEquals(t0 - 60_000L, row.occurredAtMs)
        val fresh = r.store.anchors.single { it.bootId == "b10" }
        assertEquals(row.anchorId, fresh.anchorId)
        assertEquals("b10:${t0}:${r.clock.elapsed}", fresh.anchorId)
    }

    @Test fun `a clock change no one anchored gives a fresh anchor, one the counter took is reused`() = runBlocking {
        val r = rig()
        r.store.putAnchor(PhoneAnchorEntity("b9:$t0:${r.clock.elapsed}", "b9", t0, r.clock.elapsed, "start", t0))
        r.clock.advance(600.0)
        // The wall clock is set an hour ahead; no clock-change anchor exists yet.
        r.clock.utc += 3_600_000L
        val ns1 = r.clock.elapsed - 30_000_000_000L
        r.ar.onTransitions(listOf(walkingEnter(ns1)), null)
        val first = r.store.transitions.single()
        assertEquals(r.clock.utc - 30_000L, first.occurredAtMs)
        val clockAnchor = r.store.anchors.single { it.reason == "activityClock" }
        assertEquals(clockAnchor.anchorId, first.anchorId)

        // Later the step counter re-anchors on its clock broadcast; the next event shares that anchor.
        r.clock.advance(120.0)
        val counterAnchor = PhoneAnchorEntity("b9:${r.clock.utc}:${r.clock.elapsed}", "b9", r.clock.utc, r.clock.elapsed, "android.intent.action.TIME_SET", r.clock.utc)
        r.store.putAnchor(counterAnchor)
        r.clock.advance(5.0)
        r.ar.onTransitions(listOf(RawTransition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_EXIT, r.clock.elapsed - 1_000_000_000L)), null)
        assertEquals(counterAnchor.anchorId, r.store.transitions.last().anchorId)
        assertEquals(r.clock.utc - 1_000L, r.store.transitions.last().occurredAtMs)
        assertEquals(3, r.store.anchors.size)
    }

    @Test fun `a small drift between wall and elapsed clocks keeps the shared anchor`() = runBlocking {
        val r = rig()
        r.store.putAnchor(PhoneAnchorEntity("b9:$t0:${r.clock.elapsed}", "b9", t0, r.clock.elapsed, "start", t0))
        r.clock.advance(3600.0)
        r.clock.utc += 1_500L
        r.ar.onTransitions(listOf(walkingEnter(r.clock.elapsed)), null)
        assertEquals("b9:$t0:${r.clock.elapsed - 3_600_000_000_000L}", r.store.transitions.single().anchorId)
        assertEquals(1, r.store.anchors.size)
    }

    // ── identity and replay ─────────────────────────────────────────────────────────────────

    @Test fun `a re-delivered callback is stored once and does not ask for another upload`() = runBlocking {
        val r = rig()
        val batch = listOf(
            RawTransition(DetectedActivity.STILL, ActivityTransition.ACTIVITY_TRANSITION_EXIT, r.clock.elapsed - 5_000_000_000L),
            walkingEnter(r.clock.elapsed - 5_000_000_000L),
        )
        assertEquals(2, r.ar.onTransitions(batch, 1))
        assertEquals(1, r.records)
        r.clock.advance(30.0)
        r.clock.utc += 7_200_000L // even across a clock change, the identity is the same event
        assertEquals(0, r.ar.onTransitions(batch, 2))
        assertEquals(1, r.records)
        assertEquals(2, r.store.transitions.size)
        assertEquals(listOf("STILL" to "EXIT", "WALKING" to "ENTER"), r.store.transitions.map { it.activity to it.transition })
    }

    @Test fun `every registered activity maps, others and impossible times are dropped`() = runBlocking {
        val r = rig()
        val now = r.clock.elapsed
        val types = listOf(DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE, DetectedActivity.RUNNING, DetectedActivity.WALKING, DetectedActivity.STILL)
        val batch = types.mapIndexed { i, t -> RawTransition(t, ActivityTransition.ACTIVITY_TRANSITION_ENTER, now - (i + 1) * 1_000_000_000L) } +
            RawTransition(DetectedActivity.ON_FOOT, ActivityTransition.ACTIVITY_TRANSITION_ENTER, now - 9_000_000_000L) +
            RawTransition(DetectedActivity.WALKING, 7, now - 9_000_000_000L) +
            RawTransition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_EXIT, 0) +
            RawTransition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_EXIT, now + 60_000_000_000L)
        assertEquals(5, r.ar.onTransitions(batch, null))
        assertEquals(listOf("IN_VEHICLE", "ON_BICYCLE", "RUNNING", "WALKING", "STILL"), r.store.transitions.map { it.activity })
    }

    // ── registration and acquisition ────────────────────────────────────────────────────────

    @Test fun `listening only after Play Services accepts, with a new epoch per registration`() = runBlocking {
        val r = rig()
        assertEquals("listening", r.ar.start("service"))
        assertEquals(listOf(1), r.registrar.registered)
        assertEquals("listening", r.ar.start("boot")) // idempotent in one process
        assertEquals(listOf(1), r.registrar.registered)
        r.clock.advance(600.0)
        r.ar.stop()
        assertEquals(1, r.registrar.unregistered)
        assertEquals(listOf("listening" to 1), r.store.closed.map { it.state to it.registrationEpoch })
        assertEquals("stopped", r.store.openInterval()!!.state)
        r.clock.advance(60.0)
        r.ar.start("service")
        assertEquals(listOf(1, 2), r.registrar.registered)
        assertEquals(listOf("listening" to 1, "stopped" to 1), r.store.closed.map { it.state to it.registrationEpoch })
        assertEquals(2, r.store.openInterval()!!.registrationEpoch)
    }

    @Test fun `no permission, no Play Services and a refusal are logged as such, never as listening`() = runBlocking {
        val noPerm = rig().apply { permission = false }
        assertEquals("noPermission", noPerm.ar.start("service"))
        assertTrue(noPerm.registrar.registered.isEmpty())

        val unsupported = rig().apply { registrar.supported = false }
        assertEquals("unsupported", unsupported.ar.start("service"))
        assertTrue(unsupported.registrar.registered.isEmpty())

        val refused = rig().apply { registrar.result = RegisterResult.Failed("API unavailable") }
        assertEquals("failed", refused.ar.start("service"))
        assertEquals("failed", refused.store.openInterval()!!.state)
        refused.registrar.result = RegisterResult.Listening
        refused.clock.advance(60.0)
        refused.ar.heartbeat()
        assertEquals("failed", refused.ar.state) // retried only after 15 minutes
        refused.clock.advance(15 * 60.0)
        refused.ar.heartbeat()
        assertEquals("listening", refused.ar.state)
        assertEquals(listOf("failed" to 1), refused.store.closed.map { it.state to it.registrationEpoch })
        assertEquals(2, refused.store.openInterval()!!.registrationEpoch)
    }

    @Test fun `a restored permission registers again from the heartbeat`() = runBlocking {
        val r = rig().apply { permission = false }
        r.ar.start("service")
        r.clock.advance(60.0)
        r.ar.heartbeat()
        assertEquals("noPermission", r.ar.state)
        r.permission = true
        r.clock.advance(60.0)
        r.ar.heartbeat()
        assertEquals("listening", r.ar.state)
        assertEquals(listOf(2), r.registrar.registered)
        assertEquals(listOf("noPermission"), r.store.closed.map { it.state })
    }

    @Test fun `acquisition gap - a process death leaves the time after the last-seen moment unknown`() = runBlocking {
        val r = rig()
        r.ar.start("service")
        r.clock.advance(60.0); r.ar.heartbeat()
        r.clock.advance(60.0); r.ar.heartbeat()
        val lastSeen = r.clock.utc
        // The process dies; a reboot 40 minutes later starts a new one (new boot, registration lost).
        r.clock.advance(40 * 60.0)
        r.clock.boot = "b10"
        val next = r.newProcess()
        assertEquals("listening", next.start("boot"))
        val listening = r.store.intervals.filter { it.state == "listening" }
        assertEquals(2, listening.size)
        assertEquals(t0, listening[0].fromMs)
        assertEquals(lastSeen, listening[0].toMs)
        assertEquals(r.clock.utc, listening[1].fromMs)
        assertNull(listening[1].toMs)
        // Nothing claims the 40 minutes between: no interval covers them.
        assertTrue(r.store.intervals.none { it.fromMs < r.clock.utc && (it.toMs ?: Long.MAX_VALUE) > lastSeen })
        assertEquals(2, listening[1].registrationEpoch)
    }

    @Test fun `a delivery touches only a listening interval, and intervals roll at the UTC hour`() = runBlocking {
        val r = rig()
        r.ar.start("service") // 08:10
        r.clock.advance(55 * 60.0) // 09:05
        r.ar.onTransitions(listOf(walkingEnter(r.clock.elapsed - 1_000_000_000L)), null)
        val first = r.store.closed.single()
        assertEquals(t0, first.fromMs)
        assertEquals(Instant.parse("2026-10-28T09:00:00Z").toEpochMilli(), first.toMs)
        val open = r.store.openInterval()!!
        assertEquals("listening", open.state)
        assertEquals(1, open.registrationEpoch)
        assertEquals(r.clock.utc, open.lastSeenMs)
        // The event carries the open registration's epoch when the intent named none.
        assertEquals(1, r.store.transitions.single().registrationEpoch)
    }
}
