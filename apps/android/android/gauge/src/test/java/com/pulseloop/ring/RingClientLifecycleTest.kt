package com.pulseloop.ring

import android.app.Application
import android.Manifest
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.service.TestEncryptedPreferences
import com.pulseloop.service.TestLegacyMasterKeys
import com.pulseloop.service.TestMasterKeyBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
class RingClientLifecycleTest {
    @Test fun firstGattWaitsForRuntimeStateResetAndCancellationWins() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val client = RingBLEClient(ApplicationProvider.getApplicationContext<Application>(), waitForRuntimeInitialization = true)
        try {
            client.connectTo("AA:BB:CC:DD:EE:01")
            runCurrent()
            assertNull(gatt(client))
            client.disconnect()
            client.markRuntimeReady()
            runCurrent()
            assertNull(gatt(client))
            assertEquals(RingConnectionState.DISCONNECTED, client.state.value.connectionState)
            client.connectTo("AA:BB:CC:DD:EE:01")
            assertNotNull(gatt(client))
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
        } finally { client.destroy(); Dispatchers.resetMain() }
    }

    @Test fun staleSuccessCannotReplaceNewGattOrUndoDisconnect() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val client = RingBLEClient(ApplicationProvider.getApplicationContext<Application>())
        try {
            client.connectTo("AA:BB:CC:DD:EE:01")
            val first = gatt(client)!!
            val staleCallback = callback(client)
            client.connectTo("AA:BB:CC:DD:EE:02")
            val second = gatt(client)!!
            staleCallback.onConnectionStateChange(first, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED)
            assertSame(second, gatt(client))
            val activeCallback = callback(client)
            client.userDisconnect()
            activeCallback.onConnectionStateChange(second, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED)
            assertNull(gatt(client))
            assertEquals(RingConnectionState.DISCONNECTED, client.state.value.connectionState)
        } finally { client.destroy(); Dispatchers.resetMain() }
    }

    @Test fun lateReconnectScanFailureCannotReplaceAnInFlightGatt() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val context = ApplicationProvider.getApplicationContext<Application>()
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        Shadows.shadowOf(context.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        val client = RingBLEClient(context)
        try {
            val address = "AA:BB:CC:DD:EE:03"
            context.getSharedPreferences("ring_ble", 0).edit()
                .putString("ring.lastPeripheralIdentifier", address).commit()
            client.connectTo(address)
            val active = gatt(client)!!
            assertTrue(client.hasPermissions())
            assertTrue(client.isBluetoothEnabled)
            client.onReconnectScanFailure()
            assertNull(client.state.value.nextReconnectAt)
            advanceTimeBy(5_001)
            runCurrent()
            assertSame(active, gatt(client))
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
        } finally {
            context.getSharedPreferences("ring_ble", 0).edit().remove("ring.lastPeripheralIdentifier").commit()
            client.destroy()
            Dispatchers.resetMain()
        }
    }

    @Test fun delayedRetryEntryDoesNotReplaceAnInFlightGatt() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val context = ApplicationProvider.getApplicationContext<Application>()
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        Shadows.shadowOf(context.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        val client = RingBLEClient(context)
        try {
            val address = "AA:BB:CC:DD:EE:04"
            context.getSharedPreferences("ring_ble", 0).edit()
                .putString("ring.lastPeripheralIdentifier", address).commit()
            client.connectTo(address)
            val active = gatt(client)!!
            assertTrue(client.hasLastKnownRing)
            assertTrue(client.hasPermissions())
            assertTrue(client.isBluetoothEnabled)
            ReflectionHelpers.callInstanceMethod<Unit>(client, "connectLastKnownInternal")
            assertSame(active, gatt(client))
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
        } finally {
            context.getSharedPreferences("ring_ble", 0).edit().remove("ring.lastPeripheralIdentifier").commit()
            client.destroy()
            Dispatchers.resetMain()
        }
    }

    private fun gatt(client: RingBLEClient): BluetoothGatt? = ReflectionHelpers.getField(client, "bluetoothGatt")
    private fun callback(client: RingBLEClient): BluetoothGattCallback {
        val generation = ReflectionHelpers.getField<AtomicLong>(client, "gattGeneration").get()
        return ReflectionHelpers.callInstanceMethod(client, "createGattCallback",
            ReflectionHelpers.ClassParameter.from(Long::class.javaPrimitiveType, generation))
    }
}
