package desi.creative.vitals

import android.content.Context
import androidx.core.content.edit

/** SharedPreferences `vitals_shell`: what the boot receiver needs to know without JS (contract: setPrefs). */
class ShellPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    var keepConnected: Boolean
        get() = prefs.getBoolean(KEY_KEEP_CONNECTED, false)
        set(value) = prefs.edit { putBoolean(KEY_KEEP_CONNECTED, value) }

    var ringKnown: Boolean
        get() = prefs.getBoolean(KEY_RING_KNOWN, false)
        set(value) = prefs.edit { putBoolean(KEY_RING_KNOWN, value) }

    companion object {
        const val NAME = "vitals_shell"
        const val KEY_KEEP_CONNECTED = "keepConnected"
        const val KEY_RING_KNOWN = "ringKnown"
    }
}
