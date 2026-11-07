package com.pulseloop.command

import android.content.Context
import android.os.PowerManager

/**
 * A partial wake lock for the command loop (2.8.4, r068 B2). Each [acquire] is its own lock with its own timeout, so
 * two lanes never release each other's, and a lost [Held.release] still ends at the timeout.
 */
fun interface WakeHold {
    fun interface Held {
        fun release()
    }

    fun acquire(timeoutMs: Long): Held

    object None : WakeHold {
        override fun acquire(timeoutMs: Long): Held = Held {}
    }
}

/** The production hold: `PARTIAL_WAKE_LOCK` "Gauge:commands", never reference-counted. */
class PowerWakeHold(context: Context) : WakeHold {
    private val power = context.applicationContext.getSystemService(PowerManager::class.java)

    override fun acquire(timeoutMs: Long): WakeHold.Held {
        val lock = runCatching {
            power?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG)?.apply {
                setReferenceCounted(false)
                acquire(timeoutMs)
            }
        }.getOrNull()
        return WakeHold.Held { runCatching { if (lock?.isHeld == true) lock.release() } }
    }

    private companion object {
        const val TAG = "Gauge:commands"
    }
}
