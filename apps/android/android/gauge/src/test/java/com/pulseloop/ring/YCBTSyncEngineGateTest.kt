package com.pulseloop.ring

import org.junit.Assert.*
import org.junit.Test

class YCBTSyncEngineGateTest {
    private class Writer : RingCommandWriter {
        val sent = mutableListOf<ByteArray>()
        override fun enqueue(command: ByteArray) { sent += command.copyOf() }
    }

    private fun complete(writer: Writer, transfer: YCBTHistoryTransfer, engine: YCBTSyncEngine): List<Int> {
        val queries = mutableListOf<Int>()
        while (transfer.isActive) {
            val query = writer.sent.last { it.size == 2 && it[0] == YCBTGroup.HEALTH.toByte() }
            val key = query[1].toInt() and 255
            queries += key
            transfer.handle(key, byteArrayOf(0)).forEach(engine::handle)
        }
        return queries
    }

    @Test fun `warm pass omits configuration but preserves supported whole-type history requests`() {
        val writer = Writer()
        val transfer = YCBTHistoryTransfer(writer)
        val engine = YCBTSyncEngine(writer, transfer)
        try {
            engine.runStartup()
            val preamble = writer.sent.map { it.toList() }
            val coldTypes = complete(writer, transfer, engine)
            writer.sent.clear()
            engine.runStartup()
            assertArrayEquals(YCBTEncoder().enableLiveStatus(), writer.sent.first())
            assertEquals(2, writer.sent.size)
            assertEquals(coldTypes, complete(writer, transfer, engine))
            engine.reset()
            writer.sent.clear()
            engine.runStartup()
            assertEquals(preamble, writer.sent.map { it.toList() })
        } finally { engine.reset() }
    }

    @Test fun `reentrant startup sends no additional configuration or history`() {
        val writer = Writer()
        val transfer = YCBTHistoryTransfer(writer)
        val engine = YCBTSyncEngine(writer, transfer)
        try {
            engine.runStartup()
            val count = writer.sent.size
            engine.runStartup()
            assertEquals(count, writer.sent.size)
        } finally { engine.reset() }
    }
}
