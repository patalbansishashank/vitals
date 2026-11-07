package com.pulseloop.engine

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.pulseloop.hub.HubPairing
import com.pulseloop.hub.HubUrl

/**
 * (Vitals 0.7.0) What the web layer tells the engine about the Vitals device's server pairing
 * (`GaugeEngine.configure`): the server's address and this device's own server credential. The engine keeps them (the
 * web layer is not running when the engine pairs in the background) in an encrypted file, and trades the credential for
 * its own upload token with `POST /v1/lumen/pair-device`.
 */
class EngineIdentityStore(private val prefs: SharedPreferences) {
    data class Identity(val serverUrl: String, val deviceToken: String) {
        override fun toString() = "Identity(serverUrl=$serverUrl, deviceToken=<redacted>)"
    }

    fun get(): Identity? {
        val url = prefs.getString(KEY_URL, null)?.takeIf { it.isNotBlank() } ?: return null
        val token = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() } ?: return null
        return Identity(url, token)
    }

    fun save(serverUrl: String, deviceToken: String) {
        prefs.edit().putString(KEY_URL, HubUrl.normalize(serverUrl)).putString(KEY_TOKEN, deviceToken.trim()).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_URL).remove(KEY_TOKEN).apply()
    }

    companion object {
        const val FILE_NAME = "vitals_engine_identity"
        private const val KEY_URL = "server_url"
        private const val KEY_TOKEN = "device_token"

        @Volatile private var instance: EngineIdentityStore? = null

        fun get(context: Context): EngineIdentityStore = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
                EngineIdentityStore(
                    EncryptedSharedPreferences.create(
                        app, FILE_NAME, key,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                    ),
                )
            }.also { instance = it }
        }
    }
}

/** When the engine must ask the server for an upload token. */
object EnginePairing {
    /**
     * No token yet, the server stopped accepting it (a 401), or the address changed (another server, so another token).
     * A token that still works is kept: the Vitals credential may be rotated without the engine pairing again.
     */
    fun needsPair(pairing: HubPairing?, serverUrl: String): Boolean =
        pairing == null || pairing.needsRepair || pairing.serverUrl != HubUrl.normalize(serverUrl)
}
