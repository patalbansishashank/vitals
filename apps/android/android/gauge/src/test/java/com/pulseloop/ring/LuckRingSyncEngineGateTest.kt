package com.pulseloop.ring

import org.junit.Assert.*
import org.junit.Test

class LuckRingSyncEngineGateTest {
    private class Writer : RingCommandWriter {
        val sent = mutableListOf<ByteArray>()
        override fun enqueue(command: ByteArray) { sent += command.copyOf() }
    }

    @Test fun `warm pass skips binding and monitoring but preserves verified history query`() {
        val writer = Writer()
        val pager = LuckRingHistorySync(writer)
        val engine = LuckRingSyncEngine(writer, pager)
        try {
            engine.runStartup()
            val coldCount = writer.sent.size
            engine.runStartup()
            assertEquals("in-flight pass wins", coldCount, writer.sent.size)
            pager.cancel()
            writer.sent.clear()
            engine.runStartup()
            assertEquals(listOf(LuckRingDataType.BATTERY, LuckRingDataType.DEV_SYNC,
                LuckRingDataType.HISTORY_SPORT), writer.sent.map { it[5].toUByte() })
            engine.reset()
            writer.sent.clear()
            engine.runStartup()
            assertEquals(coldCount, writer.sent.size)
        } finally { engine.reset() }
    }
}
