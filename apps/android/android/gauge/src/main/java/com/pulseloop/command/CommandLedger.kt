package com.pulseloop.command

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * The ids Gauge has run (energy SPEC §A.4 item 4): a JSON file in `filesDir`, not Room, so GA's migration chain is
 * untouched. It keeps the last [MAX_ENTRIES] ids or [MAX_AGE_MS], whichever is fewer, each with its terminal ack. An id
 * is noted ([begin]) before it runs, so a re-delivery after a process death never runs it twice; a re-delivered id
 * re-sends the stored ack and does nothing else.
 */
class CommandLedger(private val file: File, private val now: () -> Long = System::currentTimeMillis) {
    data class Entry(val id: String, val at: Long, val ack: CommandAck?)

    private val json = Json { ignoreUnknownKeys = true }
    private var entries: LinkedHashMap<String, Entry>? = null

    @Synchronized
    fun lookup(id: String): Entry? = load()[id]

    /** Noted before the command runs. */
    @Synchronized
    fun begin(id: String) {
        val map = load()
        if (map[id]?.ack != null) return
        map[id] = Entry(id, now(), null)
        save(map)
    }

    @Synchronized
    fun finish(id: String, ack: CommandAck) {
        val map = load()
        map.remove(id)
        map[id] = Entry(id, now(), ack)
        save(map)
    }

    @Synchronized
    fun size(): Int = load().size

    private fun load(): LinkedHashMap<String, Entry> {
        entries?.let { return it }
        val map = LinkedHashMap<String, Entry>()
        runCatching {
            if (file.exists()) {
                val root = json.parseToJsonElement(file.readText()).jsonObject
                for (e in root["entries"]?.jsonArray.orEmpty()) {
                    val o = e as? JsonObject ?: continue
                    val id = o["id"]?.jsonPrimitive?.content ?: continue
                    val at = o["at"]?.jsonPrimitive?.longOrNull ?: continue
                    map[id] = Entry(id, at, (o["ack"] as? JsonObject)?.let(CommandAck::fromJson))
                }
            }
        }
        prune(map)
        entries = map
        return map
    }

    private fun prune(map: LinkedHashMap<String, Entry>) {
        val cutoff = now() - MAX_AGE_MS
        map.values.removeAll { it.at < cutoff }
        while (map.size > MAX_ENTRIES) map.remove(map.keys.first())
    }

    private fun save(map: LinkedHashMap<String, Entry>) {
        prune(map)
        val body = buildJsonObject {
            put("version", 1)
            put("entries", buildJsonArray {
                for (e in map.values) add(buildJsonObject {
                    put("id", e.id)
                    put("at", e.at)
                    e.ack?.let { put("ack", it.toJson()) }
                })
            })
        }
        runCatching {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(body.toString())
            if (!tmp.renameTo(file)) {
                file.writeText(body.toString())
                tmp.delete()
            }
        }
    }

    companion object {
        const val FILE_NAME = "command_ledger.json"
        const val MAX_ENTRIES = 200
        const val MAX_AGE_MS = 7L * 24 * 3600_000
    }
}
