package com.pulseloop.hub

import com.pulseloop.data.sources.ActivityAcquisitionEntity
import com.pulseloop.data.sources.ActivityTransitionEntity
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `phone/activity_transition` and `phone/activity_recognition_acquisition` uploads (auto-detection CONTRACT §1). */
class HubActivityRecognitionSourceTest {
    private class MemCursor : HubSourceCursor { override var value: String? = null }

    private class Mem : HubActivityRecognitionSource.Store {
        val transitions = mutableListOf<ActivityTransitionEntity>()
        val intervals = mutableListOf<ActivityAcquisitionEntity>()
        override suspend fun transitionsAfter(afterSeq: Long, limit: Int) = transitions.filter { it.seq > afterSeq }.take(limit)
        override suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int) = intervals.filter { it.toMs != null && it.seq > afterSeq }.take(limit)
    }

    private val occurred = Instant.parse("2026-10-28T08:02:30.125Z")
    private val received = Instant.parse("2026-10-28T08:10:00Z")

    /** Past 2^53 ns (≈104 days of uptime): must survive as a decimal string. */
    private val bigNs = 9_007_199_254_740_993L

    private fun transition(seq: Long = 1, elapsedNs: Long = bigNs, anchorId: String = "b9:1:2", epoch: Int = 4, occurredMs: Long = occurred.toEpochMilli()) =
        ActivityTransitionEntity(
            seq = seq, bootId = "b9", elapsedNs = elapsedNs, activity = "WALKING", transition = "ENTER",
            occurredAtMs = occurredMs, anchorId = anchorId, registrationEpoch = epoch, receivedAtMs = received.toEpochMilli(),
        )

    private fun parse(payload: String) = Json.parseToJsonElement(payload).jsonObject

    @Test fun `the transition event is exactly the contract`() {
        val e = HubActivityRecognitionSource.transitionEvent(transition(), "install123", received)
        val env = parse(e.payloadJson)
        assertEquals("phone/activity_transition", env["category"]!!.jsonPrimitive.content)
        assertEquals("com.pulseloop.phone.activity_transition.v1", env["type"]!!.jsonPrimitive.content)
        assertEquals("WALKING", env["subject"]!!.jsonPrimitive.content)
        assertEquals("2026-10-28T08:02:30.125Z", env["time"]!!.jsonPrimitive.content)
        assertEquals("urn:pulseloop:installation:install123", env["source"]!!.jsonPrimitive.content)
        assertEquals(e.eventId, env["id"]!!.jsonPrimitive.content)
        val expected = JsonObject(
            mapOf(
                "schema_version" to JsonPrimitive(1),
                // The hub envelope's own two fields, on every event.
                "observed_at" to JsonPrimitive("2026-10-28T08:02:30.125Z"),
                "activity" to JsonPrimitive("WALKING"),
                "transition" to JsonPrimitive("ENTER"),
                "occurred_at" to JsonPrimitive("2026-10-28T08:02:30.125Z"),
                "boot_id" to JsonPrimitive("b9"),
                "elapsed_ns" to JsonPrimitive("9007199254740993"),
                "registration_epoch" to JsonPrimitive(4),
                "received_at" to JsonPrimitive("2026-10-28T08:10:00Z"),
            ),
        )
        assertEquals(expected, env["data"]!!.jsonObject)
        assertTrue(env["data"]!!.jsonObject["elapsed_ns"]!!.jsonPrimitive.isString)
    }

    @Test fun `the transition id is installation, boot, elapsed ns, activity and transition only`() {
        val id = HubActivityRecognitionSource.transitionEvent(transition(), "install123", received).eventId
        assertTrue(id.startsWith("pl-"))
        assertTrue(Regex("^[A-Za-z0-9._:-]{1,128}$").matches(id))
        // Same event re-mapped with another anchor, epoch, row or upload time: same id.
        val again = transition(seq = 77, anchorId = "b9:5:6", epoch = 9, occurredMs = occurred.toEpochMilli() + 3_600_000)
        assertEquals(id, HubActivityRecognitionSource.transitionEvent(again, "install123", received.plusSeconds(600)).eventId)
        // Any identity field changes it.
        assertNotEquals(id, HubActivityRecognitionSource.transitionEvent(transition(), "install999", received).eventId)
        assertNotEquals(id, HubActivityRecognitionSource.transitionEvent(transition(elapsedNs = bigNs + 1), "install123", received).eventId)
        assertNotEquals(id, HubActivityRecognitionSource.transitionEvent(transition().copy(transition = "EXIT"), "install123", received).eventId)
        assertNotEquals(id, HubActivityRecognitionSource.transitionEvent(transition().copy(activity = "RUNNING"), "install123", received).eventId)
        assertNotEquals(id, HubActivityRecognitionSource.transitionEvent(transition().copy(bootId = "b10"), "install123", received).eventId)
    }

    @Test fun `the acquisition interval is exactly the contract, and open intervals do not upload`() = runBlocking {
        val from = Instant.parse("2026-10-28T08:00:00Z").toEpochMilli()
        val store = Mem().apply {
            intervals += ActivityAcquisitionEntity(seq = 1, fromMs = from, toMs = from + 1_800_000, state = "listening", lastSeenMs = from + 1_800_000, registrationEpoch = 2)
            intervals += ActivityAcquisitionEntity(seq = 2, fromMs = from + 1_800_000, toMs = null, state = "failed", lastSeenMs = from + 1_900_000, registrationEpoch = 3)
        }
        val outbox = FakeHubOutboxDao()
        val source = HubActivityRecognitionSource(store, outbox, FakeHubSettings("https://hub.example"), MemCursor(), MemCursor(), now = { received })
        assertEquals(1, source.enqueueChanged())
        val env = parse(outbox.rows.values.single().payloadJson)
        assertEquals("phone/activity_recognition_acquisition", env["category"]!!.jsonPrimitive.content)
        assertEquals("activity_recognition_acquisition", env["subject"]!!.jsonPrimitive.content)
        val expected = JsonObject(
            mapOf(
                "schema_version" to JsonPrimitive(1),
                "observed_at" to JsonPrimitive("2026-10-28T08:00:00Z"),
                "from" to JsonPrimitive("2026-10-28T08:00:00Z"),
                "to" to JsonPrimitive("2026-10-28T08:30:00Z"),
                "state" to JsonPrimitive("listening"),
                "registration_epoch" to JsonPrimitive(2),
                "received_at" to JsonPrimitive("2026-10-28T08:10:00Z"),
            ),
        )
        assertEquals(expected, env["data"]!!.jsonObject)
        assertNull(HubActivityRecognitionSource.acquisitionEvent(store.intervals[1], "install123", received))
    }

    @Test fun `idempotent replay - a reset re-queues the same ids, the outbox keeps one of each`() = runBlocking {
        val store = Mem().apply { (1L..30L).forEach { transitions += transition(seq = it, elapsedNs = it * 1_000_000_000L) } }
        val outbox = FakeHubOutboxDao()
        val tc = MemCursor()
        val source = HubActivityRecognitionSource(store, outbox, FakeHubSettings("https://hub.example"), tc, MemCursor(), now = { received }, pageSize = 8, maxPagesPerCall = 2)
        assertEquals(16, source.enqueueChanged())
        assertEquals("16", tc.value)
        while (source.enqueueChanged() > 0) Unit
        val ids = outbox.rows.keys.toSet()
        assertEquals(30, ids.size)
        source.reset()
        assertNull(tc.value)
        while (source.enqueueChanged() > 0) Unit
        assertEquals(ids, outbox.rows.keys.toSet())
    }

    @Test fun `nothing is queued while unpaired`() = runBlocking {
        val store = Mem().apply { transitions += transition() }
        val settings = FakeHubSettings("https://hub.example").apply { unpair() }
        val outbox = FakeHubOutboxDao()
        assertEquals(0, HubActivityRecognitionSource(store, outbox, settings, MemCursor(), MemCursor()).enqueueChanged())
        assertTrue(outbox.rows.isEmpty())
    }
}
