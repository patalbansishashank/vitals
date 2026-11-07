package com.pulseloop.service

import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import com.pulseloop.ring.RingBLEClient

/** Process-owned adapter events, including when the foreground app has no ring service. */
internal class RingBluetoothObserver(
    private val context: Context,
    private val client: RingBLEClient,
    private val reconnectAllowed: () -> Boolean,
) {
    private var registered = false
    private var available: Boolean? = null
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            val next = when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_ON -> true
                BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> false
                else -> return
            }
            if (next == available) return
            available = next
            if (next) client.onBluetoothAvailable(reconnect = reconnectAllowed())
            else client.onBluetoothUnavailable()
        }
    }

    fun start() {
        if (registered) return
        // Bluetooth broadcasts can originate in the privileged Bluetooth process, not the
        // system UID. This protected system action therefore needs RECEIVER_EXPORTED.
        ContextCompat.registerReceiver(context, receiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
        registered = true
    }

    fun stop() {
        if (!registered) return
        context.unregisterReceiver(receiver)
        registered = false
        available = null
    }
}
