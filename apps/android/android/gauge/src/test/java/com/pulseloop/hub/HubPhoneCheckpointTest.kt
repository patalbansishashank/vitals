package com.pulseloop.hub

import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.PhoneStepRecordEntity
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phone step acquisition checkpoints (Gauge 2.8.3, auto-detection CONTRACT §1): an open interval reaches
 * the server at most every five minutes as `open: true`, closed intervals keep their hourly roll.
 */
class HubPhoneCheckpointTest {
    private class MemCursor : HubSourceCursor { override var value: String? = null }

    private class Mem : HubPhoneStepsSource.Store {
        val intervals = mutableListOf<PhoneAcquisitionEntity>()
        override suspend fun recordsAfter(afterSeq: Long, limit: Int) = emptyList<PhoneStepRecordEntity>()
        override suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int) = intervals.filter { it.toMs != null && it.seq > afterSeq }.take(limit)
        override suspend fun openInterval() = intervals.lastOrNull { it.toMs == null }
        fun touch(at: Long) { val i = intervals.indexOfLast { it.toMs == null }; intervals[i] = intervals[i].copy(lastSeenMs = at) }
    }

    private val hour = Instant.parse("2026-10-28T08:00:00Z").toEpochMilli()
    private var nowMs = hour + 60_000

    private fun rig(): Triple<Mem, FakeHubOutboxDao, HubPhoneStepsSource> {
        val store = Mem().apply {
            intervals += PhoneAcquisitionEntity(seq = 1, fromMs = hour, toMs = null, state = "listening", lastSeenMs = hour, detector = "registered")
        }
        val outbox = FakeHubOutboxDao()
        val source = HubPhoneStepsSource(
            store, outbox, FakeHubSettings("https://hub.example"), MemCursor(), MemCursor(),
            now = { Instant.ofEpochMilli(nowMs) }, checkpointCursor = MemCursor(),
        )
        return Triple(store, outbox, source)
    }

    private fun data(payload: String): JsonObject = Json.parseToJsonElement(payload).jsonObject["data"]!!.jsonObject
    private fun envelope(payload: String): JsonObject = Json.parseToJsonElement(payload).jsonObject

    @Test fun `a checkpoint carries open true, to = the last-seen moment, and the closed interval's identity fields`() = runBlocking {
        val (store, outbox, source) = rig()
        nowMs = hour + 4 * 60_000 + 20_000
        store.touch(hour + 4 * 60_000) // the counter's last heartbeat, 20 s ago
        assertEquals(1, source.enqueueChanged())
        val payload = outbox.rows.values.single().payloadJson
        val env = envelope(payload)
        assertEquals("phone/acquisition", env["category"]!!.jsonPrimitive.content)
        assertEquals("phone_acquisition", env["subject"]!!.jsonPrimitive.content)
        assertEquals("2026-10-28T08:00:00Z", env["time"]!!.jsonPrimitive.content)
        val d = data(payload)
        assertEquals(
            setOf("schema_version", "observed_at", "from", "to", "state", "detector", "observed_zero", "open", "received_at"),
            d.keys,
        )
        assertEquals("2026-10-28T08:00:00Z", d["observed_at"]!!.jsonPrimitive.content)
        assertEquals("2026-10-28T08:00:00Z", d["from"]!!.jsonPrimitive.content)
        // Not wall-clock now: never claims listening past the last moment it was known to hold.
        assertEquals("2026-10-28T08:04:00Z", d["to"]!!.jsonPrimitive.content)
        assertEquals("listening", d["state"]!!.jsonPrimitive.content)
        assertEquals(true, d["observed_zero"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(true, d["open"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test fun `at most one checkpoint per five minutes, and none when the interval has not moved`() = runBlocking {
        val (store, outbox, source) = rig()
        val queuedTo = mutableListOf<String>()
        fun collect() { queuedTo += outbox.rows.values.map { data(it.payloadJson)["to"]!!.jsonPrimitive.content }.filterNot { it in queuedTo } }
        // Uploads every minute for 20 minutes (a walk keeps the uploader busy); the counter touches each minute.
        for (m in 1..20) {
            nowMs = hour + m * 60_000L
            store.touch(nowMs)
            source.enqueueChanged()
            collect()
        }
        assertEquals(listOf("2026-10-28T08:01:00Z", "2026-10-28T08:06:00Z", "2026-10-28T08:11:00Z", "2026-10-28T08:16:00Z"), queuedTo)
        // The counter stopped touching (process gone): later calls queue nothing new.
        val before = outbox.rows.size
        for (m in 21..40) { nowMs = hour + m * 60_000L; source.enqueueChanged() }
        assertEquals(before + 1, outbox.rows.size) // one last checkpoint up to the final touch (08:20)
        assertEquals("2026-10-28T08:20:00Z", outbox.rows.values.map { data(it.payloadJson)["to"]!!.jsonPrimitive.content }.last())
    }

    @Test fun `the hourly roll still closes the interval and the closed one has no open flag`() = runBlocking {
        val (store, outbox, source) = rig()
        nowMs = hour + 30 * 60_000
        store.touch(nowMs)
        source.enqueueChanged()
        // The counter's touch after 09:00 rolls the interval (PhoneAcquisitionLog, unchanged).
        store.intervals[0] = store.intervals[0].copy(toMs = hour + 3_600_000, lastSeenMs = hour + 3_600_000)
        store.intervals += PhoneAcquisitionEntity(seq = 2, fromMs = hour + 3_600_000, toMs = null, state = "listening", lastSeenMs = hour + 3_660_000, detector = "registered")
        nowMs = hour + 3_660_000
        source.enqueueChanged()
        val all = outbox.rows.values.map { data(it.payloadJson) }
        val closed = all.filter { "open" !in it }
        assertEquals(1, closed.size)
        assertEquals("2026-10-28T08:00:00Z", closed.single()["from"]!!.jsonPrimitive.content)
        assertEquals("2026-10-28T09:00:00Z", closed.single()["to"]!!.jsonPrimitive.content)
        // Closed after the checkpoint of the same interval, so the server's newest-received rule keeps it.
        val sameFrom = outbox.rows.values.filter { data(it.payloadJson)["from"]!!.jsonPrimitive.content == "2026-10-28T08:00:00Z" }
        assertTrue(sameFrom.first().createdAt <= sameFrom.last().createdAt)
        assertTrue("open" in data(sameFrom.first().payloadJson))
        assertFalse("open" in data(sameFrom.last().payloadJson))
        // The continuation's checkpoint waits for the five-minute gate (the last one was at 08:30 → allowed now).
        assertEquals(1, all.count { "open" in it && it["from"]!!.jsonPrimitive.content == "2026-10-28T09:00:00Z" })
    }

    @Test fun `a reset forgets the checkpoint position`() = runBlocking {
        val (store, outbox, source) = rig()
        nowMs = hour + 120_000; store.touch(nowMs)
        assertEquals(1, source.enqueueChanged())
        nowMs += 60_000; store.touch(nowMs)
        assertEquals(0, source.enqueueChanged())
        source.reset()
        assertEquals(1, source.enqueueChanged())
        assertEquals(2, outbox.rows.size)
    }
}
