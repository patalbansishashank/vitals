package com.pulseloop.service

import android.Manifest
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingConnectionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowApplication
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.atomic.AtomicLong

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class,
    shadows = [TestMasterKeyBuilder::class, TestLegacyMasterKeys::class, TestEncryptedPreferences::class])
class RingBluetoothObserverTest {
    private class Fixture {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val adapter = app.getSystemService(BluetoothManager::class.java).adapter
        val prefs = app.getSharedPreferences("ring_ble", 0)
        var foreground = true
        var hostedLink = false
        val client: RingBLEClient
        val observer: RingBluetoothObserver
        init {
            ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
            Shadows.shadowOf(adapter).setEnabled(false)
            prefs.edit().clear().putString("ring.lastPeripheralIdentifier", "AA:BB:CC:DD:EE:05").commit()
            client = RingBLEClient(app)
            observer = RingBluetoothObserver(app, client) { foreground || hostedLink }
            observer.start()
        }
        fun event(state: Int) {
            Shadows.shadowOf(adapter).setEnabled(state == BluetoothAdapter.STATE_ON)
            app.sendBroadcast(Intent(BluetoothAdapter.ACTION_STATE_CHANGED).putExtra(BluetoothAdapter.EXTRA_STATE, state))
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        fun gatt(): BluetoothGatt? = ReflectionHelpers.getField(client, "bluetoothGatt")
        fun close() { observer.stop(); client.destroy(); prefs.edit().clear().commit() }
    }

    private fun checkCase(block: suspend TestScope.(Fixture) -> Unit) = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val fixture = Fixture()
        try { block(fixture) } finally { fixture.close(); Dispatchers.resetMain() }
    }

    @Test fun foregroundWithNoServiceConnectsAfterBluetoothEnabledAndAfterAnotherToggle() = checkCase { f ->
        // App opened with Bluetooth off: foreground reconnect cannot start a GATT.
        f.client.reconnectIfNeeded()
        assertNull(f.gatt())
        f.event(BluetoothAdapter.STATE_ON)
        val first = f.gatt()
        assertNotNull(first)
        f.event(BluetoothAdapter.STATE_TURNING_OFF)
        assertNull(f.gatt())
        f.event(BluetoothAdapter.STATE_OFF)
        assertFalse(f.client.state.value.isBluetoothReady)
        f.event(BluetoothAdapter.STATE_ON)
        assertNotNull(f.gatt())
        assertNotSame(first, f.gatt())
        assertEquals(RingConnectionState.CONNECTING, f.client.state.value.connectionState)
    }

    @Test fun repeatedEventsAndRegistrationDoNotReplaceAnInFlightOrActiveConnection() = checkCase { f ->
        f.observer.start()
        f.event(BluetoothAdapter.STATE_ON)
        val first = f.gatt()
        f.event(BluetoothAdapter.STATE_ON)
        assertSame(first, f.gatt())
        val state = ReflectionHelpers.getField<MutableStateFlow<RingBLEClient.BLEState>>(f.client, "_state")
        state.value = state.value.copy(connectionState = RingConnectionState.CONNECTED)
        // The client's public entry is also safe when invoked by another caller.
        f.client.onBluetoothAvailable()
        f.event(BluetoothAdapter.STATE_ON)
        assertSame(first, f.gatt())
        assertEquals(RingConnectionState.CONNECTED, f.client.state.value.connectionState)
        assertNull(f.client.state.value.nextReconnectAt)
    }

    @Test fun userDisconnectStaysDisconnectedWhileForegroundAcrossToggleAndResume() = checkCase { f ->
        f.event(BluetoothAdapter.STATE_ON)
        f.client.userDisconnect()
        f.event(BluetoothAdapter.STATE_OFF)
        f.event(BluetoothAdapter.STATE_ON)
        f.client.reconnectIfNeeded()
        assertNull(f.gatt())
        assertTrue(f.client.hasLastKnownRing)
        assertTrue(f.prefs.getBoolean(RingBLEClient.USER_DISCONNECTED_KEY, false))
    }

