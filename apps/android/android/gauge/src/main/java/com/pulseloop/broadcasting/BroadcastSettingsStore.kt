package com.pulseloop.broadcasting

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MqttBroadcastSettings(
    val enabled: Boolean,
    val brokerUri: String,
    val baseTopic: String,
    val clientId: String,
    val username: String,
    val password: String,
    val keepAliveSeconds: Int = DEFAULT_KEEP_ALIVE_SECONDS,
    /** Changes on every save and releases a session stopped by a permanent error. */
    val revision: Long = 0,
) {
    /** Never put the MQTT password into logs or crash reports through a generated toString(). */
    override fun toString(): String =
        "MqttBroadcastSettings(enabled=$enabled, brokerUri=$brokerUri, baseTopic=$baseTopic, " +
            "clientId=$clientId, username=$username, password=<redacted>, " +
            "keepAliveSeconds=$keepAliveSeconds, revision=$revision)"

    fun validationError(): String? {
        if (!enabled) return null
        val uri = runCatching { URI(brokerUri.trim()) }.getOrNull()
            ?: return "Broker address is not a valid URI."
        if (uri.scheme !in SUPPORTED_SCHEMES || uri.host.isNullOrBlank()) {
            return "Use ssl://host:port, tcp://host:port, wss://host/path, or ws://host/path."
        }
        if (uri.userInfo != null) return "Put the username and password in their separate fields."
        if (baseTopic.isBlank() || baseTopic.startsWith("/") || baseTopic.endsWith("/") ||
            '#' in baseTopic || '+' in baseTopic
        ) return "Base topic must be non-empty, have no edge slash, and contain no MQTT wildcards."
        if (clientId.isBlank()) return "Client ID cannot be empty."
        if (keepAliveSeconds !in KEEP_ALIVE_RANGE) {
            return "Keepalive must be between ${KEEP_ALIVE_RANGE.first} and ${KEEP_ALIVE_RANGE.last} seconds."
        }
        return null
    }

    companion object {
        const val DEFAULT_KEEP_ALIVE_SECONDS = 240
        val KEEP_ALIVE_RANGE = 60..900
        private val SUPPORTED_SCHEMES = setOf("ssl", "tcp", "wss", "ws")
    }
}

interface BroadcastSettingsSource {
    val installationId: String
    val settings: StateFlow<MqttBroadcastSettings>
    val lastPermanentError: StateFlow<String?>
    val lastPermanentFailureKind: StateFlow<PermanentFailureKind?>
    fun recordPermanentError(
        message: String,
        kind: PermanentFailureKind,
        expectedRevision: Long,
    ): Boolean
}

