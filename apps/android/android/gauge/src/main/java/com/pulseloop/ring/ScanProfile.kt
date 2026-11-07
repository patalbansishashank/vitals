package com.pulseloop.ring

import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanSettings

data class ScanProfile(val filters: List<ScanFilter>?, val settings: ScanSettings) {
    companion object {
        fun pairing() = ScanProfile(null, ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build())
        fun reconnect(address: String, screenOn: Boolean) = ScanProfile(
            listOf(ScanFilter.Builder().setDeviceAddress(address).build()),
            ScanSettings.Builder()
                .setScanMode(if (screenOn) ScanSettings.SCAN_MODE_BALANCED else ScanSettings.SCAN_MODE_LOW_POWER)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_FIRST_MATCH)
                .setMatchMode(ScanSettings.MATCH_MODE_STICKY)
                .setNumOfMatches(ScanSettings.MATCH_NUM_ONE_ADVERTISEMENT).build())
    }
}
