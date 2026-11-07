package com.pulseloop.ring

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JStyleForegroundRefreshTest {
    @Test fun automaticPassIsBoundedToOnePageEvenBeforeArchiveIsDrained() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it }
        val history = JStyle2301HistorySync(writer,
            cursorStore = InMemoryJStyle2301HistoryCursorStore(), progressSink = {})
        history.start(listOf(JStyle2301HistoryStream.ACTIVITY_TOTAL), pageLimit = 1, forceShallow = true)
        repeat(50) { history.notePacket(byteArrayOf(JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode.toByte(), 0)) }
        assertFalse(history.isRunning)
        assertTrue(sent.count { it.firstOrNull()?.toInt()?.and(0xFF) == JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode } == 1)
    }

    @Test fun missingV0789CredentialDoesNotStartRepeatedAutomaticHistory() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it }
        val engine = JStyle2301SyncEngine(writer, JStyle2301HistorySync(writer), firmwarePasscode = { byteArrayOf() })
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertFalse(engine.refreshForeground())
        assertTrue(sent.isEmpty())
    }

    @Test fun knownOlderFirmwareCanStartAOnePagePassButNotOverlapIt() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it }
        val engine = JStyle2301SyncEngine(writer, JStyle2301HistorySync(writer), mayReadSleepUnattended = { false })
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertTrue(engine.refreshForeground())
        assertTrue(engine.isHistorySyncRunning)
        assertFalse(engine.refreshForeground())
        assertTrue(sent.any { it.firstOrNull()?.toInt()?.and(0xFF) == JStyle2301Protocol.INFO_BATTERY })
    }

    @Test fun explicitManualRefreshKeepsUndrainedCursorBackfill() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it }
        val history = JStyle2301HistorySync(writer,
            cursorStore = InMemoryJStyle2301HistoryCursorStore(), progressSink = {})
        val engine = JStyle2301SyncEngine(writer, history)
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        engine.refresh()
        // The undrained first stream is deliberately last in the plan. Complete each
        // shallow stream so its first page can prove whether the deep continuation remains.
        for (stream in JStyle2301HistorySync.catalog - JStyle2301HistoryStream.ACTIVITY_TOTAL) {
            history.notePacket(byteArrayOf(stream.opcode.toByte(), 0xFF.toByte()))
        }
        repeat(50) { history.notePacket(byteArrayOf(JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode.toByte(), 0)) }
        assertTrue(history.isRunning)
        assertTrue(sent.any { it.firstOrNull()?.toInt()?.and(0xFF) == JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode && it.getOrNull(1)?.toInt() == 2 })
    }

    @Test fun unattendedDeepRecoveryHoldsSleepEvenWhenManualRefreshCouldReadIt() {
        fun requested(manual: Boolean): List<Int> {
            val sent = mutableListOf<ByteArray>()
            val writer = RingCommandWriter { sent += it }
            val history = JStyle2301HistorySync(writer,
                cursorStore = InMemoryJStyle2301HistoryCursorStore(), progressSink = {})
            val engine = JStyle2301SyncEngine(writer, history,
                mayReadSleep = { true }, mayReadSleepUnattended = { false })
            engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
            if (manual) engine.refresh() else engine.refreshUnattendedBackfill()
            for (stream in JStyle2301HistorySync.catalog - JStyle2301HistoryStream.ACTIVITY_TOTAL) {
                if (stream != JStyle2301HistoryStream.SLEEP || manual) {
                    history.notePacket(byteArrayOf(stream.opcode.toByte(), 0xFF.toByte()))
                }
            }
            return sent.map { it[0].toInt() and 0xFF }
        }
        assertFalse(requested(false).contains(JStyle2301HistoryStream.SLEEP.opcode))
        assertTrue(requested(true).contains(JStyle2301HistoryStream.SLEEP.opcode))
    }
}
