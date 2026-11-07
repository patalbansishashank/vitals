package com.pulseloop.command

import com.pulseloop.hub.HubSettingsSource
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * `POST /v1/lumen/commands/state` (energy SPEC §A.4 item 8): on start, after every applied command, and when the
 * Reels settings or the live workout change, debounced 2 s. `reels` is `{enabled, dailyLimit, countdownSeconds, apps}`,
 * `recording` is `{sessionId, status, type, startedAt}` or null, `capabilities` lists the command types this build
 * runs. That is how Vitals learns the Reels settings and an active recording, whichever transport started it.
 */
class CommandStateReporter(
    private val api: CommandApi,
    private val settings: HubSettingsSource,
    private val snapshot: () -> JsonObject,
    private val debounceMs: Long = DEBOUNCE_MS,
) {
    private val requests = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Ask for a post (debounced). */
    fun request() {
        requests.tryEmit(Unit)
    }

    /** Posts now, then on every [request] and every change of [changes] (its first value is the start), until cancelled. */
    @OptIn(FlowPreview::class)
    suspend fun run(changes: Flow<Any?>) = coroutineScope {
        launch { changes.distinctUntilChanged().drop(1).collect { request() } }
        post()
        requests.debounce(debounceMs).collect { post() }
    }

    suspend fun post(): SendResult? {
        val pairing = settings.pairing.value?.takeUnless { it.needsRepair } ?: return null
        val r = api.postState(pairing.serverUrl, pairing.token, runCatching(snapshot).getOrNull() ?: return null)
        if (r == SendResult.Unauthorized) settings.markNeedsRepair(System.currentTimeMillis())
        return r
    }

    companion object {
        const val DEBOUNCE_MS = 2_000L
    }
}
