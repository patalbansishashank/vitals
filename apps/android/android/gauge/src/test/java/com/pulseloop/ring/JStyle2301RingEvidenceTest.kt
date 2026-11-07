package com.pulseloop.ring

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SPEC GA ring evidence: the decoder goldens (all-zero, fallback and mixed `0x52` records, 34- and
 * 130-byte `0x53`, unknown firmware, the flagged `0x18` counters) and the GA.8 history cursor.
 */
class JStyle2301RingEvidenceTest {
    private val utc = ZoneId.of("UTC")
    private val decoder = JStyle2301Decoder(utc, initialFirmwareRevision = "V0789")
    private val recordStart = Instant.parse("2026-10-21T07:00:00Z")

    // ── 0x52 activity detail (GA.1) ─────────────────────────────────────────

    @Test fun `all-zero record emits ten observed zero minutes`() {
        val buckets = buckets(detail(total = 0, distanceDm = 0, minutes = List(10) { 0 }))
        assertEquals(10, buckets.size)
        assertTrue(buckets.all { it.steps == 0 && it.distanceMeters == 0 })
        assertTrue(buckets.all { it.durationS == 60 && it.support == StepSupport.MINUTE })
        assertEquals((0 until 10).map { recordStart.plusSeconds(it * 60L) }, buckets.map { it._timestamp })
        assertTrue(buckets.all { it.parentTotalSteps == 0 && it.parentRecordStart == recordStart })
    }

    @Test fun `zero minutes under a positive total become one marked ten-minute fallback`() {
        val bucket = buckets(detail(total = 640, distanceDm = 45, minutes = List(10) { 0 })).single()
        assertEquals(recordStart, bucket._timestamp)
        assertEquals(640, bucket.steps)
        assertEquals(450, bucket.distanceMeters)
        assertEquals(600, bucket.durationS)
        assertEquals(StepSupport.TEN_MINUTE_FALLBACK, bucket.support)
        assertEquals(640, bucket.parentTotalSteps)
    }

    @Test fun `mixed record keeps zeros and the parent total that disagrees with its minutes`() {
        val minutes = listOf(0, 12, 0, 30, 0, 0, 95, 0, 0, 7)
        val buckets = buckets(detail(total = 150, distanceDm = 10, minutes = minutes))
        assertEquals(minutes, buckets.map { it.steps })
        assertEquals(144, buckets.sumOf { it.steps })
        assertTrue("parent total stays visible", buckets.all { it.parentTotalSteps == 150 })
        assertEquals(100, buckets.sumOf { it.distanceMeters })
        assertTrue(buckets.filter { it.steps == 0 }.all { it.distanceMeters == 0 })
    }

    @Test fun `bridge carries the evidence fields into the bus event`() {
        val bucket = buckets(detail(total = 640, distanceDm = 45, minutes = List(10) { 0 })).single()
        val event = RingEventBridge.eventsFor(bucket, recordStart.plusSeconds(3600)).single() as PulseEvent.ActivityBucket
        assertEquals(600, event.durationS)
        assertEquals(StepSupport.TEN_MINUTE_FALLBACK, event.support)
        assertEquals(640, event.parentTotalSteps)
        assertEquals(recordStart, event.parentRecordStart)
    }

    // ── 0x53 sleep (GA.2) ───────────────────────────────────────────────────

    @Test fun `34-byte sleep record has a 300 s native epoch and raw codes`() {
        val record = ByteArray(34).also {
            it[0] = 0x53; stamp(it); it[9] = 3
            it[10] = 1; it[11] = 2; it[12] = 5
        }
        val timeline = decoder.decode(record).single() as RingDecodedEvent.SleepTimeline
        assertEquals(300, timeline.nativeEpochS)
        assertEquals(listOf(1, 2, 5), timeline.rawStageCodes)
        assertEquals(List(5) { SleepStage.DEEP } + List(5) { SleepStage.LIGHT } + List(5) { SleepStage.AWAKE }, timeline.stages)
        val bus = RingEventBridge.eventsFor(timeline, recordStart.plusSeconds(86_400)).single() as PulseEvent.SleepTimeline
        assertEquals(300, bus.nativeEpochS)
        assertEquals(listOf(1, 2, 5), bus.rawStageCodes)
    }

