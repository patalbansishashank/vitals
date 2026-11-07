package com.pulseloop.phone

import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.PhoneAnchorEntity
import com.pulseloop.data.sources.PhoneCounterLastEntity
import com.pulseloop.data.sources.PhonePendingSpanEntity
import com.pulseloop.data.sources.PhoneStepRecordEntity
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The counter core against a fake sensor manager, clock and store (SPEC §GB tests). */
class PhoneStepCounterTest {

    class FakeStore : PhoneStepCounter.Store {
        var last: PhoneCounterLastEntity? = null
        val pending = mutableListOf<PhonePendingSpanEntity>()
        val records = mutableListOf<PhoneStepRecordEntity>()
        val anchors = mutableMapOf<String, PhoneAnchorEntity>()
        private var nextId = 1L
        override suspend fun last() = last
        override suspend fun commitSample(last: PhoneCounterLastEntity, span: PhonePendingSpanEntity?) {
            span?.let { pending += it.copy(id = nextId++) }
            this.last = last
        }
        override suspend fun pending() = pending.sortedBy { it.mEndNs }
        override suspend fun resolve(spanId: Long, records: List<PhoneStepRecordEntity>) {
            val subjects = this.records.map { it.subject }.toSet()
            this.records += records.filter { it.subject !in subjects }
            pending.removeAll { it.id == spanId }
        }
        override suspend fun putAnchor(anchor: PhoneAnchorEntity) { anchors[anchor.anchorId] = anchor }
        override suspend fun anchor(id: String) = anchors[id]
    }

    class FakeLogStore : PhoneAcquisitionLog.Store {
        val rows = mutableListOf<PhoneAcquisitionEntity>()
        private var seq = 1L
        override suspend fun openInterval() = rows.lastOrNull { it.toMs == null }
        override suspend fun transition(closing: PhoneAcquisitionEntity?, next: PhoneAcquisitionEntity?) {
            for (row in listOfNotNull(closing, next)) {
                val i = rows.indexOfFirst { it.seq == row.seq && row.seq != 0L }
                if (i >= 0) rows[i] = row else rows += row.copy(seq = seq++)
            }
        }
        override suspend fun touchOpen(at: Long) {
            val i = rows.indexOfLast { it.toMs == null }
            if (i >= 0 && rows[i].lastSeenMs < at) rows[i] = rows[i].copy(lastSeenMs = at)
        }
    }

    /** A fake SensorManager: which sensors exist, and the callbacks it was registered with. */
    class FakeSensors(
        override val hasCounter: Boolean = true,
        override val hasDetector: Boolean = true,
        /** The sensor manager accepts the detector's registration (when it exists). */
        private val detectorAccepted: Boolean = true,
        private val counterAccepted: Boolean = true,
    ) : PhoneStepCounter.Sensors {
        var onCounter: ((Long, Long) -> Unit)? = null
        var onDetector: ((Long) -> Unit)? = null
        var registrations = 0
        override fun register(onCounter: (Long, Long) -> Unit, onDetector: (Long) -> Unit): PhoneStepCounter.Registration? {
            if (!counterAccepted) return null
            this.onCounter = onCounter; this.onDetector = onDetector; registrations++
            return PhoneStepCounter.Registration(detector = hasDetector && detectorAccepted)
        }
        override fun unregister() { onCounter = null; onDetector = null }
    }

    class FakeClock(var utc: Long, var elapsed: Long, var boot: String = "b1") : PhoneStepCounter.Clock {
        override fun utcMs() = utc
        override fun elapsedNs() = elapsed
        override fun bootId() = boot
        fun advance(sec: Double) { utc += (sec * 1000).toLong(); elapsed += (sec * 1e9).toLong() }
    }

    private val start = Instant.parse("2026-10-27T08:00:00Z").toEpochMilli()

