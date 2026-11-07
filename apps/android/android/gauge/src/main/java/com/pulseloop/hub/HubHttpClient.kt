package com.pulseloop.hub

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

data class HubPairResponse(
    val token: String,
    val personId: String,
    val serverVersion: String,
    val maxBatch: Int,
    val maxBytes: Long,
    /** (Vitals 0.7.0) The server's id for this phone's engine; only `pair-device` answers it. */
    val deviceId: String? = null,
)

sealed interface HubPairResult {
    data class Success(val response: HubPairResponse) : HubPairResult
    /** [status] is null for a transport failure (no HTTP response at all). */
    data class Failure(val status: Int?, val error: String, val message: String) : HubPairResult
}

/**
 * One event the server refused. The server names it by [id] when the event had a readable one and
 * always by [index] (its position in the batch), so a malformed event without an id is still found.
 */
data class HubRejection(val id: String?, val reason: String, val index: Int? = null)

sealed interface HubUploadResponse {
    data class Ok(val accepted: Int, val duplicates: Int, val rejected: List<HubRejection>) : HubUploadResponse
    data object Unauthorized : HubUploadResponse
    data object TooLarge : HubUploadResponse
    /** 429 / 503. [retryAfterMs] is the server's Retry-After, when it sent a usable one. */
    data class Throttled(val status: Int, val retryAfterMs: Long?) : HubUploadResponse
    data class Failed(val status: Int?, val error: String) : HubUploadResponse
}

data class HubServerStatus(
    val personId: String,
    /** When the server last stored an upload from this person. */
    val lastEventAt: String?,
    val counts: Map<String, Long>,
    val serverVersion: String,
    /** The newest observed_at the server still shows (soft-deleted rows excluded); null if none or an older server. */
    val lastObservedAt: String? = null,
    /** How many deletion events the server holds; null from a server that does not report it. */
    val deletions: Long? = null,
)

/** The four `/v1/lumen/...` calls (contract §1–2) over the app's existing OkHttp stack. */
interface HubApi {
    suspend fun pair(
        serverUrl: String,
        code: String,
        installationId: String,
        deviceName: String,
        appVersion: String,
    ): HubPairResult

    /**
     * (Vitals 0.7.0) `POST /v1/lumen/pair-device`: the engine inside Vitals gets its upload token with the Vitals device's
     * own server credential ([deviceToken], as a bearer), no one-time code. The answer has the shape of [pair]'s.
     */
    suspend fun pairDevice(
        serverUrl: String,
        deviceToken: String,
        installationId: String,
        deviceName: String,
        appVersion: String,
    ): HubPairResult

    /** [eventsJson] are complete CloudEvent JSON objects, already serialized. */
    suspend fun uploadEvents(
        serverUrl: String,
        token: String,
        installationId: String,
        eventsJson: List<String>,
    ): HubUploadResponse

    suspend fun status(serverUrl: String, token: String): Result<HubServerStatus>

    /**
     * `POST /v1/lumen/unpair`: the server revokes [token]. Best effort; failure means the token may
     * still be live on the server (the owner can revoke it there).
     */
    suspend fun unpair(serverUrl: String, token: String): Result<Unit>
}

