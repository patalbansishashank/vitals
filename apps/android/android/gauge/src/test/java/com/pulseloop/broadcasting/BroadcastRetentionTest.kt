package com.pulseloop.broadcasting

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BroadcastRetentionTest {
    @Test
    fun `prunes delivered and undelivered rows older than thirty day cutoff`() = runBlocking {
        val cutoff = 1_000L
        val oldDelivered = outboxRow(1, 100).copy(payloadJson = "", publishedAt = 200)
        val recentDelivered = outboxRow(2, 100).copy(payloadJson = "", publishedAt = cutoff)
        val oldPending = outboxRow(3, 999)
        val recentPending = outboxRow(4, cutoff)
        val dao = FakeBroadcastOutboxDao(
            listOf(oldDelivered, recentDelivered, oldPending, recentPending),
        )

        assertEquals(2, dao.pruneOlderThan(cutoff))
        assertEquals(setOf("event-0002", "event-0004"), dao.rows.keys)
        assertTrue(dao.rows.getValue("event-0002").payloadJson.isEmpty())
    }
}