    private class Rig(
        val store: FakeStore = FakeStore(),
        val logStore: FakeLogStore = FakeLogStore(),
        val sensors: FakeSensors = FakeSensors(),
        val clock: FakeClock,
        permission: Boolean = true,
    ) {
        var notified = 0
        val counter = PhoneStepCounter(store, sensors, clock, PhoneAcquisitionLog(logStore), { permission }, { notified++ })
        // The Android wrapper posts through a channel; here the fake sensor calls straight in.
        init {
            counter.postCounter = { t, c -> runBlocking { counter.onCounter(t, c) } }
            counter.postDetector = { t -> counter.onDetector(t) }
        }
        fun counterEvent(count: Long, tNs: Long = clock.elapsed) = sensors.onCounter!!.invoke(tNs, count)
        fun step(tNs: Long = clock.elapsed) = sensors.onDetector!!.invoke(tNs)
    }

    private fun rig(sensors: FakeSensors = FakeSensors(), permission: Boolean = true, store: FakeStore = FakeStore(), logStore: FakeLogStore = FakeLogStore()) =
        Rig(store = store, logStore = logStore, sensors = sensors, clock = FakeClock(start, 1_000_000_000_000L), permission = permission)

    @Test fun `the first sample only sets a baseline`() = runBlocking {
        val r = rig()
        assertEquals(PhoneAcquisitionLog.LISTENING, r.counter.start())
        r.counterEvent(5_000)
        r.counter.resolveDue(force = true)
        assertTrue(r.store.records.isEmpty())
        assertEquals(5_000L, r.store.last!!.count)
    }

    @Test fun `walking with the detector gives minute records whose sum is the counter delta`() = runBlocking {
        val r = rig()
        r.counter.start()
        r.counterEvent(100) // baseline
        repeat(90) { r.clock.advance(1.0); r.step() }
        r.counterEvent(190)
        r.clock.advance(1.0); r.step() // the detector is past the span end: it is due now
        r.counterEvent(191)
        r.counter.resolveDue(force = true)
        val minutes = r.store.records
        assertTrue(minutes.all { it.timing == "detector" && it.support == "minute" })
        assertEquals(91L, minutes.sumOf { it.steps })
        assertTrue(r.notified > 0)
    }

    @Test fun `a reboot starts a new segment and loses only the unknown delta`() = runBlocking {
        val store = FakeStore()
        val first = rig(store = store)
        first.counter.start()
        first.counterEvent(10_000)
        first.clock.advance(30.0)
        first.counterEvent(10_050)
        first.counter.stop()
        assertEquals(50L, store.records.sumOf { it.steps })
        // New boot: the counter restarts near zero and elapsed time restarts too.
        val second = Rig(store = store, clock = FakeClock(start + 600_000, 5_000_000_000L, boot = "b2"))
        second.counter.start()
        second.counterEvent(12)
        second.clock.advance(20.0)
        second.counterEvent(40)
        second.counter.stop()
        assertEquals(50L + 28L, store.records.sumOf { it.steps })
        assertTrue(store.records.last().bootId == "b2")
    }

    @Test fun `a counter drop within one boot is a new baseline, never a negative delta`() = runBlocking {
        val r = rig(sensors = FakeSensors(hasDetector = false))
        r.counter.start()
        r.counterEvent(500)
        r.clock.advance(10.0); r.counterEvent(520)
        r.clock.advance(10.0); r.counterEvent(3) // sensor HAL restarted
        r.clock.advance(10.0); r.counterEvent(13)
        r.counter.stop()
        assertEquals(listOf(20L, 10L), r.store.records.map { it.steps })
        assertTrue(r.store.records.all { it.steps >= 0 })
    }

    @Test fun `batched delivery gives the same records as live delivery`() = runBlocking {
        fun run(batched: Boolean): List<Pair<Long, Long>> = runBlocking {
            val r = rig(sensors = FakeSensors(hasDetector = false))
            r.counter.start()
            val base = r.clock.elapsed
            val samples = listOf(0L to 0L, 20L to 30L, 95L to 110L, 200L to 260L) // (sec, count)
            if (batched) {
                r.clock.advance(250.0) // the FIFO hands everything over at once, timestamps intact
                samples.forEach { (s, c) -> r.counterEvent(c, base + s * 1_000_000_000L) }
            } else {
                samples.forEach { (s, c) -> r.clock.elapsed = base + s * 1_000_000_000L; r.counterEvent(c) }
            }
            r.counter.resolveDue(force = true)
            r.store.records.map { it.mStartNs - base to it.steps }
        }
        assertEquals(run(batched = false), run(batched = true))
    }