/** Encrypted, local-only MQTT configuration with an in-memory process cache. */
class BroadcastSettingsStore(context: Context) : BroadcastSettingsSource {
    private val appContext = context.applicationContext
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val prefs = EncryptedSharedPreferences.create(
        appContext,
        "pulseloop_broadcast_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override val installationId: String
        get() {
            val existing = prefs.getString(KEY_INSTALLATION_ID, null)
            if (!existing.isNullOrBlank()) return existing
            val generated = UUID.randomUUID().toString().replace("-", "")
            prefs.edit().putString(KEY_INSTALLATION_ID, generated).apply()
            return generated
        }

    private val _settings = MutableStateFlow(readSettings())
    /** Event persistence reads this cached value without touching the Android keystore. */
    override val settings: StateFlow<MqttBroadcastSettings> = _settings.asStateFlow()

    private val _lastPermanentError = MutableStateFlow(prefs.getString(KEY_PERMANENT_ERROR, null))
    override val lastPermanentError: StateFlow<String?> = _lastPermanentError.asStateFlow()
    private val _lastPermanentFailureKind = MutableStateFlow(
        prefs.getString(KEY_PERMANENT_KIND, null)?.let {
            runCatching { PermanentFailureKind.valueOf(it) }.getOrNull()
        },
    )
    override val lastPermanentFailureKind: StateFlow<PermanentFailureKind?> =
        _lastPermanentFailureKind.asStateFlow()

    @Synchronized
    fun save(value: MqttBroadcastSettings) {
        val normalized = value.copy(
            brokerUri = value.brokerUri.trim(),
            baseTopic = value.baseTopic.trim().trim('/'),
            clientId = value.clientId.trim(),
            keepAliveSeconds = value.keepAliveSeconds.coerceIn(MqttBroadcastSettings.KEEP_ALIVE_RANGE),
            revision = (_settings.value.revision + 1).coerceAtLeast(1),
        )
        prefs.edit()
            .putBoolean(KEY_ENABLED, normalized.enabled)
            .putString(KEY_BROKER_URI, normalized.brokerUri)
            .putString(KEY_BASE_TOPIC, normalized.baseTopic)
            .putString(KEY_CLIENT_ID, normalized.clientId)
            .putString(KEY_USERNAME, normalized.username)
            .putString(KEY_PASSWORD, normalized.password)
            .putInt(KEY_KEEP_ALIVE_SECONDS, normalized.keepAliveSeconds)
            .putLong(KEY_REVISION, normalized.revision)
            .remove(KEY_PERMANENT_ERROR)
            .remove(KEY_PERMANENT_KIND)
            .apply()
        _lastPermanentError.value = null
        _lastPermanentFailureKind.value = null
        _settings.value = normalized
    }

    @Synchronized
    override fun recordPermanentError(
        message: String,
        kind: PermanentFailureKind,
        expectedRevision: Long,
    ): Boolean {
        if (_settings.value.revision != expectedRevision) return false
        prefs.edit()
            .putString(KEY_PERMANENT_ERROR, message)
            .putString(KEY_PERMANENT_KIND, kind.name)
            .apply()
        _lastPermanentError.value = message
        _lastPermanentFailureKind.value = kind
        return true
    }

    @Synchronized
    fun clearPermanentError() {
        prefs.edit().remove(KEY_PERMANENT_ERROR).remove(KEY_PERMANENT_KIND).apply()
        _lastPermanentError.value = null
        _lastPermanentFailureKind.value = null
    }

    private fun readSettings(): MqttBroadcastSettings {
        val installId = installationId
        return MqttBroadcastSettings(
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            brokerUri = prefs.getString(KEY_BROKER_URI, "") ?: "",
            baseTopic = prefs.getString(KEY_BASE_TOPIC, DEFAULT_BASE_TOPIC) ?: DEFAULT_BASE_TOPIC,
            clientId = prefs.getString(KEY_CLIENT_ID, null)
                ?.takeIf { it.isNotBlank() } ?: "lumen-health-${installId.take(16)}",
            username = prefs.getString(KEY_USERNAME, "") ?: "",
            password = prefs.getString(KEY_PASSWORD, "") ?: "",
            keepAliveSeconds = prefs.getInt(
                KEY_KEEP_ALIVE_SECONDS,
                MqttBroadcastSettings.DEFAULT_KEEP_ALIVE_SECONDS,
            ).coerceIn(MqttBroadcastSettings.KEEP_ALIVE_RANGE),
            revision = prefs.getLong(KEY_REVISION, 0),
        )
    }

    companion object {
        const val DEFAULT_BASE_TOPIC = "lumen-health/v1"
        private const val KEY_INSTALLATION_ID = "installation_id"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_BROKER_URI = "broker_uri"
        private const val KEY_BASE_TOPIC = "base_topic"
        private const val KEY_CLIENT_ID = "client_id"
        private const val KEY_USERNAME = "username"
        private const val KEY_PASSWORD = "password"
        private const val KEY_KEEP_ALIVE_SECONDS = "keep_alive_seconds"
        private const val KEY_REVISION = "revision"
        private const val KEY_PERMANENT_ERROR = "permanent_error"
        private const val KEY_PERMANENT_KIND = "permanent_error_kind"
    }
}
