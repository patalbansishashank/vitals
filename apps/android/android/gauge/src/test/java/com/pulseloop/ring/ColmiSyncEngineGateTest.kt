package com.pulseloop.ring

import org.junit.Assert.*
import org.junit.Test

class ColmiSyncEngineGateTest {
    private class Writer : RingCommandWriter {
        val sent = mutableListOf<ByteArray>()
        override fun enqueue(command: ByteArray) { sent += command.copyOf() }
    }

    private fun configurationIgnoringClock(frames: List<ByteArray>): List<List<Byte>> = frames.map { frame ->
        // Reconnecting must repeat the configuration, but the clock command must carry the
        // new time. Preserve opcode, frame length and language while comparing non-clock bytes.
        frame.mapIndexed { index, value ->
            if (frame[0].toUByte() == ColmiCommandID.SET_DATE_TIME && index in 1..6) 0.toByte() else value
        }
    }

    private fun complete(engine: ColmiSyncEngine, full: Boolean) {
        fun day(op: UByte) { engine.handleHistoryFrame(byteArrayOf(op.toByte(), 0xff.toByte())) }
        repeat(if (full) 8 else 1) { day(ColmiCommandID.SYNC_ACTIVITY) }
        repeat(if (full) 8 else 1) { day(ColmiCommandID.SYNC_HEART_RATE) }
        repeat(if (full) 7 else 1) { day(ColmiCommandID.SYNC_STRESS) }
        engine.handleBigDataComplete(ColmiCommandID.BIG_DATA_SPO2)
        engine.handleBigDataComplete(ColmiCommandID.BIG_DATA_SLEEP)
        repeat(if (full) 7 else 1) { day(ColmiCommandID.SYNC_HRV) }
        engine.handleBigDataComplete(ColmiCommandID.BIG_DATA_TEMPERATURE)
    }

    @Test fun `completed cold pass becomes today only and reset restores full depth`() {
        val writer = Writer()
        val engine = ColmiSyncEngine(writer, ColmiDecoder)
        try {
            engine.runStartup()
            val coldPreamble = configurationIgnoringClock(writer.sent)
            complete(engine, full = true)
            val fullActivity = writer.sent.filter { it[0].toUByte() == ColmiCommandID.SYNC_ACTIVITY }
            assertEquals(8, fullActivity.size)
            writer.sent.clear()
            engine.runStartup()
            assertEquals(1, writer.sent.size) // No repeated configuration.
            complete(engine, full = false)
            for (op in listOf(ColmiCommandID.SYNC_ACTIVITY, ColmiCommandID.SYNC_HEART_RATE,
                ColmiCommandID.SYNC_STRESS, ColmiCommandID.SYNC_HRV)) {
                assertEquals("one current-day request for $op", 1, writer.sent.count { it[0].toUByte() == op })
            }
            assertTrue(writer.sent.any { it.contentEquals(ColmiEncoder.bigDataTemperature(days = 0)) })
            writer.sent.clear()
            engine.reset()
            engine.runStartup()
            assertEquals(coldPreamble, configurationIgnoringClock(writer.sent))
            complete(engine, full = true)
            assertEquals(8, writer.sent.count { it[0].toUByte() == ColmiCommandID.SYNC_ACTIVITY })
        } finally { engine.destroy() }
    }

    @Test fun `in flight startup does not restart the history walk`() {
        val writer = Writer()
        val engine = ColmiSyncEngine(writer, ColmiDecoder)
        try {
            engine.runStartup()
            val count = writer.sent.size
            engine.runStartup()
            assertEquals(count, writer.sent.size)
            engine.reset()
            writer.sent.clear()
            engine.runStartup()
            complete(engine, full = true)
            assertEquals(8, writer.sent.count { it[0].toUByte() == ColmiCommandID.SYNC_ACTIVITY })
        } finally { engine.destroy() }
    }
}