class OkHttpHubApi(
    private val client: OkHttpClient = defaultClient,
    private val gzip: Boolean = true,
    private val now: () -> Long = System::currentTimeMillis,
) : HubApi {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun pair(
        serverUrl: String,
        code: String,
        installationId: String,
        deviceName: String,
        appVersion: String,
    ): HubPairResult = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("code", code)
            put("installationId", installationId)
            put("deviceName", deviceName)
            put("appVersion", appVersion)
        }.toString()
        val request = Request.Builder()
            .url(HubUrl.normalize(serverUrl) + PAIR_PATH)
            .post(body.toRequestBody(JSON))
            .build()
        executePair(request)
    }

    override suspend fun pairDevice(
        serverUrl: String,
        deviceToken: String,
        installationId: String,
        deviceName: String,
        appVersion: String,
    ): HubPairResult = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("installationId", installationId)
            put("deviceName", deviceName)
            put("appVersion", appVersion)
        }.toString()
        val request = Request.Builder()
            .url(HubUrl.normalize(serverUrl) + PAIR_DEVICE_PATH)
            .header("Authorization", "Bearer $deviceToken")
            .post(body.toRequestBody(JSON))
            .build()
        executePair(request)
    }

    private fun executePair(request: Request): HubPairResult = try {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.code == 200) {
                val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                val token = root?.string("token")
                if (root == null || token.isNullOrBlank()) {
                    HubPairResult.Failure(200, "bad_response", "The server's reply had no token.")
                } else {
                    HubPairResult.Success(
                        HubPairResponse(
                            token = token,
                            personId = root.string("personId").orEmpty(),
                            serverVersion = root.string("serverVersion").orEmpty(),
                            maxBatch = root["maxBatch"]?.jsonPrimitive?.intOrNull?.takeIf { it > 0 }
                                ?: HubSettingsStore.DEFAULT_MAX_BATCH,
                            maxBytes = root["maxBytes"]?.jsonPrimitive?.longOrNull?.takeIf { it > 0 }
                                ?: HubSettingsStore.DEFAULT_MAX_BYTES,
                            deviceId = root.string("deviceId"),
                        ),
                    )
                }
            } else {
                val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                HubPairResult.Failure(
                    status = response.code,
                    error = root?.string("error") ?: "http_${response.code}",
                    message = root?.string("message").orEmpty(),
                )
            }
        }
    } catch (e: IOException) {
        HubPairResult.Failure(null, "network", safeMessage(e))
    }

    override suspend fun uploadEvents(
        serverUrl: String,
        token: String,
        installationId: String,
        eventsJson: List<String>,
    ): HubUploadResponse = withContext(Dispatchers.IO) {
        val raw = buildEventsBody(installationId, eventsJson).toByteArray(Charsets.UTF_8)
        val builder = Request.Builder()
            .url(HubUrl.normalize(serverUrl) + EVENTS_PATH)
            .header("Authorization", "Bearer $token")
        if (gzip) {
            builder.header("Content-Encoding", "gzip").post(gzipBytes(raw).toRequestBody(JSON))
        } else {
            builder.post(raw.toRequestBody(JSON))
        }
        try {
            client.newCall(builder.build()).execute().use { response -> mapUpload(response) }
        } catch (e: IOException) {
            HubUploadResponse.Failed(null, safeMessage(e))
        }
    }

    override suspend fun status(serverUrl: String, token: String): Result<HubServerStatus> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(HubUrl.normalize(serverUrl) + STATUS_PATH)
                .header("Authorization", "Bearer $token")
                .get()
                .build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.code != 200) return@withContext Result.failure(IOException("HTTP ${response.code}"))
                    val root = json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
                    Result.success(
                        HubServerStatus(
                            personId = root.string("personId").orEmpty(),
                            lastEventAt = root.string("lastEventAt"),
                            counts = (root["counts"] as? JsonObject)?.mapNotNull { (key, value) ->
                                runCatching { value.jsonPrimitive.longOrNull }.getOrNull()?.let { key to it }
                            }?.toMap().orEmpty(),
                            serverVersion = root.string("serverVersion").orEmpty(),
                            lastObservedAt = root.string("lastObservedAt"),
                            deletions = runCatching { root["deletions"]?.jsonPrimitive?.longOrNull }.getOrNull(),
                        ),
                    )
                }
            } catch (e: Exception) {
                Result.failure(IOException(safeMessage(e)))
            }
        }

    override suspend fun unpair(serverUrl: String, token: String): Result<Unit> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(HubUrl.normalize(serverUrl) + UNPAIR_PATH)
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody(JSON))
            .build()
        try {
            // Short: the owner is waiting on the Unpair button, and the local unpair happens anyway.
            client.newBuilder().callTimeout(UNPAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS).build()
                .newCall(request).execute().use { response ->
                    // 401: the token is already gone on the server, which is what Unpair wants.
                    if (response.code in 200..299 || response.code == 401) Result.success(Unit)
                    else Result.failure(IOException("HTTP ${response.code}"))
                }
        } catch (e: Exception) {
            Result.failure(IOException(safeMessage(e)))
        }
    }

    private fun mapUpload(response: Response): HubUploadResponse = when (response.code) {
        200 -> {
            val root = runCatching {
                json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
            }.getOrNull()
            if (root == null) {
                HubUploadResponse.Failed(200, "Unreadable server reply")
            } else {
                HubUploadResponse.Ok(
                    accepted = root["accepted"]?.jsonPrimitive?.intOrNull ?: 0,
                    duplicates = root["duplicates"]?.jsonPrimitive?.intOrNull ?: 0,
                    rejected = runCatching { root["rejected"]?.jsonArray }.getOrNull().orEmpty().mapNotNull {
                        val item = it as? JsonObject ?: return@mapNotNull null
                        val id = item.string("id")
                        val index = runCatching { item["index"]?.jsonPrimitive?.intOrNull }.getOrNull()
                        if (id == null && index == null) return@mapNotNull null
                        HubRejection(id, item.string("reason") ?: "rejected", index)
                    },
                )
            }
        }
        401 -> HubUploadResponse.Unauthorized
        413 -> HubUploadResponse.TooLarge
        429, 503 -> HubUploadResponse.Throttled(response.code, parseRetryAfter(response.header("Retry-After"), now()))
        else -> HubUploadResponse.Failed(response.code, "HTTP ${response.code}")
    }

    companion object {
        const val PAIR_PATH = "/v1/lumen/pair"
        /** (Vitals 0.7.0) The Vitals device's own credential pairs the engine: no code. */
        const val PAIR_DEVICE_PATH = "/v1/lumen/pair-device"
        const val EVENTS_PATH = "/v1/lumen/events"
        const val STATUS_PATH = "/v1/lumen/status"
        const val UNPAIR_PATH = "/v1/lumen/unpair"
        private const val UNPAIR_TIMEOUT_SECONDS = 10L
        private val JSON = "application/json".toMediaType()

        /**
         * Redirects are refused: a 30x from the paired host to anywhere else would resend the
         * bearer token and health payload to an address the owner never validated.
         */
        val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .build()
        }

        /** `{"installationId":…,"events":[…]}` with the already-serialized events spliced in. */
        fun buildEventsBody(installationId: String, eventsJson: List<String>): String {
            val prefix = buildJsonObject { put("installationId", installationId) }.toString().dropLast(1)
            return eventsJson.joinToString(separator = ",", prefix = "$prefix,\"events\":[", postfix = "]}")
        }

        /** Decompressed size of [buildEventsBody] without building it. */
        fun eventsBodySize(installationId: String, eventSizes: List<Int>): Long {
            val overhead = buildEventsBody(installationId, emptyList()).toByteArray(Charsets.UTF_8).size
            return overhead + eventSizes.sum().toLong() + (eventSizes.size - 1).coerceAtLeast(0)
        }

        fun gzipBytes(raw: ByteArray): ByteArray {
            val out = ByteArrayOutputStream(raw.size / 4 + 64)
            GZIPOutputStream(out).use { it.write(raw) }
            return out.toByteArray()
        }

        /** Retry-After as delta-seconds or an HTTP-date; null when absent or unparseable. */
        fun parseRetryAfter(value: String?, nowMillis: Long): Long? {
            val trimmed = value?.trim().orEmpty()
            if (trimmed.isEmpty()) return null
            trimmed.toLongOrNull()?.let { return (it.coerceAtLeast(0) * 1_000L) }
            return runCatching {
                val at = ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
                (at - nowMillis).coerceAtLeast(0)
            }.getOrNull()
        }

        /** Exception text without anything that could carry the token. */
        private fun safeMessage(e: Exception): String {
            val message = e.message.orEmpty().replace(Regex("Bearer\\s+\\S+"), "Bearer <redacted>")
            return (if (message.isBlank()) e.javaClass.simpleName else "${e.javaClass.simpleName}: $message").take(300)
        }

        private fun JsonObject.string(key: String): String? =
            runCatching { this[key]?.jsonPrimitive?.takeIf { it.isString }?.content }.getOrNull()
    }
}
