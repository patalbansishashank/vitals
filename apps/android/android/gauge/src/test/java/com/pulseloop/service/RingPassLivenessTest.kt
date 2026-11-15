package com.pulseloop.service

import android.Manifest
import android.app.Application
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.PassReplyWatch
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDecodedEvent
import com.pulseloop.ring.RingSyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowApplication
import org.robolectric.util.ReflectionHelpers
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * (r087, A3) The whole path from a requested pass to a replaced link, on the real client and coordinator: a ring that
 * takes the request and never answers is reconnected; a ring that answers at all, a pass that was refused, a family
 * that promises no answer and a person who disconnected are all left alone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class,
    shadows = [TestMasterKeyBuilder::class, TestLegacyMasterKeys::class, TestEncryptedPreferences::class])
class RingPassLivenessTest {
    private class FakeEngine(
        override val answersEveryPass: Boolean = true,
        var busy: Boolean = false,
    ) : RingSyncEngine {
        var passes = 0
        var sleepReads = 0
        override val isHistorySyncRunning: Boolean get() = busy
        override fun syncSleepNow() { sleepReads++ }
        override fun refreshForeground(): Boolean {
            if (busy) return false
            passes++
            return true
        }
        override fun runStartup() { passes++ }
        override fun handle(event: RingDecodedEvent) {}
        override fun startHeartRate() {}
        override fun stopHeartRate() {}
        override fun startSpO2() {}
        override fun stopSpO2() {}
        override fun findDevice() {}
        override fun setGoal(steps: Int) {}
        override fun powerOff() {}
        override fun factoryReset() {}
    }

    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val address = "AA:BB:CC:DD:EE:07"
    private val window = PassReplyWatch.SILENCE_MS

    /** A client that believes it is connected to the saved ring, with [engine] as that ring's engine. */
    private fun TestScope.linked(engine: RingSyncEngine, body: (RingBLEClient, RingSyncCoordinator) -> Unit) {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        Shadows.shadowOf(context.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        val prefs = context.getSharedPreferences("ring_ble", 0)
        prefs.edit().putString("ring.lastPeripheralIdentifier", address).commit()
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        val client = RingBLEClient(context)
        val coordinator = RingSyncCoordinator(client, db)
        try {
            client.connectTo(address)
            ReflectionHelpers.setField(client, "activeSyncEngine", engine)
            ReflectionHelpers.getField<MutableStateFlow<RingBLEClient.BLEState>>(client, "_state")
                .update { it.copy(connectionState = RingConnectionState.CONNECTED) }
            body(client, coordinator)
        } finally {
            prefs.edit().clear().commit()
            coordinator.stop()
            client.destroy()
            db.close()
            Dispatchers.resetMain()
        }
    }

    private fun gatt(client: RingBLEClient): BluetoothGatt? = ReflectionHelpers.getField(client, "bluetoothGatt")
    private fun callback(client: RingBLEClient): BluetoothGattCallback {
        val generation = ReflectionHelpers.getField<AtomicLong>(client, "gattGeneration").get()
        return ReflectionHelpers.callInstanceMethod(client, "createGattCallback",
            ReflectionHelpers.ClassParameter.from(Long::class.javaPrimitiveType, generation))
    }
    private fun packet(client: RingBLEClient) = callback(client).onCharacteristicChanged(
        gatt(client)!!, BluetoothGattCharacteristic(UUID.randomUUID(), BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0))

    @Test fun `a ring that takes the pass and never answers is reconnected`() = runTest {
        val engine = FakeEngine()
        linked(engine) { client, coordinator ->
            val deaf = gatt(client)
            assertTrue(coordinator.refreshForeground())
            advanceTimeBy(window - 1)
            runCurrent()
            assertEquals(RingConnectionState.CONNECTED, client.state.value.connectionState)
            assertSame(deaf, gatt(client))

            advanceTimeBy(2)
            runCurrent()
            assertEquals(RingConnectionState.FAILED, client.state.value.connectionState)
            assertNull("the deaf link is closed", gatt(client))
            assertNotNull("and the saved ring is dialled again on the usual backoff", client.state.value.nextReconnectAt)

            advanceTimeBy(5_001)
            runCurrent()
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            assertNotSame(deaf, gatt(client))
        }
    }

    @Test fun `a ring that answers late, and then trickles for minutes, keeps its link`() = runTest {
        val engine = FakeEngine()
        linked(engine) { client, coordinator ->
            val link = gatt(client)
            assertTrue(coordinator.refreshForeground())
            advanceTimeBy(window - 100)
            packet(client)
            repeat(10) { advanceTimeBy(12_000); packet(client) }
            runCurrent()
            assertEquals(RingConnectionState.CONNECTED, client.state.value.connectionState)
            assertSame(link, gatt(client))
        }
    }

    @Test fun `a manual Sync is watched the same way`() = runTest {
        val engine = FakeEngine()
        linked(engine) { client, coordinator ->
            coordinator.syncNow()
            assertEquals(1, engine.passes)
            advanceTimeBy(window + 1)
            runCurrent()
            assertEquals(RingConnectionState.FAILED, client.state.value.connectionState)
        }
    }

    @Test fun `a pass the engine itself declines starts no wait`() = runTest {
        // Not busy, so the coordinator lets it through; the engine refuses (a ring that is not authenticated yet).
        val engine = object : RingSyncEngine by FakeEngine() {
            override val answersEveryPass: Boolean get() = true
            override fun refreshForeground(): Boolean = false
        }
        linked(engine) { client, coordinator ->
            assertFalse(coordinator.refreshForeground())
            advanceTimeBy(window * 3)
            runCurrent()
            assertEquals(RingConnectionState.CONNECTED, client.state.value.connectionState)
        }
    }

    @Test fun `a pass that was refused starts no wait`() = runTest {
        val engine = FakeEngine(busy = true)
        linked(engine) { client, coordinator ->
            assertFalse(coordinator.refreshForeground())
            coordinator.syncNow()
            advanceTimeBy(window * 3)
            runCurrent()
            assertEquals(0, engine.passes)
            assertEquals(RingConnectionState.CONNECTED, client.state.value.connectionState)
        }
    }

    @Test fun `a family that promises no answer is never judged by silence`() = runTest {
        val engine = FakeEngine(answersEveryPass = false)
        linked(engine) { client, coordinator ->
            assertTrue(coordinator.refreshForeground())
            advanceTimeBy(window * 3)
            runCurrent()
            assertEquals(RingConnectionState.CONNECTED, client.state.value.connectionState)
        }
    }

    @Test fun `the sleep read says whether it was sent`() = runTest {
        val engine = FakeEngine()
        linked(engine) { client, coordinator ->
            assertTrue(coordinator.syncSleepNow())
            assertEquals(1, engine.sleepReads)
            // During a pass the read would be lost, so it is not sent and not counted as done (A12's cadence).
            engine.busy = true
            assertFalse(coordinator.syncSleepNow())
            assertEquals(1, engine.sleepReads)
            engine.busy = false
            client.disconnect()
            assertFalse(coordinator.syncSleepNow())
            assertEquals(1, engine.sleepReads)
        }
    }

    @Test fun `Disconnect during the wait stays disconnected`() = runTest {
        val engine = FakeEngine()
        linked(engine) { client, coordinator ->
            assertTrue(coordinator.refreshForeground())
            advanceTimeBy(window / 2)
            client.userDisconnect()
            advanceTimeBy(window * 10)
            runCurrent()
            assertEquals(RingConnectionState.DISCONNECTED, client.state.value.connectionState)
            assertNull(gatt(client))
            assertNull(client.state.value.nextReconnectAt)
        }
    }
}
