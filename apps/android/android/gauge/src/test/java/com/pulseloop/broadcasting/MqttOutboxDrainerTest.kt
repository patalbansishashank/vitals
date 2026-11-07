package com.pulseloop.broadcasting

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.yield
import org.eclipse.paho.client.mqttv3.MqttException
import org.eclipse.paho.client.mqttv3.MqttSecurityException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MqttOutboxDrainerTest {
    private val settings = MqttBroadcastSettings(
        enabled = true,
        brokerUri = "ssl://broker.example:8883",
        baseTopic = "lumen-health/v1",
        clientId = "test-client",
        username = "",
        password = "",
    )

    @Test
    fun `pipelines acknowledgements and compacts one receipt batch per inflight window`() = runBlocking {
        val dao = FakeBroadcastOutboxDao((0 until 23).map(::outboxRow))
        val published = mutableListOf<String>()
        val session = FakeSession { _, payload ->
            published += payload.toString(Charsets.UTF_8)
            yield() // a scheduler may resume these in any order; Paho calls still began in order.
        }

        val result = MqttOutboxDrainer(dao, now = { 1234L }).drain(session, settings, "install")

        assertEquals(BroadcastDrainResult.Success(23), result)
        assertEquals((0 until 23).map(Int::toString), published)
        assertEquals(listOf(10, 10, 3), dao.publishedBatches.map(List<String>::size))
        assertTrue(dao.rows.values.all { it.publishedAt == 1234L && it.payloadJson.isEmpty() })
    }

    @Test
    fun `mid batch failure preserves successful subset and leaves failures pending`() = runBlocking {
        val dao = FakeBroadcastOutboxDao((0 until 10).map(::outboxRow))
        val session = FakeSession { _, payload ->
            if (payload.toString(Charsets.UTF_8).toInt() in setOf(3, 7)) throw IOException("offline")
        }

        val result = MqttOutboxDrainer(dao, now = { 99L }).drain(session, settings, "install")

        assertTrue(result is BroadcastDrainResult.Retry)
        assertEquals(8, (result as BroadcastDrainResult.Retry).published)
        assertEquals(listOf("event-0003", "event-0007"), dao.pending(20).map { it.eventId })
        assertTrue(dao.rows.getValue("event-0000").payloadJson.isEmpty())
        assertFalse(dao.rows.getValue("event-0003").payloadJson.isEmpty())
        assertEquals(1, dao.rows.getValue("event-0003").attemptCount)
    }

    @Test
    fun `caps one drain at two thousand and immediately reports remaining work`() = runBlocking {
        val dao = FakeBroadcastOutboxDao((0 until 2_050).map(::outboxRow))
        val result = MqttOutboxDrainer(dao).drain(FakeSession(), settings, "install")

        assertEquals(BroadcastDrainResult.Success(2_000, hasMore = true), result)
        assertEquals(50, dao.pendingCount())
    }

    @Test
    fun `disabled invalid empty and permanent branches remain distinct`() = runBlocking {
        val emptyDao = FakeBroadcastOutboxDao()
        val drainer = MqttOutboxDrainer(emptyDao)
        assertEquals(
            BroadcastDrainResult.Disabled,
            drainer.drain(FakeSession(), settings.copy(enabled = false), "install"),
        )
        assertTrue(
            drainer.drain(FakeSession(), settings.copy(brokerUri = "not a uri"), "install")
                is BroadcastDrainResult.InvalidConfiguration,
        )
        assertEquals(BroadcastDrainResult.Empty, drainer.drain(FakeSession(), settings, "install"))

        val authDao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val auth = FakeSession { _, _ ->
            throw MqttException(MqttException.REASON_CODE_NOT_AUTHORIZED.toInt())
        }
        val result = MqttOutboxDrainer(authDao).drain(auth, settings, "install")
        assertTrue(result is BroadcastDrainResult.PermanentFailure)
        assertEquals(PermanentFailureKind.AUTHENTICATION, (result as BroadcastDrainResult.PermanentFailure).kind)
        assertEquals(
            MqttFailureClassification.Permanent(PermanentFailureKind.AUTHENTICATION),
            classifyMqttFailure(MqttSecurityException(IOException("security provider"))),
        )
    }

    @Test
    fun `lost acknowledgement is bounded while successful siblings are retained`() = runBlocking {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(0), outboxRow(1)))
        val session = FakeSession { _, payload ->
            if (payload.toString(Charsets.UTF_8) == "1") {
                suspendCancellableCoroutine<Unit> { }
            }
        }
        val result = MqttOutboxDrainer(
            dao = dao,
            maxDrainMillis = 20,
        ).drain(session, settings, "install")

        assertTrue(result is BroadcastDrainResult.Retry)
        assertEquals(1, (result as BroadcastDrainResult.Retry).published)
        assertTrue(dao.rows.getValue("event-0000").payloadJson.isEmpty())
        assertFalse(dao.rows.getValue("event-0001").payloadJson.isEmpty())
    }

    @Test
    fun `external cancellation is never converted into a retry`() = runBlocking {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(0)))
        val session = FakeSession { _, _ -> throw CancellationException("parent cancelled") }
        try {
            MqttOutboxDrainer(dao).drain(session, settings, "install")
            throw AssertionError("Expected cancellation")
        } catch (expected: CancellationException) {
            assertEquals("parent cancelled", expected.message)
        }
    }

    private class FakeSession(
        private val action: suspend (String, ByteArray) -> Unit = { _, _ -> },
    ) : MqttPublishSession {
        override val isConnected = true
        override suspend fun publish(topic: String, payload: ByteArray, qos: Int, retained: Boolean) {
            action(topic, payload)
        }
        override suspend fun close() = Unit
    }
}