    @Test fun forgettingNeverReacquiresTheRingOnBluetoothEvents() = checkCase { f ->
        // Offline forget clears saved identity immediately, with no physical ring needed.
        f.client.forget()
        runCurrent()
        f.event(BluetoothAdapter.STATE_ON)
        f.event(BluetoothAdapter.STATE_OFF)
        f.event(BluetoothAdapter.STATE_ON)
        assertFalse(f.client.hasLastKnownRing)
        assertNull(f.gatt())
    }

    @Test fun noSavedRingDoesNotScanOrPair() = checkCase { f ->
        f.prefs.edit().clear().commit()
        f.event(BluetoothAdapter.STATE_ON)
        assertNull(f.gatt())
        assertNotEquals(RingConnectionState.SCANNING, f.client.state.value.connectionState)
    }

    @Test fun backgroundWithoutHostedLinkWaitsForForeground() = checkCase { f ->
        f.client.reconnectIfNeeded()
        f.foreground = false
        f.event(BluetoothAdapter.STATE_ON)
        assertNull(f.gatt())
        f.foreground = true
        f.client.reconnectIfNeeded()
        assertNotNull(f.gatt())
    }

    @Test fun backgroundHostedLinkReconnectsWhenBluetoothReturns() = checkCase { f ->
        f.foreground = false
        f.hostedLink = true
        f.event(BluetoothAdapter.STATE_ON)
        assertNotNull(f.gatt())
        f.event(BluetoothAdapter.STATE_OFF)
        f.event(BluetoothAdapter.STATE_ON)
        assertNotNull(f.gatt())
    }

    @Test fun unavailablePermissionsDoNotConnectAndForegroundCanRecoverAfterGrant() = checkCase { f ->
        ShadowApplication.getInstance().denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        f.event(BluetoothAdapter.STATE_ON)
        f.client.reconnectIfNeeded()
        assertNull(f.gatt())
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        f.client.reconnectIfNeeded()
        assertNotNull(f.gatt())
    }

    @Test fun repeatedOnDoesNotBypassRetryBackoffButOffOnResetsIt() = checkCase { f ->
        f.event(BluetoothAdapter.STATE_ON)
        val generation = ReflectionHelpers.getField<AtomicLong>(f.client, "gattGeneration").get()
        val callback = ReflectionHelpers.callInstanceMethod<BluetoothGattCallback>(f.client, "createGattCallback",
            ReflectionHelpers.ClassParameter.from(Long::class.javaPrimitiveType, generation))
        callback.onConnectionStateChange(f.gatt()!!, 133, BluetoothProfile.STATE_DISCONNECTED)
        runCurrent()
        val retryAt = f.client.state.value.nextReconnectAt
        assertNotNull(retryAt)
        f.event(BluetoothAdapter.STATE_ON)
        assertEquals(retryAt, f.client.state.value.nextReconnectAt)
        assertNull(f.gatt())
        f.event(BluetoothAdapter.STATE_OFF)
        assertNull(f.client.state.value.nextReconnectAt)
        f.event(BluetoothAdapter.STATE_ON)
        assertNotNull(f.gatt())
    }

    @Test @Config(sdk = [31])
    fun android12BluetoothGrantsCanBeMissingAtAdapterOn() = checkCase { f ->
        ShadowApplication.getInstance().denyPermissions(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        f.event(BluetoothAdapter.STATE_ON)
        f.client.reconnectIfNeeded()
        assertNull(f.gatt())
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        f.client.reconnectIfNeeded()
        assertNotNull(f.gatt())
    }

    @Test fun stoppingObserverUnregistersAdapterEvents() = checkCase { f ->
        f.observer.stop()
        f.observer.stop()
        f.event(BluetoothAdapter.STATE_ON)
        assertNull(f.gatt())
    }
}
