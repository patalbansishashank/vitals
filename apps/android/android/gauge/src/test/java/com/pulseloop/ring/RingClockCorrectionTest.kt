package com.pulseloop.ring

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RingClockCorrectionTest {
    private val receivedAt = Instant.parse("2026-10-26T10:52:33Z")
    /** What the server saw: the J-Style 2301 ring's clock ~6.5 min ahead of the phone. */
    private val fastBy = 390_000L

    private class MemoryStore(var segments: List<RingClockSegment> = emptyList()) : RingClockStore {
        override fun load() = segments
        override fun save(segments: List<RingClockSegment>) { this.segments = segments }
    }

    @Test
    fun `offset is ring minus phone in milliseconds`() {
        assertEquals(fastBy, RingClockOffset.measure(receivedAt.plusMillis(fastBy), receivedAt))
        assertEquals(-5_000L, RingClockOffset.measure(receivedAt.minusSeconds(5), receivedAt))
    }

    @Test
    fun `only offsets over sixty seconds are significant`() {
        assertTrue(!RingClockOffset.isSignificant(60_000))
        assertTrue(!RingClockOffset.isSignificant(-60_000))
        assertTrue(RingClockOffset.isSignificant(60_001))
        assertTrue(RingClockOffset.isSignificant(-61_000))
    }

    @Test
    fun `a reading never postdates its receipt`() {
        assertEquals(receivedAt, RingClockOffset.notAfter(receivedAt.plusSeconds(1), receivedAt))
        val past = receivedAt.minusSeconds(30)
        assertEquals(past, RingClockOffset.notAfter(past, receivedAt))
    }

    @Test
    fun `fast clock records are pulled back by the measured offset and persisted`() {
        val store = MemoryStore()
        val corrector = RingClockCorrector(store)
        corrector.recordReadBack(receivedAt.plusMillis(fastBy), receivedAt)

        assertEquals(listOf(RingClockSegment(receivedAt.toEpochMilli(), fastBy)), store.segments)
        // The ring's newest record, stamped 10:59:00 by its fast clock, really is from 10:52:30.
        val raw = Instant.parse("2026-10-26T10:59:00Z")
        assertEquals(raw.minusMillis(fastBy), corrector.correct(raw, receivedAt))
        // An old record is shifted by the same offset.
        val old = Instant.parse("2026-10-25T03:00:00Z")
        assertEquals(old.minusMillis(fastBy), corrector.correct(old, receivedAt))
    }

    @Test
    fun `small offsets are read-back noise and move nothing`() {
        val store = MemoryStore()
        val corrector = RingClockCorrector(store)
        corrector.recordReadBack(receivedAt.plusSeconds(20), receivedAt)
        assertTrue(store.segments.isEmpty())
        assertEquals(20_000L, corrector.lastOffsetMs)
        // 2.7.3 shifted this connection's history by the noise: a new key per connection.
        val raw = receivedAt.minusSeconds(100)
        assertEquals(raw, corrector.correct(raw, receivedAt))
        assertEquals(0L, corrector.offsetAt(raw))
    }

    @Test
    fun `a later connection still corrects records stamped before the earlier set`() {
        val store = MemoryStore()
        RingClockCorrector(store).recordReadBack(receivedAt.plusMillis(fastBy), receivedAt)

        // Next connection, 30 minutes later: the clock is right now.
        val later = receivedAt.plusSeconds(1_800)
        val next = RingClockCorrector(store)
        next.recordReadBack(later.plusSeconds(1), later)

        val oldClock = receivedAt.minusSeconds(600).plusMillis(fastBy)
        assertEquals(receivedAt.minusSeconds(600), next.correct(oldClock, later))
        // A record stamped by the corrected clock after the set is left alone; this
        // connection's 1 s read-back is noise and moves nothing.
        val newClock = receivedAt.plusSeconds(1_200)
        assertEquals(newClock, next.correct(newClock, later))
    }

    @Test
    fun `a slow ring clock is pushed forward but never past receipt`() {
        val corrector = RingClockCorrector()
        corrector.recordReadBack(receivedAt.minusSeconds(300), receivedAt)
        val raw = receivedAt.minusSeconds(400)
        assertEquals(receivedAt.minusSeconds(100), corrector.correct(raw, receivedAt))
        // Stamped by the new clock after the set: left alone, still clamped to receipt.
        assertEquals(receivedAt.minusSeconds(299), corrector.correct(receivedAt.minusSeconds(299), receivedAt))
        assertEquals(receivedAt, corrector.correct(receivedAt.plusSeconds(10), receivedAt))
    }

    @Test
    fun `without a read-back only the receipt clamp applies`() {
        val corrector = RingClockCorrector()
        assertNull(corrector.lastOffsetMs)
        assertEquals(receivedAt, corrector.correct(receivedAt.plusSeconds(400), receivedAt))
    }

    @Test
    fun `J-Style set and get time frames are vendor 16 byte BCD commands`() {
        val set = JStyle2301Protocol.setTime(LocalDateTime.of(2026, 10, 26, 16, 22, 33))
        assertEquals(16, set.size)
        assertArrayEquals(
            byteArrayOf(0x01, 0x26, 0x10, 0x26, 0x16, 0x22, 0x33),
            set.copyOfRange(0, 7),
        )
        assertEquals(set.take(15).sumOf { it.toInt() and 0xFF } and 0xFF, set[15].toInt() and 0xFF)
        val get = JStyle2301Protocol.getTime()
        assertEquals(0x41, get[0].toInt())
        assertEquals(0x41, get[15].toInt())
    }

    @Test
    fun `J-Style driver measures the read-back and corrects history it decodes after it`() {
        val utc = ZoneId.of("UTC")
        val store = MemoryStore()
        val driver = JStyle2301Driver(writer = null, zoneId = utc, now = { receivedAt })
        driver.configureClockStore(store)

        // Ring reports 10:59:03 while the phone says 10:52:33.
        val reply = ByteArray(16).also {
            it[0] = 0x41
            byteArrayOf(0x26, 0x10, 0x26, 0x10, 0x59, 0x03).copyInto(it, 1)
        }
        driver.ingest(reply, JStyle2301UUIDs.NOTIFY)
        assertEquals(listOf(RingClockSegment(receivedAt.toEpochMilli(), fastBy)), store.segments)

        val hr = ByteArray(10).also {
            it[0] = 0x55
            byteArrayOf(0x26, 0x10, 0x26, 0x10, 0x59, 0x00).copyInto(it, 3)
            it[9] = 96
        }
        val event = driver.ingest(hr, JStyle2301UUIDs.NOTIFY)
            .filterIsInstance<RingDecodedEvent.HistoryMeasurement>().single()
        assertEquals(Instant.parse("2026-10-26T10:52:30Z"), event._timestamp)
        assertTrue(!event._timestamp.isAfter(receivedAt))
    }

    @Test
    fun `J-Style engine reads then sets the clock once per connection and again on resync`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
        val engine = JStyle2301SyncEngine(
            writer, history, null, scope = this,
            localNow = { LocalDateTime.of(2026, 10, 26, 16, 22, 33) },
        )
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertEquals(listOf(0x13, 0x27, 0x41, 0x01, 0x51), writes.map { it[0].toInt() and 0xFF })
        assertEquals(0x16, writes[3][4].toInt())

        history.cancel()
        writes.clear()
        engine.runStartup()
        assertTrue(writes.none { (it[0].toInt() and 0xFF) in setOf(0x01, 0x41) })

        writes.clear()
        engine.resyncTime()
        assertEquals(listOf(0x41, 0x01), writes.map { it[0].toInt() and 0xFF })
        history.cancel()
    }
}
