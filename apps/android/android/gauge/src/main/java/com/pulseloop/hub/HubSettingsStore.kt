package com.pulseloop.hub

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A completed pairing with the home server (contract §1). */
data class HubPairing(
    val serverUrl: String,
    val token: String,
    val personId: String,
    val serverVersion: String,
    val maxBatch: Int,
    val maxBytes: Long,
    val pairedAt: Long,
    /** The server answered 401: uploads stop until the owner pairs again with a fresh code. */
    val needsRepair: Boolean = false,
) {
    /** Never let the bearer token reach a log or crash report through a generated toString(). */
    override fun toString(): String =
        "HubPairing(serverUrl=$serverUrl, token=<redacted>, personId=$personId, " +
            "serverVersion=$serverVersion, maxBatch=$maxBatch, maxBytes=$maxBytes, " +
            "pairedAt=$pairedAt, needsRepair=$needsRepair)"
}

/** Upload bookkeeping shown on the settings screen. */
data class HubUploadStatus(
    val lastUploadAt: Long? = null,
    val lastError: String? = null,
    val lastErrorAt: Long? = null,
    val acceptedTotal: Long = 0,
    val duplicatesTotal: Long = 0,
    val rejectedTotal: Long = 0,
    /** Epoch millis before which no request may be sent (a server Retry-After). */
    val notBefore: Long = 0,
    val backfillDone: Boolean = false,
)

/** What the uploader and backfill need; [HubSettingsStore] in production, in-memory in tests. */
interface HubSettingsSource {
    val installationId: String
    val pairing: StateFlow<HubPairing?>
    val status: StateFlow<HubUploadStatus>
    fun recordSuccess(accepted: Int, duplicates: Int, rejected: Int, at: Long)
    fun recordError(message: String, at: Long)
    fun markNeedsRepair(at: Long)
    fun setNotBefore(at: Long)
    /** Opaque resume point for the first-pair backfill; null means "start from the beginning". */
    val backfillCursor: String?
    fun saveBackfillCursor(cursor: String?, done: Boolean)
}

object HubUrl {
    private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "::1", "[::1]")

    /** Trimmed, without a trailing slash, so endpoint paths can be appended directly. */
    fun normalize(raw: String): String = raw.trim().trimEnd('/')

    /** HTTPS only; plain http:// only for loopback (contract §5). Null when acceptable. */
    fun validationError(raw: String): String? {
        val value = normalize(raw)
        if (value.isEmpty()) return "Enter the server address."
        val uri = runCatching { URI(value) }.getOrNull() ?: return "That is not a valid address."
        val host = uri.host
        if (host.isNullOrBlank()) return "Use https://host:port, for example https://oci.tailnet.ts.net:8443."
        if (uri.userInfo != null) return "The address must not contain a username or password."
        if (!uri.query.isNullOrEmpty() || !uri.fragment.isNullOrEmpty()) return "Remove the ?query or #fragment."
        return when (uri.scheme?.lowercase()) {
            "https" -> null
            "http" -> if (host.lowercase() in LOOPBACK_HOSTS) null
                else "Use https://. Plain http:// is allowed only for localhost."
            else -> "Use https://host:port."
        }
    }
}

object HubPairingCode {
    /** The server's one-time code is exactly eight digits; spaces and dashes are tolerated. */
    fun normalize(raw: String): String = raw.filter { it.isDigit() }
    fun isValid(raw: String): Boolean = normalize(raw).length == 8
}

/**
 * Encrypted, local-only home-server pairing (URL + bearer token) with an in-memory cache, kept in
 * its own EncryptedSharedPreferences file like the MQTT and Strava secrets. Reset App Data does not
 * clear it (the same as MQTT settings); Unpair does.
 */
