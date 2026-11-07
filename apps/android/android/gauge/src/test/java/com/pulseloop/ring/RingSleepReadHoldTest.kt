package com.pulseloop.ring

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * r069: a sleep read closes the J-Style 2301's open sleep record, and the ring names REM only deeper
 * into an unbroken one (2026-10-29: 13 records, one per 30-min pass, no REM). Passes inside the usual
 * sleep window leave sleep alone unless the phone is in use or Vitals asked.
 */
class RingSleepReadHoldTest {
    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(d: Int, h: Int, m: Int) = ZonedDateTime.of(2026, 10, d, h, m, 0, 0, zone).toInstant()
    private fun night(d: Int, bedH: Int, bedM: Int, wakeH: Int, wakeM: Int) =
        at(d, bedH, bedM).toEpochMilli() to at(d + 1, wakeH, wakeM).toEpochMilli()

    @After fun reset() {
        RingSleepReadHold.window = RingSleepReadHold.DEFAULT
        RingSleepReadHold.interactive = { true }
        RingSleepReadHold.request(0)
    }

    @Test fun `the usual window comes from the median night, across midnight`() {
        val w = RingSleepReadHold.learn(
            listOf(night(24, 22, 52, 6, 50), night(25, 22, 34, 7, 17), night(26, 21, 40, 4, 36), night(27, 21, 56, 6, 4)),
            zone,
        )
        // median bedtime 21:56 (lower middle) less 30 min; median wake 06:04 plus 60 min
        assertEquals(RingSleepReadHold.Window(21 * 60 + 26, 7 * 60 + 4), w)
        assertTrue(w.contains(23 * 60))
        assertTrue(w.contains(3 * 60))
        assertFalse(w.contains(12 * 60))
        assertFalse(w.contains(7 * 60 + 4))
    }

    @Test fun `too few long nights keep the default window`() {
        assertEquals(RingSleepReadHold.DEFAULT, RingSleepReadHold.learn(listOf(night(24, 22, 0, 6, 0), night(25, 22, 0, 6, 0)), zone))
        val naps = listOf(1, 2, 3).map { at(20 + it, 14, 0).toEpochMilli() to at(20 + it, 15, 0).toEpochMilli() }
        assertEquals(RingSleepReadHold.DEFAULT, RingSleepReadHold.learn(naps, zone))
    }

    @Test fun `inside the window an idle phone defers sleep, in use or asked it reads`() {
        RingSleepReadHold.window = RingSleepReadHold.Window(21 * 60 + 30, 7 * 60)
        var inUse = false
        RingSleepReadHold.interactive = { inUse }
        assertFalse(RingSleepReadHold.mayRead(at(29, 2, 0), zone))
        assertTrue("daytime", RingSleepReadHold.mayRead(at(29, 12, 0), zone))
        inUse = true
        assertTrue("the person is up and using the phone", RingSleepReadHold.mayRead(at(29, 2, 0), zone))
        inUse = false
        RingSleepReadHold.request(at(29, 2, 0).toEpochMilli())
        assertTrue("Vitals asked", RingSleepReadHold.mayRead(at(29, 2, 4), zone))
        assertFalse("the request expires", RingSleepReadHold.mayRead(at(29, 2, 6), zone))
    }

    @Test fun `automatic foreground passes leave the open night alone even with screen on`() {
        RingSleepReadHold.window = RingSleepReadHold.Window(21 * 60, 9 * 60)
        RingSleepReadHold.interactive = { true }
        RingSleepReadHold.request(at(29, 2, 0).toEpochMilli())
        assertFalse(RingSleepReadHold.mayReadUnattended(at(29, 2, 1), zone))
        assertTrue(RingSleepReadHold.mayReadUnattended(at(29, 10, 0), zone))
    }

    @Test fun `the 2301 driver sends no sleep request while sleep is held`() {
        val sent = mutableListOf<ByteArray>()
        var may = false
        val driver = JStyle2301Driver(writer = RingCommandWriter { sent += it }, zoneId = ZoneId.of("UTC"),
            now = { Instant.parse("2026-10-28T20:00:00Z") }, cursorStore = InMemoryJStyle2301HistoryCursorStore(), mayReadSleep = { may })
        val engine = driver.makeSyncEngine()
        // a firmware reply makes the link ready (a profile without authentication)
        driver.ingest(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05), "fff7").forEach(engine::handle)
        val sleep = { sent.count { it.isNotEmpty() && it[0].toInt() and 0xFF == JStyle2301HistoryStream.SLEEP.opcode } }

        engine.querySleep()
        assertEquals(0, sleep())
        may = true
        engine.querySleep()
        assertEquals(1, sleep())
    }
}
