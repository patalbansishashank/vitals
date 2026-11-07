package com.pulseloop.settings

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.pulseloop.service.GlucoseUnit
import kotlinx.coroutines.flow.*

/**
 * App preferences in EncryptedSharedPreferences (the ring credential, display calibration) plus
 * the plain ring-connection policy. The local AI coach and its provider keys were removed in 2.8.0
 * (the coach lives in Vitals and on the home server); [forgetRetiredCoachData] wipes what it left.
 */
class ApiKeyStore(context: Context) {
    /** Shared revision bridges distinct encrypted-preferences wrappers used by Settings and
     * the process runtime. No permanent preference listeners or background reads are needed. */
    data class DisplayPreferences(
        val bpSystolic: Int, val bpDiastolic: Int, val glucoseOffset: Double, val glucoseReference: Double,
        val athlete: Boolean, val altitude: Double?, val betaBlockers: Boolean?, val lungCondition: Boolean?,
        val glucoseUnit: GlucoseUnit, val units: UnitSystem,
    )

    fun displayPreferencesFlow(): Flow<DisplayPreferences> = displayRevision.map {
        DisplayPreferences(bpAdjustSystolic, bpAdjustDiastolic, glucoseOffsetMgdl, glucoseRefMgdl,
            athleteMode, altitudeMeters, usesBetaBlockers, hasKnownLungCondition,
            preferredGlucoseUnit, resolvedUnitSystem)
    }.distinctUntilChanged()

    private fun displayPreferencesChanged() { displayRevision.update { it + 1 } }
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "pulseloop_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    // Connection policy is not secret; keep it available without a keystore round trip.
    private val connectionPrefs = context.getSharedPreferences("ring_connection", Context.MODE_PRIVATE)
    var keepConnected: Boolean
        get() = connectionPrefs.getBoolean("keepConnected", true)
        set(value) { connectionPrefs.edit().putBoolean("keepConnected", value).apply() }
    var batteryExemptionPrompted: Boolean
        get() = connectionPrefs.getBoolean("batteryExemptionPrompted", false)
        set(value) { connectionPrefs.edit().putBoolean("batteryExemptionPrompted", value).apply() }

    /** Full diagnostic capture expires automatically, including across process restarts. */
    var rawPacketCaptureStartedAt: Long
        get() = prefs.getLong("rawPacketCaptureStartedAt", 0L)
        set(value) { prefs.edit().putLong("rawPacketCaptureStartedAt", value).apply() }

    var rawPacketFullCapture: Boolean
        get() = com.pulseloop.data.RawPacketRetention.fullCaptureActive(rawPacketCaptureStartedAt, System.currentTimeMillis())
        set(value) { rawPacketCaptureStartedAt = if (value) System.currentTimeMillis() else 0L }

    /** J-Style 2301 session credential (ring firmware V0789+). Never place this in logs or Room. */
    var ringPassword: String
        get() = prefs.getString(KEY_RING_PASSWORD, "") ?: ""
        set(value) { prefs.edit().putString(KEY_RING_PASSWORD, value).apply() }


    /** Fire a local notification when the ring battery crosses 20% / 10% (iOS #61a). Default ON —
     *  matches iOS, where an absent key means enabled; independent of the coach master toggle. */
    var batteryAlertsEnabled: Boolean
        get() = prefs.getBoolean(KEY_BATTERY_ALERTS, true)
        set(value) { prefs.edit().putBoolean(KEY_BATTERY_ALERTS, value).apply() }

    /** Unit system: null = auto-detect from locale, "metric" or "imperial" = manual */
    var unitSystem: String?
        get() = if (prefs.contains(KEY_UNIT_SYSTEM)) prefs.getString(KEY_UNIT_SYSTEM, null) else null
        set(value) {
            if (value != null) prefs.edit().putString(KEY_UNIT_SYSTEM, value).apply()
            else prefs.edit().remove(KEY_UNIT_SYSTEM).apply()
            displayPreferencesChanged()
        }