    @Test fun `a clock jump re-anchors, and records name the anchor they used`() = runBlocking {
        val r = rig(sensors = FakeSensors(hasDetector = false))
        r.counter.start()
        r.counterEvent(0)
        r.clock.advance(10.0); r.counterEvent(10)
        r.counter.resolveDue(force = true)
        r.clock.utc += 3_600_000 // the owner sets the clock forward an hour
        r.counter.onClockChanged("android.intent.action.TIME_SET")
        r.clock.advance(10.0); r.counterEvent(20)
        r.counter.resolveDue(force = true)
        val (a, b) = r.store.records
        assertTrue(a.anchorId != b.anchorId)
        assertEquals(3_600_000L + 10_000L, b.startMs - a.startMs)
        assertEquals(2, r.store.anchors.size)
    }

    @Test fun `DST changes nothing - support is UTC from monotonic time`() = runBlocking {
        val r = Rig(sensors = FakeSensors(hasDetector = false), clock = FakeClock(Instant.parse("2026-03-29T00:59:30Z").toEpochMilli(), 10_000_000_000L))
        r.counter.start()
        r.counterEvent(0)
        r.clock.advance(60.0) // across Europe/London's 01:00 UTC spring-forward
        r.counterEvent(70)
        r.counter.stop()
        val rec = r.store.records.single()
        assertEquals(60_000L, rec.endMs - rec.startMs)
        assertEquals(70L, rec.steps)
    }

    @Test fun `a span left by a previous process resolves as counter-only`() = runBlocking {
        val store = FakeStore()
        val first = rig(store = store)
        first.counter.start()
        first.counterEvent(0)
        repeat(30) { first.clock.advance(2.0); first.step() }
        first.counterEvent(30) // pending, waiting for the detector… and the process dies here
        val second = Rig(store = store, clock = FakeClock(first.clock.utc + 5_000, first.clock.elapsed + 5_000_000_000L))
        second.counter.start()
        second.counter.heartbeat()
        assertEquals(PhoneStepSegmenter.TIMING_COUNTER, store.records.single().timing)
        assertEquals(30L, store.records.single().steps)
    }

    @Test fun `no sensor and no permission are logged, and nothing registers`() = runBlocking {
        val none = rig(sensors = FakeSensors(hasCounter = false))
        assertEquals(PhoneAcquisitionLog.NO_SENSOR, none.counter.start())
        assertEquals(0, none.sensors.registrations)
        assertEquals(PhoneAcquisitionLog.NO_SENSOR, none.logStore.rows.single().state)

        val denied = rig(permission = false)
        assertEquals(PhoneAcquisitionLog.NO_PERMISSION, denied.counter.start())
        assertEquals(0, denied.sensors.registrations)
        assertFalse(denied.counter.isListening)
    }

    @Test fun `acquisition intervals close at stop and roll over at the hour`() = runBlocking {
        val logStore = FakeLogStore()
        val r = rig(logStore = logStore)
        r.counter.start()
        r.clock.advance(3_700.0)
        r.counter.heartbeat()
        r.counter.stop()
        val closed = logStore.rows.filter { it.toMs != null }
        assertEquals(listOf("listening", "listening"), closed.map { it.state })
        assertEquals(start + 3_600_000, closed[0].toMs)
        assertEquals("stopped", logStore.rows.last().state)
        assertNull(logStore.rows.last().toMs)
    }

    @Test fun `a process death closes listening at the last heartbeat and logs the gap as stopped`() = runBlocking {
        val logStore = FakeLogStore()
        val first = rig(logStore = logStore)
        first.counter.start()
        first.clock.advance(120.0)
        first.counter.heartbeat()
        val diedAt = first.clock.utc
        val second = Rig(logStore = logStore, clock = FakeClock(diedAt + 600_000, 2_000_000_000_000L))
        second.counter.start()
        val listening = logStore.rows.first()
        assertEquals(diedAt, listening.toMs)
        val gap = logStore.rows[1]
        assertEquals("stopped", gap.state)
        assertEquals(diedAt + 600_000, gap.toMs)
        assertEquals("listening", logStore.rows.last().state)
    }