    @Test fun `130-byte sleep record has a 60 s native epoch`() {
        val packet = ByteArray(130).also {
            it[0] = 0x53; stamp(it); it[9] = 4
            it[10] = 3; it[11] = 2; it[12] = 1; it[13] = 10
        }
        val timeline = decoder.decode(packet).single() as RingDecodedEvent.SleepTimeline
        assertEquals(60, timeline.nativeEpochS)
        assertEquals(listOf(3, 2, 1, 10), timeline.rawStageCodes)
        assertEquals(listOf(SleepStage.REM, SleepStage.LIGHT, SleepStage.DEEP, SleepStage.AWAKE), timeline.stages)
    }

    @Test fun `unknown firmware keeps every stage unknown and the raw codes`() {
        val unknown = JStyle2301Decoder(utc)
        val record = ByteArray(34).also {
            it[0] = 0x53; stamp(it); it[9] = 2
            it[10] = 1; it[11] = 3
        }
        val timeline = unknown.decode(record).single() as RingDecodedEvent.SleepTimeline
        assertEquals(List(10) { SleepStage.UNKNOWN }, timeline.stages)
        assertEquals(listOf(1, 3), timeline.rawStageCodes)
        assertEquals(300, timeline.nativeEpochS)
    }

    // ── 0x18 sport telemetry (GA.3) ─────────────────────────────────────────

    @Test fun `sport counters stay undecoded while the flag is off`() {
        assertFalse(JStyle2301Flags.SPORT_TELEMETRY_DECODE)
        val at = Instant.parse("2026-10-21T18:05:00Z")
        val off = JStyle2301Decoder(utc, "V0789", now = { at })
        val marker = off.decode(sport(bpm = 112, steps = 1_234, kcalHundredths = 5_678)).first() as RingDecodedEvent.SportTelemetry
        assertNull(marker.stepsCumulative)
        assertTrue(RingEventBridge.eventsFor(marker, at).none { it is PulseEvent.SportTelemetrySample })
    }

    @Test fun `sport counters decode little-endian behind the flag`() {
        val at = Instant.parse("2026-10-21T18:05:00Z")
        val on = JStyle2301Decoder(utc, "V0789", now = { at }, sportTelemetryEnabled = true)
        val events = on.decode(sport(bpm = 112, steps = 70_000, kcalHundredths = 5_678))
        val marker = events.first() as RingDecodedEvent.SportTelemetry
        assertEquals(70_000L, marker.stepsCumulative)
        assertEquals(56.78, marker.vendorKcalCumulative!!, 1e-9)
        assertTrue(events.any { it is RingDecodedEvent.HeartRateSample && it.bpm == 112 })
        val sample = RingEventBridge.eventsFor(marker, at).single() as PulseEvent.SportTelemetrySample
        assertEquals(PulseEvent.SportTelemetrySample(at, 70_000L, 56.78, 112), sample)
    }

    @Test fun `auto HR interval command is deliberately absent`() {
        assertFalse(JStyle2301Flags.AUTO_HR_INTERVAL_IMPLEMENTED)
    }

    // ── GA.8 history cursor and coverage ────────────────────────────────────

    @Test fun `without a store the budgets are unchanged and a drained stream reports coverage`() = runTest {
        val progress = mutableListOf<PulseEvent>()
        val writes = mutableListOf<ByteArray>()
        val sync = JStyle2301HistorySync(RingCommandWriter { writes += it }, 100, 500, scope = this, progressSink = { progress += it })
        sync.start(listOf(JStyle2301HistoryStream.ACTIVITY_DETAIL), pageLimit = 1)
        sync.noteRecords(0x52, listOf(t(10, 0) to t(10, 10), t(9, 50) to t(10, 0)))
        sync.notePacket(byteArrayOf(0x52, 0xFF.toByte()))
        val coverage = progress.filterIsInstance<PulseEvent.HistoryCoverage>().single()
        assertEquals(PulseEvent.HistoryCoverage("activity_detail", t(9, 50), t(10, 10), complete = true, reason = "drained"), coverage)
        assertEquals(PulseEvent.SyncProgress("done"), progress.last())
    }