    /** Blood-pressure calibration reference (from a cuff). 0 = not set / disabled. */
    var bpAdjustSystolic: Int
        get() = prefs.getInt(KEY_BP_ADJ_SYS, 0)
        set(value) { prefs.edit().putInt(KEY_BP_ADJ_SYS, value).apply(); displayPreferencesChanged() }

    var bpAdjustDiastolic: Int
        get() = prefs.getInt(KEY_BP_ADJ_DIA, 0)
        set(value) { prefs.edit().putInt(KEY_BP_ADJ_DIA, value).apply(); displayPreferencesChanged() }

    /** Blood-sugar display calibration offset, in mg/dL, applied to the ring's
     *  profile-derived glucose value. The ring has no glucose calibration command
     *  (only `setSugarMode` on/off), so the official app applies a "Sugar Offset"
     *  app-side — this mirrors that. 0 = not calibrated. */
    var glucoseOffsetMgdl: Double
        get() = prefs.getFloat(KEY_GLUCOSE_OFFSET, 0f).toDouble()
        set(value) { prefs.edit().putFloat(KEY_GLUCOSE_OFFSET, value.toFloat()).apply(); displayPreferencesChanged() }

    /** The last reference reading (mg/dL) the user entered to calibrate glucose.
     *  Persisted only so the calibration field stays populated. 0 = none. */
    var glucoseRefMgdl: Double
        get() = prefs.getFloat(KEY_GLUCOSE_REF, 0f).toDouble()
        set(value) { prefs.edit().putFloat(KEY_GLUCOSE_REF, value.toFloat()).apply(); displayPreferencesChanged() }

    // ── Physiology inputs (iOS #35 PhysiologySettingsView) ──
    // Optional refinements that shift the vitals reference ranges via UserPhysiologyProfile →
    // VitalsThresholdEngine. Stored here alongside the other app-side display/tuning prefs (units,
    // glucose/BP calibration) rather than on the Room UserProfile, matching where `unitSystem` and
    // the calibration offsets already live.

    /** Treat a low resting HR as fitness rather than a concern (relaxes the low-HR threshold). */
    var athleteMode: Boolean
        get() = prefs.getBoolean(KEY_ATHLETE_MODE, false)
        set(value) { prefs.edit().putBoolean(KEY_ATHLETE_MODE, value).apply(); displayPreferencesChanged() }

    /** Typical/home altitude in metres; null = not set. Above ~2000 m relaxes low-SpO₂ warnings. */
    var altitudeMeters: Double?
        get() = if (prefs.contains(KEY_ALTITUDE_M)) prefs.getFloat(KEY_ALTITUDE_M, 0f).toDouble() else null
        set(value) {
            val e = prefs.edit()
            if (value != null && value > 0) e.putFloat(KEY_ALTITUDE_M, value.toFloat()) else e.remove(KEY_ALTITUDE_M)
            e.apply()
            displayPreferencesChanged()
        }

    /** Beta-blocker use lowers resting HR. Tri-state: null = not specified (no adjustment). */
    var usesBetaBlockers: Boolean?
        get() = triState(KEY_BETA_BLOCKERS)
        set(value) { setTriState(KEY_BETA_BLOCKERS, value) }

    /** Known lung condition lowers expected SpO₂. Tri-state: null = not specified (no adjustment). */
    var hasKnownLungCondition: Boolean?
        get() = triState(KEY_LUNG_CONDITION)
        set(value) { setTriState(KEY_LUNG_CONDITION, value) }

    /** Preferred glucose display unit (iOS #43 §3). Defaults to mg/dL. */
    var preferredGlucoseUnit: GlucoseUnit
        get() = prefs.getString(KEY_GLUCOSE_UNIT, null)
            ?.let { runCatching { GlucoseUnit.valueOf(it) }.getOrNull() } ?: GlucoseUnit.MGDL
        set(value) { prefs.edit().putString(KEY_GLUCOSE_UNIT, value.name).apply(); displayPreferencesChanged() }

