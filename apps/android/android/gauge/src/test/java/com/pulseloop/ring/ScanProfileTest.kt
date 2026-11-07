package com.pulseloop.ring

import android.app.Application
import android.bluetooth.le.ScanSettings
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ScanProfileTest {
    @Test fun pairingIsInteractiveAndReconnectIsAlwaysAddressFiltered() {
        assertNull(ScanProfile.pairing().filters)
        assertEquals(ScanSettings.SCAN_MODE_LOW_LATENCY, ScanProfile.pairing().settings.scanMode)
        listOf(false, true).forEach { on ->
            val profile = ScanProfile.reconnect("AA:BB:CC:DD:EE:FF", on)
            assertEquals("AA:BB:CC:DD:EE:FF", profile.filters!!.single().deviceAddress)
            assertEquals(if (on) ScanSettings.SCAN_MODE_BALANCED else ScanSettings.SCAN_MODE_LOW_POWER, profile.settings.scanMode)
            assertEquals(ScanSettings.CALLBACK_TYPE_FIRST_MATCH, profile.settings.callbackType)
            assertEquals(ScanSettings.MATCH_MODE_STICKY, org.robolectric.util.ReflectionHelpers.callInstanceMethod<Int>(profile.settings, "getMatchMode"))
            assertEquals(ScanSettings.MATCH_NUM_ONE_ADVERTISEMENT, org.robolectric.util.ReflectionHelpers.callInstanceMethod<Int>(profile.settings, "getNumOfMatches"))
        }
    }
}