    @Test fun `first run deep-pulls one stream last and lets the others wait`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val store = InMemoryJStyle2301HistoryCursorStore()
        val sync = JStyle2301HistorySync(RingCommandWriter { writes += it }, 100, 500, scope = this, progressSink = {}, cursorStore = store)
        sync.start(listOf(JStyle2301HistoryStream.ACTIVITY_DETAIL, JStyle2301HistoryStream.HEART_RATE), pageLimit = 1)
        // The deep candidate (activity detail, first undrained) is queued after heart rate.
        assertEquals(0x55, writes.single()[0].toInt() and 0xFF)
        sync.noteRecords(0x55, listOf(t(10, 0) to t(10, 0)))
        repeat(50) { sync.notePacket(byteArrayOf(0x55, 0x00)) } // bounded at its shallow page
        assertEquals(0x52, writes.last()[0].toInt() and 0xFF)
        val hr = store.load(JStyle2301HistoryStream.HEART_RATE)!!
        assertFalse("a shallow bounded pull leaves a gap to fill", hr.historyDrained)
        // The deep stream pages on with mode 2 past page one.
        repeat(50) { sync.notePacket(byteArrayOf(0x52, 0x00)) }
        assertEquals(2, writes.last()[1].toInt())
        sync.notePacket(byteArrayOf(0x52, 0xFF.toByte()))
        assertTrue(store.load(JStyle2301HistoryStream.ACTIVITY_DETAIL)!!.historyDrained)
    }

    @Test fun `incremental pull stops at its overlap and extends the contiguous span`() = runTest {
        val progress = mutableListOf<PulseEvent>()
        val writes = mutableListOf<ByteArray>()
        val store = InMemoryJStyle2301HistoryCursorStore()
        val stream = JStyle2301HistoryStream.ACTIVITY_DETAIL
        store.save(stream, JStyle2301HistoryCursor(t(8, 0), t(8, 10), contiguousFrom = t(0, 0, day = 19), historyDrained = true, nextDeepPages = 20))
        val sync = JStyle2301HistorySync(RingCommandWriter { writes += it }, 100, 500, scope = this, progressSink = { progress += it }, cursorStore = store)
        sync.start(listOf(stream), pageLimit = 1)
        sync.noteRecords(0x52, listOf(t(9, 0) to t(9, 10), t(7, 50) to t(8, 0)))
        repeat(50) { sync.notePacket(byteArrayOf(0x52, 0x00)) }
        assertEquals("no continuation once the overlap is seen", 1, writes.size)
        val coverage = progress.filterIsInstance<PulseEvent.HistoryCoverage>().single()
        assertEquals(t(0, 0, day = 19), coverage.from)
        assertEquals(t(9, 10), coverage.to)
        assertTrue(coverage.complete)
        assertEquals("overlap", coverage.reason)
        assertEquals(JStyle2301HistoryCursor(t(9, 0), t(9, 10), t(0, 0, day = 19), true, 20), store.load(stream))
    }

    @Test fun `incremental pull bounded before its overlap reports a gap and schedules a deep pull`() = runTest {
        val progress = mutableListOf<PulseEvent>()
        val store = InMemoryJStyle2301HistoryCursorStore()
        val stream = JStyle2301HistoryStream.HEART_RATE
        store.save(stream, JStyle2301HistoryCursor(t(1, 0), t(1, 0), t(0, 0, day = 19), true, 20))
        val sync = JStyle2301HistorySync(RingCommandWriter {}, 100, 500, scope = this, progressSink = { progress += it },
            cursorStore = store, catchUpPages = 1)
        sync.start(listOf(stream), pageLimit = 1)
        sync.noteRecords(0x55, listOf(t(12, 0) to t(12, 0), t(6, 0) to t(6, 0)))
        repeat(50) { sync.notePacket(byteArrayOf(0x55, 0x00)) }
        val coverage = progress.filterIsInstance<PulseEvent.HistoryCoverage>().single()
        assertEquals(PulseEvent.HistoryCoverage("heart_rate", t(6, 0), t(12, 0), complete = false, reason = "bounded"), coverage)
        val next = store.load(stream)!!
        assertFalse(next.historyDrained)
        assertEquals(t(6, 0), next.contiguousFrom)
    }

    @Test fun `bounded deep pulls double up to the deepest budget then stop`() = runTest {
        val store = InMemoryJStyle2301HistoryCursorStore()
        val stream = JStyle2301HistoryStream.SPO2
        fun run(): JStyle2301HistoryCursor = run {
            val sync = JStyle2301HistorySync(RingCommandWriter {}, 100, 500, scope = this, progressSink = {},
                cursorStore = store, deepPages = 1, maxDeepPages = 2)
            sync.start(listOf(stream), pageLimit = 1)
            sync.noteRecords(0x66, listOf(t(5, 0) to t(5, 0)))
            repeat(100) { sync.notePacket(byteArrayOf(0x66, 0x00)) }
            store.load(stream)!!
        }
        val first = run()
        assertEquals(2, first.nextDeepPages)
        assertFalse(first.historyDrained)
        val second = run()
        assertTrue("as far back as one link reaches", second.historyDrained)
    }

    @Test fun `driver emits coverage after the terminal packet's own records`() {
        val store = InMemoryJStyle2301HistoryCursorStore()
        val driver = JStyle2301Driver(writer = null, zoneId = utc, now = { Instant.parse("2026-10-21T12:00:00Z") }, cursorStore = store)
        val engine = driver.makeSyncEngine()
        // This coverage assertion exercises the archive planner's deep-first ordering.
        // Routine startup is deliberately shallow; an explicit refresh retains deep backfill.
        engine.refresh()
        driver.ingest(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05), "fff7").forEach(engine::handle)
        // V0525 needs no authentication: the pager starts. Activity total is the deep pull, so the
        // first stream asked for is activity detail.
        val packet = detail(total = 0, distanceDm = 0, minutes = List(10) { 0 }) + byteArrayOf(0x52, 0xFF.toByte())
        val events = driver.ingest(packet, "fff7")
        val coverageAt = events.indexOfFirst { it is RingDecodedEvent.HistoryCoverage }
        assertTrue(coverageAt > events.indexOfLast { it is RingDecodedEvent.ActivityBucket })
        val coverage = events[coverageAt] as RingDecodedEvent.HistoryCoverage
        assertEquals("activity_detail", coverage.stream)
        assertEquals(recordStart, coverage.from)
        assertEquals(recordStart.plusSeconds(600), coverage.to)
        assertTrue(coverage.complete)
        driver.connectionDidEnd()
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private fun t(h: Int, m: Int, day: Int = 21): Instant =
        Instant.parse("2026-10-%02dT%02d:%02d:00Z".format(day, h, m))

    private fun buckets(packet: ByteArray) =
        decoder.decode(packet).filterIsInstance<RingDecodedEvent.ActivityBucket>()

    /** One 25-byte `0x52` record stamped 2026-10-21 07:00:00. */
    private fun detail(total: Int, distanceDm: Int, minutes: List<Int>): ByteArray = ByteArray(25).also {
        it[0] = 0x52
        stamp(it)
        putU16(it, 9, total)
        putU16(it, 13, distanceDm)
        minutes.forEachIndexed { i, v -> it[15 + i] = v.toByte() }
    }

    private fun sport(bpm: Int, steps: Int, kcalHundredths: Int): ByteArray = ByteArray(16).also {
        it[0] = 0x18
        it[1] = bpm.toByte()
        putU32(it, 2, steps)
        putU32(it, 6, kcalHundredths)
    }

    private fun stamp(packet: ByteArray) {
        packet[3] = bcd(26); packet[4] = bcd(10); packet[5] = bcd(21)
        packet[6] = bcd(7); packet[7] = bcd(0); packet[8] = bcd(0)
    }

    private fun bcd(value: Int): Byte = (((value / 10) shl 4) or (value % 10)).toByte()

    private fun putU16(data: ByteArray, offset: Int, value: Int) {
        data[offset] = value.toByte()
        data[offset + 1] = (value ushr 8).toByte()
    }

    private fun putU32(data: ByteArray, offset: Int, value: Int) {
        repeat(4) { data[offset + it] = (value ushr (8 * it)).toByte() }
    }
}
