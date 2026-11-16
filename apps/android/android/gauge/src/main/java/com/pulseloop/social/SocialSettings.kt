package com.pulseloop.social

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The "Social time" settings (SPEC social-time): whether it runs, which of the seven apps are counted, and the 30–45
 * minute target band. Durations only ever leave the phone; these are preferences, not data.
 */
data class SocialPrefs(
    val enabled: Boolean = true,
    /** The apps currently counted; defaults to all seven (the owner's "common set"). */
    val enabledApps: Set<SocialApp> = SocialApp.entries.toSet(),
    val targetMinMinutes: Int = SocialSettings.DEFAULT_TARGET_MIN,
    val targetMaxMinutes: Int = SocialSettings.DEFAULT_TARGET_MAX,
    /** Send the daily totals to the paired home server (durations only, never content). */
    val hubUpload: Boolean = true,
    /** The person read and accepted the Usage-access disclosure (the web layer shows it before opening settings). */
    val usageDisclosureAccepted: Boolean = false,
) {
    fun appEnabled(app: SocialApp): Boolean = enabled && app in enabledApps
    val enabledKeys: List<String> get() = SocialApp.entries.filter { it in enabledApps }.map { it.key }
}

/** SharedPreferences-backed settings with a process-wide [prefs] flow the collector and engine state observe. */
class SocialSettings private constructor(private val sp: SharedPreferences) {
    private val state = MutableStateFlow(read())
    val prefs: StateFlow<SocialPrefs> = state.asStateFlow()

    fun update(transform: (SocialPrefs) -> SocialPrefs) {
        val next = sanitise(transform(state.value))
        sp.edit()
            .putBoolean(K_ENABLED, next.enabled)
            .putStringSet(K_APPS, next.enabledApps.map { it.key }.toSet())
            .putInt(K_TARGET_MIN, next.targetMinMinutes)
            .putInt(K_TARGET_MAX, next.targetMaxMinutes)
            .putBoolean(K_HUB, next.hubUpload)
            .putBoolean(K_DISCLOSURE, next.usageDisclosureAccepted)
            .apply()
        state.value = next
    }

    private fun read(): SocialPrefs = sanitise(
        SocialPrefs(
            enabled = sp.getBoolean(K_ENABLED, true),
            enabledApps = sp.getStringSet(K_APPS, null)?.mapNotNull(SocialApp::fromKey)?.toSet()
                ?: SocialApp.entries.toSet(),
            targetMinMinutes = sp.getInt(K_TARGET_MIN, DEFAULT_TARGET_MIN),
            targetMaxMinutes = sp.getInt(K_TARGET_MAX, DEFAULT_TARGET_MAX),
            hubUpload = sp.getBoolean(K_HUB, true),
            usageDisclosureAccepted = sp.getBoolean(K_DISCLOSURE, false),
        ),
    )

    companion object {
        const val DEFAULT_TARGET_MIN = 30
        const val DEFAULT_TARGET_MAX = 45
        val TARGET_RANGE = 1..1440

        private const val FILE = "social_time_prefs"
        private const val K_ENABLED = "enabled"
        private const val K_APPS = "enabled_apps"
        private const val K_TARGET_MIN = "target_min_minutes"
        private const val K_TARGET_MAX = "target_max_minutes"
        private const val K_HUB = "hub_upload"
        private const val K_DISCLOSURE = "usage_disclosure_accepted"

        @Volatile private var instance: SocialSettings? = null

        fun get(context: Context): SocialSettings = instance ?: synchronized(this) {
            instance ?: SocialSettings(
                context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE),
            ).also { instance = it }
        }

        /** Keeps the target band sane: both ends in range, and min never above max. */
        internal fun sanitise(p: SocialPrefs): SocialPrefs {
            val min = p.targetMinMinutes.coerceIn(TARGET_RANGE)
            val max = p.targetMaxMinutes.coerceIn(TARGET_RANGE)
            return p.copy(targetMinMinutes = minOf(min, max), targetMaxMinutes = maxOf(min, max))
        }
    }
}
