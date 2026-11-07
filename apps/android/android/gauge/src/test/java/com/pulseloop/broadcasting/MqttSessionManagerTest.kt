package com.pulseloop.broadcasting

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.eclipse.paho.client.mqttv3.MqttException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MqttSessionManagerTest {
    private val enabled = MqttBroadcastSettings(
        enabled = true,
        brokerUri = "ssl://broker.example:8883",
        baseTopic = "lumen-health/v1",
        clientId = "test-client",
        username = "",
        password = "",
        revision = 1,
    )

    @Test
    fun `opens on first row and stays connected while ring is connected`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val source = FakeSettingsSource(enabled)
        val scheduler = FakeRecoveryScheduler()
        val factory = FakeFactory()
        val manager = MqttSessionManager(backgroundScope, source, dao, scheduler, factory)

        manager.setRingConnected(true)
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()

        assertEquals(1, factory.connects)
        assertEquals(0, dao.pendingCount())
        assertEquals(BroadcastSessionState.Connected, manager.state.value)
        advanceTimeBy(MqttSessionManager.IDLE_TIMEOUT_MS * 2)
        runCurrent()
        assertFalse(factory.sessions.single().closed)
    }

    @Test
    fun `closes after five idle minutes when ring is disconnected`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val factory = FakeFactory()
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            factory,
        )
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()

        assertTrue(manager.state.value is BroadcastSessionState.IdleTimeout)
        advanceTimeBy(MqttSessionManager.IDLE_TIMEOUT_MS)
        runCurrent()
        assertTrue(factory.sessions.single().closed)
        assertEquals(BroadcastSessionState.Idle, manager.state.value)
    }

    @Test
    fun `network availability drains an offline backlog without a new event`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val factory = FakeFactory()
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            factory,
        )
        manager.requestFlush()
        runCurrent()
        assertEquals(BroadcastSessionState.NoNetwork, manager.state.value)
        assertEquals(0, factory.connects)

        manager.setNetworkAvailableForTest(true)
        runCurrent()
        assertEquals(1, factory.connects)
        assertEquals(0, dao.pendingCount())
    }

    @Test
    fun `permanent failure attempts exactly once until settings revision changes`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val source = FakeSettingsSource(enabled)
        val factory = FakeFactory(
            connectFailure = MqttException(MqttException.REASON_CODE_NOT_AUTHORIZED.toInt()),
        )
        val scheduler = FakeRecoveryScheduler()
        val manager = MqttSessionManager(
            backgroundScope,
            source,
            dao,
            scheduler,
            factory,
        )
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()
        assertEquals(1, factory.connects)
        assertTrue(manager.state.value is BroadcastSessionState.Stopped)
        manager.setNetworkAvailableForTest(false)
        runCurrent()
        assertTrue(manager.state.value is BroadcastSessionState.Stopped)
        assertFalse(scheduler.scheduled)

        repeat(3) { manager.requestFlush() }
        manager.onProcessForeground()
        runCurrent()
        assertEquals(1, factory.connects)

        source.mutableSettings.value = enabled.copy(revision = 2)
        manager.setNetworkAvailableForTest(true)
        runCurrent()
        assertEquals(2, factory.connects)
        assertTrue(manager.state.value is BroadcastSessionState.Stopped)
    }

    @Test
    fun `live rows and foreground edges cannot bypass an active transient backoff`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val factory = FakeFactory(connectFailure = java.io.IOException("refused"))
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            factory,
            backoff = MqttRetryBackoff { 0.5 },
        )
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()
        assertEquals(1, factory.connects)
        assertTrue(manager.state.value is BroadcastSessionState.Retrying)

        dao.enqueue(outboxRow(2))
        repeat(4) { manager.requestFlush() }
        manager.onProcessForeground()
        runCurrent()
        assertEquals(1, factory.connects)

        advanceTimeBy(10_000)
        runCurrent()
        assertEquals(2, factory.connects)
    }

    @Test
    fun `rehydrated permanent error starts stopped and stale callbacks are ignored`() = runTest {
        val source = FakeSettingsSource(enabled).apply {
            mutableError.value = "not authorised"
            mutableFailureKind.value = PermanentFailureKind.AUTHENTICATION
        }
        val blocked = MqttSessionManager(
            backgroundScope,
            source,
            FakeBroadcastOutboxDao(listOf(outboxRow(1))),
            FakeRecoveryScheduler(),
            FakeFactory(),
        )
        assertEquals(
            BroadcastSessionState.Stopped("not authorised", PermanentFailureKind.AUTHENTICATION),
            blocked.state.value,
        )

        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(2)))
        val activeSource = FakeSettingsSource(enabled)
        val factory = FakeFactory()
        val active = MqttSessionManager(
            backgroundScope,
            activeSource,
            dao,
            FakeRecoveryScheduler(),
            factory,
        )
        active.setRingConnected(true)
        active.setNetworkAvailableForTest(true)
        active.requestFlush()
        runCurrent()
        val oldEvents = factory.events.single()
        dao.enqueue(outboxRow(3))
        activeSource.mutableSettings.value = enabled.copy(revision = 2)
        runCurrent()
        assertEquals(2, factory.connects)
        assertEquals(BroadcastSessionState.Connected, active.state.value)

        oldEvents.connectionLost(java.io.IOException("late callback"))
        oldEvents.connectComplete(reconnect = true)
        runCurrent()
        assertEquals(BroadcastSessionState.Connected, active.state.value)
    }

    @Test
    fun `ring disconnect releases a paho client that is automatically reconnecting`() = runTest {
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val factory = FakeFactory()
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            factory,
        )
        manager.setRingConnected(true)
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()
        val session = factory.sessions.single()
        session.connected = false
        factory.events.single().connectionLost(java.io.IOException("socket lost"))
        manager.setRingConnected(false)
        runCurrent()

        assertTrue(session.closed)
        assertEquals(BroadcastSessionState.Idle, manager.state.value)
    }

    @Test
    fun `one dao failure does not terminate the session command actor`() = runTest {
        val dao = object : FakeBroadcastOutboxDao(listOf(outboxRow(1))) {
            var failNext = true
            override suspend fun pendingCount(): Int {
                if (failNext) {
                    failNext = false
                    throw java.io.IOException("temporary sqlite failure")
                }
                return super.pendingCount()
            }
        }
        val factory = FakeFactory()
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            factory,
            backoff = MqttRetryBackoff { 0.5 },
        )
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()

        // A later command is still consumed and drains the row; the actor did not die.
        advanceTimeBy(10_000)
        manager.requestFlush()
        runCurrent()
        assertEquals(1, factory.connects)
        assertEquals(0, dao.pendingCount())
    }

    @Test
    fun `flush requests are coalesced while one is already queued`() = runTest {
        val dao = object : FakeBroadcastOutboxDao() {
            var pendingChecks = 0
            override suspend fun pendingCount(): Int {
                pendingChecks++
                return super.pendingCount()
            }
        }
        val manager = MqttSessionManager(
            backgroundScope,
            FakeSettingsSource(enabled),
            dao,
            FakeRecoveryScheduler(),
            FakeFactory(),
        )
        manager.setNetworkAvailableForTest(true)
        runCurrent()
        dao.pendingChecks = 0

        repeat(1_000) { manager.requestFlush() }
        runCurrent()

        assertEquals(1, dao.pendingChecks)
    }

    @Test
    fun `auth refusal from old in flight settings cannot stop the new revision`() = runTest {
        val source = FakeSettingsSource(enabled)
        val dao = FakeBroadcastOutboxDao(listOf(outboxRow(1)))
        val releaseFirstConnect = CompletableDeferred<Unit>()
        var attempts = 0
        val factory = MqttSessionFactory { _, _ ->
            attempts++
            if (attempts == 1) {
                releaseFirstConnect.await()
                throw MqttException(MqttException.REASON_CODE_NOT_AUTHORIZED.toInt())
            }
            FakeSession()
        }
        val manager = MqttSessionManager(
            backgroundScope,
            source,
            dao,
            FakeRecoveryScheduler(),
            factory,
        )
        manager.setRingConnected(true)
        manager.setNetworkAvailableForTest(true)
        manager.requestFlush()
        runCurrent()
        assertEquals(1, attempts)

        source.mutableSettings.value = enabled.copy(password = "new", revision = 2)
        releaseFirstConnect.complete(Unit)
        runCurrent()

        assertEquals(2, attempts)
        assertEquals(null, source.mutableError.value)
        assertEquals(BroadcastSessionState.Connected, manager.state.value)
        assertEquals(0, dao.pendingCount())
    }

    @Test
    fun `backoff starts at ten seconds is jittered and caps at five minutes`() {
        val low = MqttRetryBackoff { 0.0 }
        assertEquals(8_000L, low.nextDelayMillis())
        val high = MqttRetryBackoff { 1.0 }
        assertEquals(12_000L, high.nextDelayMillis())
        repeat(20) { high.nextDelayMillis() }
        assertEquals(MqttRetryBackoff.MAX_MS, high.nextDelayMillis())
        high.reset()
        assertEquals(12_000L, high.nextDelayMillis())
    }

    private class FakeRecoveryScheduler : BroadcastRecoveryScheduler {
        var scheduled = false
        override fun schedule() { scheduled = true }
        override fun cancel() { scheduled = false }
    }

    private class FakeFactory(
        private val connectFailure: Throwable? = null,
    ) : MqttSessionFactory {
        var connects = 0
        val sessions = mutableListOf<FakeSession>()
        val events = mutableListOf<MqttSessionEvents>()
        override suspend fun connect(
            settings: MqttBroadcastSettings,
            events: MqttSessionEvents,
        ): MqttPublishSession {
            connects++
            this.events += events
            connectFailure?.let { throw it }
            return FakeSession().also(sessions::add)
        }
    }

    private class FakeSession : MqttPublishSession {
        var closed = false
        var connected = true
        override val isConnected: Boolean get() = connected && !closed
        override suspend fun publish(topic: String, payload: ByteArray, qos: Int, retained: Boolean) = Unit
        override suspend fun close() { closed = true }
    }
}
