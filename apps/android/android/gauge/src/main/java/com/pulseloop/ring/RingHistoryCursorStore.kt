package com.pulseloop.ring

import android.content.SharedPreferences

/**
 * Durable storage for a driver's history-paging cursors (energy SPEC GA.8): one opaque string per
 * history stream, scoped to the ring being talked to. The driver owns the value's format; this only
 * keeps it across app restarts, so a stream the ring has already drained is not deep-pulled again
 * from scratch after every process death.
 */
interface RingHistoryCursorStore {
    fun read(stream: String): String?
    fun write(stream: String, value: String)
}

/**
 * [RingHistoryCursorStore] in SharedPreferences, one key per ring address and stream ("" when the
 * address is unknown), next to [PrefsRingClockStore]'s clock segments. Per ring because a cursor
 * describes one ring's buffer: pairing a different ring must start that ring's history afresh.
 */
class PrefsRingHistoryCursorStore(
    private val prefs: SharedPreferences,
    private val address: () -> String?,
) : RingHistoryCursorStore {
    private fun key(stream: String) = "$KEY_PREFIX${address().orEmpty()}.$stream"

    override fun read(stream: String): String? = prefs.getString(key(stream), null)

    override fun write(stream: String, value: String) {
        prefs.edit().putString(key(stream), value).apply()
    }

    companion object {
        internal const val KEY_PREFIX = "ring.historyCursor."
    }
}
