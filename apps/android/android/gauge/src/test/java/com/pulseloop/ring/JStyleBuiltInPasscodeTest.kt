package com.pulseloop.ring

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JStyleBuiltInPasscodeTest {
    private val dummyBuiltIn = { "TEST1234".toByteArray(Charsets.US_ASCII) }

    @Test fun builtInBytesHaveValidShapeAndAccessorReturnsACopy() {
        val first = JStyle2301Passcode.bytes()
        assertTrue(first.size in 1..14)
        assertTrue(first.all { (it.toInt() and 0xFF) in 0x20..0x7E })
        val original = first[0]
        first[0] = 0
        assertEquals(original, JStyle2301Passcode.bytes()[0])
    }

    @Test fun missingStoredOverrideUsesBuiltInAndStartsHistoryOnlyAfterAcceptance() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it.copyOf() }
        val engine = JStyle2301SyncEngine(writer, JStyle2301HistorySync(writer), firmwarePasscode = dummyBuiltIn)
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(1, sent.count { (it[0].toInt() and 0xFF) == JStyle2301Protocol.AUTHENTICATE })
        assertFalse(sent.any { (it[0].toInt() and 0xFF) == JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode })
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertTrue(sent.any { (it[0].toInt() and 0xFF) == JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode })
        assertFalse(engine.credentialAuthenticationFailed)
    }

    @Test fun rejectedStoredOverrideTriesBuiltInOnceThenReportsOnlyFinalFailure() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it.copyOf() }
        val engine = JStyle2301SyncEngine(writer, JStyle2301HistorySync(writer), "OLD12345", firmwarePasscode = dummyBuiltIn)
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertFalse(engine.credentialAuthenticationFailed)
        assertEquals(2, sent.count { (it[0].toInt() and 0xFF) == JStyle2301Protocol.AUTHENTICATE })
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertTrue(engine.credentialAuthenticationFailed)
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertEquals(2, sent.count { (it[0].toInt() and 0xFF) == JStyle2301Protocol.AUTHENTICATE })
    }

    @Test fun matchingStoredOverrideIsNotRetriedWithIdenticalBuiltInBytes() {
        val sent = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { sent += it.copyOf() }
        val engine = JStyle2301SyncEngine(writer, JStyle2301HistorySync(writer), "TEST1234", firmwarePasscode = dummyBuiltIn)
        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        engine.handle(RingDecodedEvent.AuthenticationResult(false))
        assertTrue(engine.credentialAuthenticationFailed)
        assertEquals(1, sent.count { (it[0].toInt() and 0xFF) == JStyle2301Protocol.AUTHENTICATE })
    }
}
