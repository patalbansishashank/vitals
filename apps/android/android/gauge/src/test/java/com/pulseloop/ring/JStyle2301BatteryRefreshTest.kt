package com.pulseloop.ring

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/**
 * 0.6.4: the ring never pushes its battery, so every sync pass must ask for it. It used to be asked only while the link
 * was not yet ready (once per connection), and a ring that stayed connected showed the same percent for a week.
 */
class JStyle2301BatteryRefreshTest {
    @Test fun `every sync pass asks for the battery, also on a ready link`() {
        val sent = mutableListOf<ByteArray>()
        val driver = JStyle2301Driver(writer = RingCommandWriter { sent += it }, zoneId = java.time.ZoneId.of("UTC"),
            now = { Instant.parse("2026-10-28T06:00:00Z") }, cursorStore = InMemoryJStyle2301HistoryCursorStore())
        val engine = driver.makeSyncEngine()
        val battery = { sent.count { it.isNotEmpty() && it[0].toInt() and 0xFF == JStyle2301Protocol.INFO_BATTERY } }

        engine.runStartup()
        assertEquals("the first pass asks", 1, battery())
        // the firmware reply makes the link ready (a profile without authentication, as in the cursor test)
        driver.ingest(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05), "fff7").forEach(engine::handle)

        engine.refresh()
        assertEquals("a later pass on the ready link asks again", 2, battery())
        engine.syncVitalsHistory()
        assertEquals("so does a vitals-only pass", 3, battery())
    }
}