    // ── 2.8.1: the acquisition interval says whether the detector was actually registered ──

    @Test fun `a registered detector marks the listening interval, and the hourly continuation keeps it`() = runBlocking {
        val r = rig()
        r.counter.start()
        r.clock.advance(3_700.0)
        r.counter.heartbeat()
        val listening = r.logStore.rows.filter { it.state == PhoneAcquisitionLog.LISTENING }
        assertEquals(2, listening.size)
        assertTrue(listening.all { it.detector == PhoneAcquisitionLog.DETECTOR_REGISTERED })
    }

    @Test fun `a phone without a detector listens counter only, marked absent`() = runBlocking {
        val r = rig(sensors = FakeSensors(hasDetector = false))
        assertEquals(PhoneAcquisitionLog.LISTENING, r.counter.start())
        assertEquals(PhoneAcquisitionLog.DETECTOR_ABSENT, r.logStore.rows.single().detector)
    }

    @Test fun `a refused detector registration is failed, not registered, and leaves spans untimed`() = runBlocking {
        val r = rig(sensors = FakeSensors(hasDetector = true, detectorAccepted = false))
        assertEquals(PhoneAcquisitionLog.LISTENING, r.counter.start())
        assertEquals(PhoneAcquisitionLog.DETECTOR_FAILED, r.logStore.rows.single().detector)
        r.counterEvent(100)
        r.clock.advance(60.0)
        r.counterEvent(150)
        r.counter.resolveDue(force = false) // not waiting for a detector that isn't there
        assertEquals(PhoneStepSegmenter.TIMING_COUNTER, r.store.records.single().timing)
    }

    @Test fun `a refused counter is noSensor with no detector field`() = runBlocking {
        val r = rig(sensors = FakeSensors(counterAccepted = false))
        assertEquals(PhoneAcquisitionLog.NO_SENSOR, r.counter.start())
        assertNull(r.logStore.rows.single().detector)
        assertFalse(r.counter.isListening)
    }

    @Test fun `stopped and permission states never carry a detector`() = runBlocking {
        val r = rig()
        r.counter.start()
        r.clock.advance(10.0)
        r.counter.stop()
        assertNull(r.logStore.rows.last().detector)
        assertEquals(PhoneAcquisitionLog.STOPPED, r.logStore.rows.last().state)
        val denied = rig(permission = false)
        denied.counter.start()
        assertNull(denied.logStore.rows.single().detector)
    }

    @Test fun `a detector change while listening opens a new interval`() = runBlocking {
        val logStore = FakeLogStore()
        val log = PhoneAcquisitionLog(logStore)
        log.enter(PhoneAcquisitionLog.LISTENING, start, PhoneAcquisitionLog.DETECTOR_FAILED)
        log.enter(PhoneAcquisitionLog.LISTENING, start + 1_000, PhoneAcquisitionLog.DETECTOR_FAILED)
        assertEquals(1, logStore.rows.size)
        log.enter(PhoneAcquisitionLog.LISTENING, start + 2_000, PhoneAcquisitionLog.DETECTOR_REGISTERED)
        assertEquals(listOf(PhoneAcquisitionLog.DETECTOR_FAILED, PhoneAcquisitionLog.DETECTOR_REGISTERED), logStore.rows.map { it.detector })
        assertEquals(start + 2_000, logStore.rows[0].toMs)
    }

    // ── 2.8.5 (r068 walk): the walk is the counter's delta, whatever the detector heard ──

