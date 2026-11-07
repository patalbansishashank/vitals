package com.pulseloop.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.UserManager
import kotlinx.coroutines.*

class RingBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_LOCKED_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED)) return
        // (Vitals 0.7.0) Nothing until Vitals has taken over from Gauge: Gauge's own receiver brings its link back.
        if (!com.pulseloop.GaugeEngine.isActive(context)) return
        // All ring identity and settings are credential encrypted. BOOT_COMPLETED follows unlock.
        if (!context.getSystemService(UserManager::class.java).isUserUnlocked) return
        // A reboot and a package replacement both drop Play Services' activity-transition registration:
        // register again now, whether or not the service decides to run (idempotent in one process).
        com.pulseloop.phone.PhoneActivityRecognition.startIn(context,
            if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) "packageReplaced" else "boot")
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try { withTimeout(8_000) { RingConnectionService.startIfEligible(context, exempt = true) } }
            finally { pending.finish() }
        }
    }
}
