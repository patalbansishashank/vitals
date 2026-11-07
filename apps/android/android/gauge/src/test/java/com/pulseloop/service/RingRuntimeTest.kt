package com.pulseloop.service

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.ring.RingBLEClient
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.security.crypto.MasterKeys
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import com.pulseloop.PulseLoopRuntime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class,
    shadows = [TestMasterKeyBuilder::class, TestLegacyMasterKeys::class, TestEncryptedPreferences::class])
class RingRuntimeTest {
    @Test fun ensureRingReturnsSameFullyWiredRuntime() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        androidx.work.WorkManager.initialize(context, androidx.work.Configuration.Builder().build())
        val first = PulseLoopRuntime.ensureRing(context)
        val second = PulseLoopRuntime.ensureRing(context)
        assertSame(first, second)
        assertSame(first.bleClient, second.bleClient)
        assertSame(first.coordinator, second.coordinator)
        assertSame(first.gpsRecorder, first.liveWorkout.gps)
        assertNotNull(first.bleClient.onConnected)
        assertNotNull(first.bleClient.onFirmwareRead)
        first.coordinator.stop()
        first.batteryAlerts.stop()
        first.bleClient.destroy()
        PulseLoopRuntime.ensurePersistence(context).stop()
    }
    @Test fun concurrentEntryConstructsExactlyOneBleClient() {
        // Exercise the exact publication boundary used by ensureRing, without a real keystore
        // or WorkManager. The Android BLE adapter is Robolectric's; no hardware is accessed.
        val slot = ProcessRuntimeSlot<RingBLEClient>()
        val context = ApplicationProvider.getApplicationContext<Application>()
        val count = AtomicInteger()
        val pool = Executors.newFixedThreadPool(4)
        try {
            val clients = pool.invokeAll(List(20) { java.util.concurrent.Callable {
                slot.ensure { count.incrementAndGet(); RingBLEClient(context) }
            } }).map { it.get() }
            assertEquals(1, count.get())
            clients.forEach { assertSame(clients.first(), it) }
            clients.first().destroy()
        } finally { pool.shutdownNow() }
    }
}

// Only the unavailable Android Keystore boundary is substituted. Room, BLE client,
// coordinator, WorkManager scheduling and the runtime initialization are production code.
@Implements(MasterKey.Builder::class)
class TestMasterKeyBuilder {
    @Implementation fun build(): MasterKey = MasterKey::class.java
        .getDeclaredConstructor(String::class.java, Any::class.java)
        .apply { isAccessible = true }.newInstance("test-key", null)
}

@Suppress("DEPRECATION")
@Implements(MasterKeys::class)
class TestLegacyMasterKeys {
    companion object {
        @JvmStatic @Implementation fun getOrCreate(spec: android.security.keystore.KeyGenParameterSpec): String = "test-key"
    }
}

@Implements(EncryptedSharedPreferences::class)
class TestEncryptedPreferences {
    companion object {
        @JvmStatic @Implementation fun create(context: Context, name: String, key: MasterKey,
            keys: EncryptedSharedPreferences.PrefKeyEncryptionScheme,
            values: EncryptedSharedPreferences.PrefValueEncryptionScheme): SharedPreferences = context.getSharedPreferences(name, Context.MODE_PRIVATE)
        @JvmStatic @Implementation fun create(name: String, key: String, context: Context,
            keys: EncryptedSharedPreferences.PrefKeyEncryptionScheme,
            values: EncryptedSharedPreferences.PrefValueEncryptionScheme): SharedPreferences = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    }
}
