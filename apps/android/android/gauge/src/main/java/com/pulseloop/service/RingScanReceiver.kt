package com.pulseloop.service

import android.app.PendingIntent
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.pulseloop.PulseLoopRuntime
import kotlinx.coroutines.*

/** Explicit pending scan delivery is an Android background foreground-service start exemption. */
class RingScanReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SIGHTING) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try {
                withTimeout(8_000) {
                    if (!RingConnectionService.eligible(context)) return@withTimeout
                    val runtime = PulseLoopRuntime.ensureRing(context)
                    if (intent.getIntExtra(BluetoothLeScanner.EXTRA_ERROR_CODE, 0) != 0) {
                        runtime.bleClient.onReconnectScanFailure()
                        return@withTimeout
                    }
                    @Suppress("DEPRECATION")
                    val results = intent.getParcelableArrayListExtra<ScanResult>(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT).orEmpty()
                    if (results.any { runtime.bleClient.onReconnectSighting(it) }) {
                        RingConnectionService.startIfEligible(context, exempt = true)
                    }
                }
            } finally { pending.finish() }
        }
    }
    companion object {
        const val ACTION_SIGHTING = "com.pulseloop.RING_SIGHTING"
        fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(context, 104,
            Intent(context, RingScanReceiver::class.java).setAction(ACTION_SIGHTING),
            PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    }
}