    /** SharedPreferences has no nullable Boolean — an absent key means unspecified (null). */
    private fun triState(key: String): Boolean? =
        if (prefs.contains(key)) prefs.getBoolean(key, false) else null
    private fun setTriState(key: String, value: Boolean?) {
        val e = prefs.edit()
        if (value != null) e.putBoolean(key, value) else e.remove(key)
        e.apply()
        displayPreferencesChanged()
    }

    /**
     * Once per install: delete every key the removed local coach stored here (provider API keys,
     * model, check-in hours) so no third-party secret outlives the feature.
     */
    fun forgetRetiredCoachData() {
        if (prefs.getBoolean(KEY_COACH_RETIRED, false)) return
        val edit = prefs.edit()
        RETIRED_COACH_KEYS.forEach(edit::remove)
        edit.putBoolean(KEY_COACH_RETIRED, true).apply()
    }

    /** Stable per-install id sent to the ring (0x48 setAppId) so it streams data to us.
     *  Generated once and reused; ≤18 ASCII chars to fit the command payload. */
    val ringAppId: String
        get() {
            val existing = prefs.getString(KEY_RING_APP_ID, null)
            if (!existing.isNullOrEmpty()) return existing
            val id = "PL" + java.util.UUID.randomUUID().toString().replace("-", "").take(14)
            prefs.edit().putString(KEY_RING_APP_ID, id).apply()
            return id
        }

    /** Resolved unit system: manual preference or auto-detected from locale */
    val resolvedUnitSystem: UnitSystem
        get() {
            val stored = unitSystem
            return if (stored != null) {
                try { UnitSystem.valueOf(stored) } catch (_: Exception) { UnitSystem.fromLocale() }
            } else {
                UnitSystem.fromLocale()
            }
        }

    companion object {
        private val displayRevision = MutableStateFlow(0L)
        private const val KEY_RING_PASSWORD = "jstyle_2301_ring_password"
        private const val KEY_BATTERY_ALERTS = "battery_alerts_enabled"
        private const val KEY_UNIT_SYSTEM = "unit_system"
        private const val KEY_BP_ADJ_SYS = "bp_adjust_systolic"
        private const val KEY_BP_ADJ_DIA = "bp_adjust_diastolic"
        private const val KEY_GLUCOSE_OFFSET = "glucose_offset_mgdl"
        private const val KEY_GLUCOSE_REF = "glucose_ref_mgdl"
        private const val KEY_RING_APP_ID = "ring_app_id"
        private const val KEY_ATHLETE_MODE = "athlete_mode"
        private const val KEY_ALTITUDE_M = "altitude_meters"
        private const val KEY_BETA_BLOCKERS = "uses_beta_blockers"
        private const val KEY_LUNG_CONDITION = "has_known_lung_condition"
        private const val KEY_GLUCOSE_UNIT = "preferred_glucose_unit"
        private const val KEY_COACH_RETIRED = "coach_data_retired_v1"

        /** Keys the removed local coach wrote to `pulseloop_secure` (ApiKeyStore and its provider store). */
        internal val RETIRED_COACH_KEYS = listOf(
            "openai_api_key", "coach_model", "coach_enabled", "web_search_enabled", "write_tools_enabled",
            "live_measurements_enabled", "environment_context_enabled", "notifications_enabled",
            "morning_hour", "evening_hour", "onboarding_completed", "developer_unlocked",
            "coach_provider_mode", "gemini_api_key", "openrouter_api_key", "minimax_api_key",
            "gemini_model", "openrouter_model", "minimax_model", "openrouter_privacy_routing",
            "openrouter_provider_sort", "coach_reasoning_effort", "coach_image_input_enabled",
            "local_llm_base_url", "local_llm_api_key", "local_llm_model", "local_llm_tool_calling",
            "local_llm_structured_output", "local_llm_max_tokens", "local_llm_timeout_seconds",
        )
    }
}
