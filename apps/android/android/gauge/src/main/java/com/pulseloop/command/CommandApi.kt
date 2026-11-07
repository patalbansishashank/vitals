package com.pulseloop.command

import com.pulseloop.hub.HubUrl
import com.pulseloop.hub.OkHttpHubApi
import java.io.IOException
import java.time.Instant
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

/** One command from Vitals, as the server hands it out (energy SPEC §A.4 item 7). Times are epoch millis, server clock. */
data class RemoteCommand(
    val id: String,
    val seq: Long,
    val type: String,
    val payload: JsonObject,
    val issuedAt: Long,
    val expiresAt: Long,
    val attempt: Int,
)

/** What Gauge reports back for one command: `running`, then one terminal status. Never a health value beyond the result. */
data class CommandAck(val status: String, val code: String? = null, val result: JsonObject? = null) {
    val terminal: Boolean get() = status != RUNNING

    fun toJson(): JsonObject = buildJsonObject {
        put("status", status)
        code?.let { put("code", it) }
        result?.let { put("result", it) }
    }

    companion object {
        const val RUNNING = "running"
        fun done(result: JsonObject? = null) = CommandAck("done", null, result)
        fun noop(result: JsonObject? = null) = CommandAck("noop", null, result)
        fun rejected(code: String, result: JsonObject? = null) = CommandAck("rejected", code, result)
        fun failed(code: String) = CommandAck("failed", code)
        val expired = CommandAck("expired")

        fun fromJson(o: JsonObject): CommandAck? {
            val status = runCatching { o["status"]?.jsonPrimitive?.content }.getOrNull() ?: return null
            return CommandAck(
                status = status,
                code = runCatching { o["code"]?.jsonPrimitive?.takeIf { it.isString }?.content }.getOrNull(),
                result = o["result"] as? JsonObject,
            )
        }
    }
}

sealed interface PollResult {
    data class Ok(val serverNow: Long, val personId: String, val maxWaitS: Int, val commands: List<RemoteCommand>) : PollResult
    data object Unauthorized : PollResult
    /** 429 / 503; [retryAfterMs] when the server sent a usable Retry-After. */
    data class Throttled(val retryAfterMs: Long?) : PollResult
    data class Failed(val status: Int?, val error: String) : PollResult
}

sealed interface SendResult {
    data object Ok : SendResult
    data object Unauthorized : SendResult
    /** 404 (not ours, or gone) or 409 (already terminal, superseded): nothing to retry. */
    data class Refused(val status: Int) : SendResult
    data class Failed(val status: Int?, val error: String) : SendResult
}

/** The three `/v1/lumen/commands*` calls. */
interface CommandApi {
    /** `GET /v1/lumen/commands?wait=` (0–25 s hold). */
    suspend fun poll(serverUrl: String, token: String, waitS: Int): PollResult
    suspend fun ack(serverUrl: String, token: String, id: String, ack: CommandAck): SendResult
    suspend fun postState(serverUrl: String, token: String, state: JsonObject): SendResult
}

/**
 * Over the hub's OkHttp client: 15 s connect, 60 s read (longer than the 25 s hold), redirects refused (a 30x would
 * resend the bearer to an address the owner never validated).
 */
class OkHttpCommandApi(
    private val client: OkHttpClient = OkHttpHubApi.defaultClient,
    private val now: () -> Long = System::currentTimeMillis,
) : CommandApi {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun poll(serverUrl: String, token: String, waitS: Int): PollResult = withContext(Dispatchers.IO) {
        val wait = waitS.coerceIn(0, MAX_WAIT_S)
        val request = Request.Builder()
            .url(HubUrl.normalize(serverUrl) + POLL_PATH + "?wait=$wait")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                when (response.code) {
                    200 -> parsePoll(response.body?.string().orEmpty()) ?: PollResult.Failed(200, "Unreadable server reply")
                    401 -> PollResult.Unauthorized
                    429, 503 -> PollResult.Throttled(OkHttpHubApi.parseRetryAfter(response.header("Retry-After"), now()))
                    else -> PollResult.Failed(response.code, "HTTP ${response.code}")
                }
            }
        } catch (e: IOException) {
            PollResult.Failed(null, e.javaClass.simpleName)
        }
    }

    override suspend fun ack(serverUrl: String, token: String, id: String, ack: CommandAck): SendResult =
        post(HubUrl.normalize(serverUrl) + POLL_PATH + "/" + id + "/ack", token, ack.toJson().toString())

    override suspend fun postState(serverUrl: String, token: String, state: JsonObject): SendResult =
        post(HubUrl.normalize(serverUrl) + STATE_PATH, token, state.toString())

    private suspend fun post(url: String, token: String, body: String): SendResult = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .post(body.toRequestBody(JSON))
            .build()
        try {
            client.newCall(request).execute().use { response ->
                when (response.code) {
                    in 200..299 -> SendResult.Ok
                    401 -> SendResult.Unauthorized
                    404, 409 -> SendResult.Refused(response.code)
                    else -> SendResult.Failed(response.code, "HTTP ${response.code}")
                }
            }
        } catch (e: IOException) {
            SendResult.Failed(null, e.javaClass.simpleName)
        }
    }

    internal fun parsePoll(text: String): PollResult.Ok? {
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val serverNow = root.time("now") ?: return null
        val commands = runCatching { root["commands"]?.jsonArray }.getOrNull().orEmpty().mapNotNull { element ->
            val o = element as? JsonObject ?: return@mapNotNull null
            val id = o.str("id") ?: return@mapNotNull null
            val type = o.str("type") ?: return@mapNotNull null
            RemoteCommand(
                id = id,
                seq = runCatching { o["seq"]?.jsonPrimitive?.longOrNull }.getOrNull() ?: 0L,
                type = type,
                payload = o["payload"] as? JsonObject ?: JsonObject(emptyMap()),
                issuedAt = o.time("issuedAt") ?: serverNow,
                expiresAt = o.time("expiresAt") ?: return@mapNotNull null,
                attempt = runCatching { o["attempt"]?.jsonPrimitive?.intOrNull }.getOrNull() ?: 1,
            )
        }.sortedBy { it.seq }
        return PollResult.Ok(
            serverNow = serverNow,
            personId = root.str("personId").orEmpty(),
            maxWaitS = runCatching { root["maxWaitS"]?.jsonPrimitive?.intOrNull }.getOrNull() ?: MAX_WAIT_S,
            commands = commands,
        )
    }

    companion object {
        const val POLL_PATH = "/v1/lumen/commands"
        const val STATE_PATH = "/v1/lumen/commands/state"
        const val MAX_WAIT_S = 25
        private val JSON = "application/json".toMediaType()

        private fun JsonObject.str(key: String): String? =
            runCatching { this[key]?.jsonPrimitive?.takeIf { it.isString }?.content }.getOrNull()

        private fun JsonObject.time(key: String): Long? = str(key)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
}