class HubSettingsStore(
    context: Context,
    private val installationIdProvider: () -> String,
) : HubSettingsSource {
    private val appContext = context.applicationContext
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val prefs = EncryptedSharedPreferences.create(
        appContext,
        FILE_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** Cached: persistence stamps it on every hub row, and each read would otherwise decrypt. */
    override val installationId: String by lazy { installationIdProvider() }

    private val _pairing = MutableStateFlow(readPairing())
    override val pairing: StateFlow<HubPairing?> = _pairing.asStateFlow()

    private val _status = MutableStateFlow(readStatus())
    override val status: StateFlow<HubUploadStatus> = _status.asStateFlow()

    /** The address last typed, kept after Unpair so re-pairing needs only a new code. */
    val lastServerUrl: String get() = prefs.getString(KEY_LAST_URL, "") ?: ""

    override val backfillCursor: String? get() = prefs.getString(KEY_BACKFILL_CURSOR, null)

    @Synchronized
    fun savePairing(value: HubPairing) {
        prefs.edit()
            .putString(KEY_URL, value.serverUrl)
            .putString(KEY_LAST_URL, value.serverUrl)
            .putString(KEY_TOKEN, value.token)
            .putString(KEY_PERSON, value.personId)
            .putString(KEY_SERVER_VERSION, value.serverVersion)
            .putInt(KEY_MAX_BATCH, value.maxBatch)
            .putLong(KEY_MAX_BYTES, value.maxBytes)
            .putLong(KEY_PAIRED_AT, value.pairedAt)
            .putBoolean(KEY_NEEDS_REPAIR, false)
            .remove(KEY_LAST_ERROR).remove(KEY_LAST_ERROR_AT).remove(KEY_NOT_BEFORE)
            .apply()
        _pairing.value = value.copy(needsRepair = false)
        _status.value = _status.value.copy(lastError = null, lastErrorAt = null, notBefore = 0)
    }

    /** Unpair: forget the token and every counter; keep only the last typed address. */
    @Synchronized
    fun clearPairing() {
        prefs.edit()
            .remove(KEY_URL).remove(KEY_TOKEN).remove(KEY_PERSON).remove(KEY_SERVER_VERSION)
            .remove(KEY_MAX_BATCH).remove(KEY_MAX_BYTES).remove(KEY_PAIRED_AT).remove(KEY_NEEDS_REPAIR)
            .remove(KEY_LAST_UPLOAD).remove(KEY_LAST_ERROR).remove(KEY_LAST_ERROR_AT)
            .remove(KEY_ACCEPTED).remove(KEY_DUPLICATES).remove(KEY_REJECTED).remove(KEY_NOT_BEFORE)
            .remove(KEY_BACKFILL_CURSOR).remove(KEY_BACKFILL_DONE)
            .apply()
        _pairing.value = null
        _status.value = HubUploadStatus()
    }

    @Synchronized
    override fun recordSuccess(accepted: Int, duplicates: Int, rejected: Int, at: Long) {
        val next = _status.value.copy(
            lastUploadAt = at,
            lastError = null,
            lastErrorAt = null,
            acceptedTotal = _status.value.acceptedTotal + accepted,
            duplicatesTotal = _status.value.duplicatesTotal + duplicates,
            rejectedTotal = _status.value.rejectedTotal + rejected,
        )
        prefs.edit()
            .putLong(KEY_LAST_UPLOAD, at)
            .remove(KEY_LAST_ERROR).remove(KEY_LAST_ERROR_AT)
            .putLong(KEY_ACCEPTED, next.acceptedTotal)
            .putLong(KEY_DUPLICATES, next.duplicatesTotal)
            .putLong(KEY_REJECTED, next.rejectedTotal)
            .apply()
        _status.value = next
    }

    @Synchronized
    override fun recordError(message: String, at: Long) {
        val safe = message.take(300)
        prefs.edit().putString(KEY_LAST_ERROR, safe).putLong(KEY_LAST_ERROR_AT, at).apply()
        _status.value = _status.value.copy(lastError = safe, lastErrorAt = at)
    }

    @Synchronized
    override fun markNeedsRepair(at: Long) {
        prefs.edit().putBoolean(KEY_NEEDS_REPAIR, true).apply()
        _pairing.value = _pairing.value?.copy(needsRepair = true)
        recordError("The server no longer accepts this phone's token. Pair again with a new code.", at)
    }

    @Synchronized
    override fun setNotBefore(at: Long) {
        prefs.edit().putLong(KEY_NOT_BEFORE, at).apply()
        _status.value = _status.value.copy(notBefore = at)
    }

    @Synchronized
    override fun saveBackfillCursor(cursor: String?, done: Boolean) {
        prefs.edit().putString(KEY_BACKFILL_CURSOR, cursor).putBoolean(KEY_BACKFILL_DONE, done).apply()
        _status.value = _status.value.copy(backfillDone = done)
    }

    private fun readPairing(): HubPairing? {
        val token = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() } ?: return null
        val url = prefs.getString(KEY_URL, null)?.takeIf { it.isNotBlank() } ?: return null
        return HubPairing(
            serverUrl = url,
            token = token,
            personId = prefs.getString(KEY_PERSON, "") ?: "",
            serverVersion = prefs.getString(KEY_SERVER_VERSION, "") ?: "",
            maxBatch = prefs.getInt(KEY_MAX_BATCH, DEFAULT_MAX_BATCH),
            maxBytes = prefs.getLong(KEY_MAX_BYTES, DEFAULT_MAX_BYTES),
            pairedAt = prefs.getLong(KEY_PAIRED_AT, 0),
            needsRepair = prefs.getBoolean(KEY_NEEDS_REPAIR, false),
        )
    }

    private fun readStatus() = HubUploadStatus(
        lastUploadAt = prefs.getLong(KEY_LAST_UPLOAD, 0).takeIf { it > 0 },
        lastError = prefs.getString(KEY_LAST_ERROR, null),
        lastErrorAt = prefs.getLong(KEY_LAST_ERROR_AT, 0).takeIf { it > 0 },
        acceptedTotal = prefs.getLong(KEY_ACCEPTED, 0),
        duplicatesTotal = prefs.getLong(KEY_DUPLICATES, 0),
        rejectedTotal = prefs.getLong(KEY_REJECTED, 0),
        notBefore = prefs.getLong(KEY_NOT_BEFORE, 0),
        backfillDone = prefs.getBoolean(KEY_BACKFILL_DONE, false),
    )

    companion object {
        const val FILE_NAME = "pulseloop_hub_secure"
        const val DEFAULT_MAX_BATCH = 500
        const val DEFAULT_MAX_BYTES = 1_048_576L
        private const val KEY_URL = "server_url"
        private const val KEY_LAST_URL = "last_server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_PERSON = "person_id"
        private const val KEY_SERVER_VERSION = "server_version"
        private const val KEY_MAX_BATCH = "max_batch"
        private const val KEY_MAX_BYTES = "max_bytes"
        private const val KEY_PAIRED_AT = "paired_at"
        private const val KEY_NEEDS_REPAIR = "needs_repair"
        private const val KEY_LAST_UPLOAD = "last_upload_at"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_LAST_ERROR_AT = "last_error_at"
        private const val KEY_ACCEPTED = "accepted_total"
        private const val KEY_DUPLICATES = "duplicates_total"
        private const val KEY_REJECTED = "rejected_total"
        private const val KEY_NOT_BEFORE = "not_before"
        private const val KEY_BACKFILL_CURSOR = "backfill_cursor"
        private const val KEY_BACKFILL_DONE = "backfill_done"
    }
}
