package com.pulseloop.shortvideo

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * What the debug/tuning section shows. Holds view ids, class names, rules and counts only —
 * never on-screen text — so it is safe to copy into a bug report.
 */
@Serializable
data class ShortVideoDebugEntry(
    val atMs: Long,
    val app: String,
    val kind: String,
    val detail: String,
)

object ShortVideoDebugLog {
    private const val MAX_EVENTS = 120
    private const val MAX_LAYOUTS = 40
    private const val PREFS = "short_video_debug"
    private const val KEY_LAYOUTS = "unknown_layouts"
    private val json = Json { ignoreUnknownKeys = true }

    private val eventsState = MutableStateFlow<List<ShortVideoDebugEntry>>(emptyList())
    private val layoutsState = MutableStateFlow<List<ShortVideoDebugEntry>>(emptyList())
    private val lastState = MutableStateFlow<Map<String, String>>(emptyMap())
    @Volatile private var loaded = false

    /** Recent counter events and classifications (in memory). */
    val events: StateFlow<List<ShortVideoDebugEntry>> = eventsState.asStateFlow()
    /** Layouts that matched only a fallback rule or nearly matched (kept across restarts). */
    val unknownLayouts: StateFlow<List<ShortVideoDebugEntry>> = layoutsState.asStateFlow()
    /** Last classification per app, e.g. "instagram" → "in Reels via SCREEN_ID clips_viewer_view_pager". */
    val lastClassification: StateFlow<Map<String, String>> = lastState.asStateFlow()

    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val raw = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LAYOUTS, null)
        layoutsState.value = raw?.let { runCatching { json.decodeFromString<List<ShortVideoDebugEntry>>(it) }.getOrNull() }.orEmpty()
    }

    fun event(app: ShortVideoApp?, kind: String, detail: String, atMs: Long = System.currentTimeMillis()) {
        eventsState.value = (listOf(ShortVideoDebugEntry(atMs, app?.key ?: "-", kind, detail)) + eventsState.value).take(MAX_EVENTS)
    }

    fun classification(app: ShortVideoApp, summary: String) {
        lastState.value = lastState.value + (app.key to summary)
    }

    /** Record a layout for tuning; identical id sets are kept once (newest first). */
    fun unknownLayout(context: Context, app: ShortVideoApp, detail: String, atMs: Long = System.currentTimeMillis()) {
        load(context)
        val current = layoutsState.value
        if (current.any { it.app == app.key && it.detail == detail }) return
        val next = (listOf(ShortVideoDebugEntry(atMs, app.key, "layout", detail)) + current).take(MAX_LAYOUTS)
        layoutsState.value = next
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LAYOUTS, json.encodeToString(next)).apply()
    }

    fun clear(context: Context) {
        eventsState.value = emptyList()
        layoutsState.value = emptyList()
        lastState.value = emptyMap()
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun exportText(): String = buildString {
        appendLine("Gauge short-video debug (view ids and rules only, no on-screen text)")
        lastState.value.forEach { (app, s) -> appendLine("last[$app]: $s") }
        appendLine("-- unknown / fallback layouts --")
        layoutsState.value.forEach { appendLine("${it.atMs} ${it.app}: ${it.detail}") }
        appendLine("-- recent events --")
        eventsState.value.forEach { appendLine("${it.atMs} ${it.app} ${it.kind}: ${it.detail}") }
    }
}
