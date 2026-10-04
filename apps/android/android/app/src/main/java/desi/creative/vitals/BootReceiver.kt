package desi.creative.vitals

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BOOT_COMPLETED and MY_PACKAGE_REPLACED: the only moments Android still wakes the app from the manifest without it
 * running. (BluetoothAdapter.ACTION_STATE_CHANGED is not on the implicit-broadcast exemption list, so "Bluetooth
 * turned on while the app is not running" cannot be caught here; the plugin's dynamic receiver covers it while the
 * app runs.) Never starts the activity: Android forbids that from the background; a quiet notification instead.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = ShellPrefs(context)
        val outcome = BootDecision.decide(
            action = intent?.action,
            keepConnected = prefs.keepConnected,
            ringKnown = prefs.ringKnown,
            appRunning = ShellState.activityAlive,
        )
        if (outcome == BootDecision.Outcome.NOTIFY_TAP_TO_CONNECT) {
            Notices.postTapToConnect(context, "boot")
        }
    }
}
