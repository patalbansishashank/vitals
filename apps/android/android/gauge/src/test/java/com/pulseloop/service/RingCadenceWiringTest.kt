package com.pulseloop.service

import android.Manifest
import android.app.AlarmManager
import android.app.Application
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.SystemClock
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.command.WakeHold
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.ReconnectBackoff
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDecodedEvent
import com.pulseloop.ring.RingSyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowApplication
import org.robolectric.util.ReflectionHelpers

/**
 * (r087, A1, A5, A8) The two cadences as they are wired to the real client and coordinator: which guards the
 * foreground loop and the background pass are given, and what the loop's redial does to the client.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class,
    shadows = [TestMasterKeyBuilder::class, TestLegacyMasterKeys::class, TestEncryptedPreferences::class])
class RingCadenceWiringTest {
    private class FakeEngine : RingSyncEngine {
        var passes = 0
        override val isHistorySyncRunning: Boolean get() = false
        override fun refreshForeground(): Boolean { passes++; return true }
        override fun runStartup() {}
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
    private val address = "AA:BB:CC:DD:EE:09"
    private val refresh = ForegroundRingLoop.REFRESH_MS
    private val redial = ForegroundRingLoop.RECONNECT_MS
    private val ringPrefs get() = context.getSharedPreferences("ring_ble", Context.MODE_PRIVATE)

    private fun engineOn(on: Boolean) {
        context.getSharedPreferences("vitals_engine", Context.MODE_PRIVATE).edit().putBoolean("took_over", on).commit()
    }

    /** A client with a saved ring, the engine on and Bluetooth usable; [linked] says whether it believes it is connected. */
    private fun TestScope.rig(linked: Boolean, body: (RingBLEClient, RingSyncCoordinator, FakeEngine) -> Unit) {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        Shadows.shadowOf(context.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        ringPrefs.edit().putString("ring.lastPeripheralIdentifier", address).commit()
        engineOn(true)
        val db = Room.inMemoryDatabaseBuilder(context, PulseLoopDatabase::class.java).allowMainThreadQueries().build()
        val client = RingBLEClient(context)
        val coordinator = RingSyncCoordinator(client, db)
        val engine = FakeEngine()
        try {
            if (linked) {
                client.connectTo(address)
                ReflectionHelpers.setField(client, "activeSyncEngine", engine)
                ReflectionHelpers.getField<MutableStateFlow<RingBLEClient.BLEState>>(client, "_state")
                    .update { it.copy(connectionState = RingConnectionState.CONNECTED) }
            }
            body(client, coordinator, engine)
        } finally {
            ringPrefs.edit().clear().commit()
            engineOn(false)
            coordinator.stop()
            client.destroy()
            db.close()
            Dispatchers.resetMain()
        }
    }

    private fun backoff(client: RingBLEClient): ReconnectBackoff = ReflectionHelpers.getField(client, "reconnectBackoff")

    // ---- the foreground cadence ----

    @Test fun `in front, the ring is read at once and then a minute after each pass, until the app leaves the front`() = runTest {
        rig(linked = true) { client, coordinator, engine ->
            var inFront = true
            val job = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { inFront }.run() }
            runCurrent()
            assertEquals("no first wait", 1, engine.passes)
            advanceTimeBy(refresh + 1_000)
            runCurrent()
            assertEquals(2, engine.passes)

            inFront = false
            advanceTimeBy(refresh * 5)
            runCurrent()
            assertEquals(2, engine.passes)
            assertTrue("the loop ended by itself", job.isCompleted)
        }
    }

    @Test fun `nothing is read while the app is not in front or the engine is off`() = runTest {
        rig(linked = true) { client, coordinator, engine ->
            val hidden = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { false }.run() }
            runCurrent()
            assertTrue(hidden.isCompleted)

            engineOn(false)
            val off = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { true }.run() }
            runCurrent()
            assertTrue(off.isCompleted)
            assertEquals(0, engine.passes)
        }
    }

    @Test fun `after the person's Disconnect the loop neither reads nor dials`() = runTest {
        rig(linked = false) { client, coordinator, engine ->
            ringPrefs.edit().putBoolean(RingBLEClient.USER_DISCONNECTED_KEY, true).commit()
            val job = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { true }.run() }
            advanceTimeBy(refresh * 5)
            runCurrent()
            assertEquals(0, engine.passes)
            assertNotEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            job.cancel()
        }
    }

    @Test fun `in front, a ring left at the long backoff is dialled again after the short wait`() = runTest {
        rig(linked = false) { client, coordinator, _ ->
            // Unattended failures have used the retry budget up: by itself the client would wait for minutes.
            repeat(ReconnectBackoff.DELAYS.size) { backoff(client).nextDelay(0) }
            assertTrue(backoff(client).atCeiling)
            val job = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { true }.run() }
            advanceTimeBy(redial - 1_000)
            runCurrent()
            assertNotEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            advanceTimeBy(2_000)
            runCurrent()
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            assertFalse("a fresh retry budget", backoff(client).atCeiling)
            job.cancel()
        }
    }

    @Test fun `the short wait does not dial into a Bluetooth stack that asked to be left alone`() = runTest {
        rig(linked = false) { client, coordinator, _ ->
            // Status 257: the stack is out of resources, and the client waits for Bluetooth to restart.
            backoff(client).nextDelay(257)
            assertTrue(backoff(client).waitingForBluetooth)
            val job = backgroundScope.launch { PulseLoopRuntime.foregroundLoop(context, client, coordinator) { true }.run() }
            advanceTimeBy(redial * 6)
            runCurrent()
            assertNotEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            assertTrue("the wait for Bluetooth stands", backoff(client).waitingForBluetooth)

            // Coming back to the app, or Bluetooth restarting, still ends it (as before).
            client.reconnectIfNeeded()
            assertEquals(RingConnectionState.CONNECTING, client.state.value.connectionState)
            job.cancel()
        }
    }

    // ---- the background pass ----

    private fun battery(percent: Int, plugged: Int) {
        context.sendStickyBroadcast(Intent(Intent.ACTION_BATTERY_CHANGED)
            .putExtra(BatteryManager.EXTRA_LEVEL, percent)
            .putExtra(BatteryManager.EXTRA_SCALE, 100)
            .putExtra(BatteryManager.EXTRA_PLUGGED, plugged))
    }

    @Test fun `a background pass runs only with keep-connected on, the app away, no Disconnect and a phone that is not low`() = runTest {
        rig(linked = true) { client, _, _ ->
            battery(80, plugged = 0)
            fun allowed(keepConnected: Boolean = true, appInFront: Boolean = false) =
                RingConnectionService.backgroundPassAllowed(context, client, keepConnected, appInFront)
            assertTrue(allowed())

            assertFalse("in front the app's own cadence reads the ring", allowed(appInFront = true))
            assertFalse(allowed(keepConnected = false))

            ringPrefs.edit().putBoolean(RingBLEClient.USER_DISCONNECTED_KEY, true).commit()
            assertFalse("the person disconnected", allowed())
            ringPrefs.edit().remove(RingBLEClient.USER_DISCONNECTED_KEY).commit()
            assertTrue(allowed())

            battery(10, plugged = 0)
            assertFalse("phone low and not charging", allowed())
            battery(10, plugged = BatteryManager.BATTERY_PLUGGED_AC)
            assertTrue("charging", allowed())

            ShadowApplication.getInstance().denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
            assertFalse("Bluetooth may not be used", allowed())
            ShadowApplication.getInstance().grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)

            engineOn(false)
            assertFalse("the engine is off", allowed())
        }
    }

    @Test fun `the wake for a due pass is one alarm that counts sleeping time, replaced by the next and gone when cancelled`() {
        val alarms = Shadows.shadowOf(context.getSystemService(AlarmManager::class.java))
        var woke = 0
        val handovers = mutableListOf<Long>()
        val alarm = BackgroundPassAlarm(context, { timeoutMs -> handovers += timeoutMs; WakeHold.Held {} }) { woke++ }

        val first = SystemClock.elapsedRealtime() + BackgroundRingLoop.INTERVAL_MS
        alarm.arm(first)
        alarm.arm(first + 60_000)
        val scheduled = alarms.scheduledAlarms.single()
        assertEquals(AlarmManager.ELAPSED_REALTIME_WAKEUP, scheduled.type)
        assertEquals(first + 60_000, scheduled.triggerAtMs)
        assertFalse("inexact: no exact-alarm permission is involved", scheduled.windowLengthMs == 0L)

        alarms.fireAlarm(scheduled)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(1, woke)
        assertEquals("the phone is held for the step to the pass's own hold, briefly", 1, handovers.size)
        assertTrue(handovers.single() in 1..5_000)

        alarm.arm(first + 120_000)
        alarm.cancel()
        assertTrue(alarms.scheduledAlarms.isEmpty())
    }
}
