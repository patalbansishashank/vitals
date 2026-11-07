package com.pulseloop.command

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CommandLedgerTest {
    private val dir: File = Files.createTempDirectory("ledger").toFile()
    private var now = 1_793_000_000_000L
    private fun ledger() = CommandLedger(File(dir, CommandLedger.FILE_NAME)) { now }

    @Test fun `ids and their acks survive a process restart`() {
        val first = ledger()
        first.begin("a-0000000000000001")
        first.finish("a-0000000000000001", CommandAck.done(null))
        first.begin("b-0000000000000002")

        val restarted = ledger()
        assertEquals(CommandAck.done(null), restarted.lookup("a-0000000000000001")?.ack)
        // noted before it ran, never answered: known, without an ack
        val begun = restarted.lookup("b-0000000000000002")
        assertNotNull(begun)
        assertNull(begun!!.ack)
        assertNull(restarted.lookup("c-0000000000000003"))
    }

    @Test fun `keeps at most 200 ids and 7 days`() {
        val l = ledger()
        repeat(205) { l.finish("id-$it-xxxxxxxxxxxx", CommandAck.expired) }
        assertEquals(200, l.size())
        assertNull(l.lookup("id-0-xxxxxxxxxxxx"))
        assertNotNull(l.lookup("id-204-xxxxxxxxxxxx"))
        now += CommandLedger.MAX_AGE_MS + 1
        l.finish("fresh-xxxxxxxxxxxxx", CommandAck.expired)
        assertEquals(1, ledger().size())
    }

    @Test fun `an unreadable file starts empty`() {
        File(dir, CommandLedger.FILE_NAME).writeText("{not json")
        assertNull(ledger().lookup("x"))
        assertEquals(0, ledger().size())
    }
}
