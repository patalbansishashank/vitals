package com.pulseloop.shortvideo

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ShortVideoPrefs(
    val enabled: Boolean = true,
    val dailyLimit: Int = ShortVideoSettings.DEFAULT_LIMIT,
    val countdownSeconds: Int = ShortVideoSettings.DEFAULT_COUNTDOWN_SECONDS,
    val enabledApps: Set<ShortVideoApp> = ShortVideoApp.entries.toSet(),
    val capsuleMode: CapsuleMode = CapsuleMode.AUTO,
    /** Send the daily counts to the paired home server (only counts, never content). */
    val hubUpload: Boolean = true,
    /** The user read and accepted the accessibility disclosure. */
    val disclosureAccepted: Boolean = false,
    /** Log every classified layout to the debug screen, not just unknown ones. */
    val verboseDebug: Boolean = false,
) {
    val limitConfig: LimitConfig get() = LimitConfig(enabled, dailyLimit, countdownSeconds)
    fun appEnabled(app: ShortVideoApp): Boolean = enabled && app in enabledApps
}

/** SharedPreferences-backed settings with a process-wide [prefs] flow the service observes. */
class ShortVideoSettings private constructor(private val sp: SharedPreferences) {
    private val state = MutableStateFlow(read())
    val prefs: StateFlow<ShortVideoPrefs> = state.asStateFlow()

    fun update(transform: (ShortVideoPrefs) -> ShortVideoPrefs) {
        val next = sanitise(transform(state.value))
        sp.edit()
            .putBoolean(K_ENABLED, next.enabled)
            .putInt(K_LIMIT, next.dailyLimit)
            .putInt(K_COUNTDOWN, next.countdownSeconds)
            .putStringSet(K_APPS, next.enabledApps.map { it.key }.toSet())
            .putString(K_CAPSULE, next.capsuleMode.name)
            .putBoolean(K_HUB, next.hubUpload)
            .putBoolean(K_DISCLOSURE, next.disclosureAccepted)
            .putBoolean(K_VERBOSE, next.verboseDebug)
            .apply()
        state.value = next
    }

    private fun read(): ShortVideoPrefs = sanitise(
        ShortVideoPrefs(
            enabled = sp.getBoolean(K_ENABLED, true),
            dailyLimit = sp.getInt(K_LIMIT, DEFAULT_LIMIT),
            countdownSeconds = sp.getInt(K_COUNTDOWN, DEFAULT_COUNTDOWN_SECONDS),
            enabledApps = sp.getStringSet(K_APPS, null)?.mapNotNull(ShortVideoApp::fromKey)?.toSet()
                ?: ShortVideoApp.entries.toSet(),
            capsuleMode = sp.getString(K_CAPSULE, null)?.let { runCatching { CapsuleMode.valueOf(it) }.getOrNull() }
                ?: CapsuleMode.AUTO,
            hubUpload = sp.getBoolean(K_HUB, true),
            disclosureAccepted = sp.getBoolean(K_DISCLOSURE, false),
            verboseDebug = sp.getBoolean(K_VERBOSE, false),
        ),
    )

    companion object {
        const val DEFAULT_LIMIT = 30
        const val DEFAULT_COUNTDOWN_SECONDS = 5
        val LIMIT_RANGE = 1..500
        val COUNTDOWN_RANGE = 3..30

        private const val FILE = "short_video_prefs"
        private const val K_ENABLED = "enabled"
        private const val K_LIMIT = "daily_limit"
        private const val K_COUNTDOWN = "countdown_seconds"
        private const val K_APPS = "enabled_apps"
        private const val K_CAPSULE = "capsule_mode"
        private const val K_HUB = "hub_upload"
        private const val K_DISCLOSURE = "disclosure_accepted"
        private const val K_VERBOSE = "verbose_debug"

        @Volatile private var instance: ShortVideoSettings? = null

        fun get(context: Context): ShortVideoSettings = instance ?: synchronized(this) {
            instance ?: ShortVideoSettings(
                context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE),
            ).also { instance = it }
        }

        internal fun sanitise(p: ShortVideoPrefs): ShortVideoPrefs = p.copy(
            dailyLimit = p.dailyLimit.coerceIn(LIMIT_RANGE),
            countdownSeconds = p.countdownSeconds.coerceIn(COUNTDOWN_RANGE),
        )
    }
}