    /**
     * The owner's evening walk of 2026-10-28, as the phone's sensors gave it: 40 minutes at about
     * 96 steps a minute, the counter reporting every second (Δ 1 or 2), the detector one event a
     * second, and ten minutes of doze in the middle where the detector's events never arrive while
     * the counter's batch comes in a burst at each minute's end (timestamps intact). The phone's
     * own step app read 3,849 for it; 2.8.4 sent about 2,600 (the detector's events).
     */
    @Test fun `the evening walk - records add up to the counter's 3,849 though the detector heard far fewer`() = runBlocking {
        val r = rig()
        r.counter.start()
        val c0 = 25_000L
        r.counterEvent(c0) // baseline before the walk
        val base = r.clock.elapsed
        val total = 3_849L
        val seconds = 2_400
        val doze = 900 until 1_500 // minutes 15–25: the detector's events dropped, the counter batched
        val countAt = { k: Int -> c0 + total * k / seconds }
        var heard = 0
        var batch = mutableListOf<Pair<Long, Long>>()
        for (k in 1..seconds) {
            r.clock.advance(1.0)
            val t = base + k * 1_000_000_000L
            if (k in doze) {
                batch += t to countAt(k)
                if (k % 60 == 59) { batch.forEach { (tt, c) -> r.counterEvent(c, tt) }; batch = mutableListOf() }
                continue
            }
            r.step(t); heard++
            r.counterEvent(countAt(k), t)
        }
        batch.forEach { (tt, c) -> r.counterEvent(c, tt) }
        r.clock.advance(1.0); r.step()
        r.counter.resolveDue(force = true)
        val records = r.store.records
        assertEquals(total, records.sumOf { it.steps })
        assertTrue("the detector heard ${heard + 1}", heard + 1 < 0.7 * total)
        // every record is the counter's: each span's pieces add up to its delta
        assertTrue(records.filter { it.timing == PhoneStepSegmenter.TIMING_DETECTOR }.all { it.parentSteps != null && it.steps <= it.parentSteps!! })
        // a walking minute reads the walk's cadence (96 or 97), not the detector's 60
        val byMinute = records.groupBy { Math.floorDiv(it.startMs, 60_000L) }.mapValues { (_, v) -> v.sumOf { it.steps } }
        val full = byMinute.toSortedMap().values.drop(1).dropLast(1)
        assertTrue("minutes $full", full.all { it in 95L..98L })
        // the doze minutes came from the counter alone and still count
        assertTrue(records.any { it.timing == PhoneStepSegmenter.TIMING_COUNTER })
    }

    @Test fun `a reboot mid-walk loses only the delta across it, never a negative or a doubled count`() = runBlocking {
        val store = FakeStore()
        val first = rig(store = store)
        first.counter.start()
        first.counterEvent(25_000)
        repeat(600) { first.clock.advance(1.0); first.step(); first.counterEvent(25_000L + (it + 1) * 8 / 5) }
        first.counter.stop()
        assertEquals(960L, store.records.sumOf { it.steps })
        // the phone restarts: a new boot id, elapsed realtime and the counter from zero
        val second = Rig(store = store, clock = FakeClock(first.clock.utc + 60_000, 3_000_000_000L, boot = "b2"))
        second.counter.start()
        second.counterEvent(70) // steps since boot, before the listener: unknown time, a baseline
        repeat(600) { second.clock.advance(1.0); second.step(); second.counterEvent(70L + (it + 1) * 8 / 5) }
        second.counter.stop()
        assertEquals(960L + 960L, store.records.sumOf { it.steps })
        assertTrue(store.records.all { it.steps >= 0 })
    }

    // ── 2.8.3: checkpoint requests for the open acquisition interval ──

    @Test fun `the heartbeat asks for a checkpoint upload at most every five minutes, only while listening`() = runBlocking {
        val clock = FakeClock(start, 1_000_000_000_000L)
        var asked = 0
        val counter = PhoneStepCounter(FakeStore(), FakeSensors(), clock, PhoneAcquisitionLog(FakeLogStore()), { true }, onCheckpoint = { asked++ })
        counter.heartbeat()
        assertEquals(0, asked) // not listening yet
        counter.start()
        val times = mutableListOf<Int>()
        for (m in 1..16) {
            clock.advance(60.0)
            val before = asked
            counter.heartbeat()
            if (asked > before) times += m
        }
        assertEquals(listOf(1, 6, 11, 16), times)
        counter.stop()
        clock.advance(600.0)
        counter.heartbeat()
        assertEquals(4, asked)
    }
}
