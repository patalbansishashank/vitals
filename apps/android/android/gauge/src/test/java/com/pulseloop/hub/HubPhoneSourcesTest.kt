package com.pulseloop.hub

import com.pulseloop.data.sources.HcRecordEntity
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The GB upload plug-ins: batching, cursors, reset, envelope (SPEC §GB tests, §2.1). */
class HubPhoneSourcesTest {
    private class MemCursor : HubSourceCursor { override var value: String? = null }

    private class PhoneMem : HubPhoneStepsSource.Store {
        val records = mutableListOf<PhoneStepRecordEntity>()
        val intervals = mutableListOf<PhoneAcquisitionEntity>()
        var calls = 0
        override suspend fun recordsAfter(afterSeq: Long, limit: Int) = records.filter { it.seq > afterSeq }.take(limit).also { calls++ }
        override suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int) =
            intervals.filter { it.toMs != null && it.seq > afterSeq }.take(limit)
    }

    private class HcMem : HubHealthConnectSource.Store {
        val rows = mutableListOf<HcRecordEntity>()
        override suspend fun recordsAfter(afterSeq: Long, limit: Int) = rows.filter { it.seq > afterSeq }.take(limit)
    }

    private val t0 = Instant.parse("2026-10-27T09:00:00Z").toEpochMilli()
    private val received = Instant.parse("2026-10-27T10:00:00Z")

    private fun record(seq: Long) = PhoneStepRecordEntity(
        seq = seq, subject = "phone_steps:b7:${seq * 60_000_000_000L}", startMs = t0 + seq * 60_000, endMs = t0 + (seq + 1) * 60_000,
        steps = seq % 3, support = "minute", timing = "detector", parentSteps = 120, bootId = "b7",
        mStartNs = seq * 60_000_000_000L, mEndNs = (seq + 1) * 60_000_000_000L, anchorId = "b7:1:2", createdAtMs = t0,
    )

    private fun phoneSource(store: PhoneMem, outbox: FakeHubOutboxDao, settings: FakeHubSettings, rc: MemCursor = MemCursor(), ac: MemCursor = MemCursor()) =
        HubPhoneStepsSource(store, outbox, settings, rc, ac, now = { received }, pageSize = 50, maxPagesPerCall = 3)

    @Test fun `phone records reach the outbox in bounded pages and resume from the cursor`() = runBlocking {
        val store = PhoneMem().apply { (1L..400L).forEach { records += record(it) } }
        val outbox = FakeHubOutboxDao()
        val settings = FakeHubSettings("https://hub.example")
        val cursor = MemCursor()
        val source = phoneSource(store, outbox, settings, rc = cursor)
        assertEquals(150, source.enqueueChanged())
        assertEquals("150", cursor.value)
        assertEquals(150, outbox.rows.size)
        while (source.enqueueChanged() > 0) Unit
        assertEquals(400, outbox.rows.size)
        assertEquals(0, source.enqueueChanged())
    }

    @Test fun `a re-sent row is the same event, and reset re-sends everything`() = runBlocking {
        val store = PhoneMem().apply { (1L..10L).forEach { records += record(it) } }
        val outbox = FakeHubOutboxDao()
        val cursor = MemCursor()
        val source = phoneSource(store, outbox, FakeHubSettings("https://hub.example"), rc = cursor)
        source.enqueueChanged()
        val ids = outbox.rows.keys.toSet()
        source.reset()
        assertNull(cursor.value)
        source.enqueueChanged()
        assertEquals(ids, outbox.rows.keys.toSet())
    }

    @Test fun `nothing is queued while unpaired`() = runBlocking {
        val store = PhoneMem().apply { records += record(1) }
        val settings = FakeHubSettings("https://hub.example").apply { unpair() }
        val outbox = FakeHubOutboxDao()
        assertEquals(0, phoneSource(store, outbox, settings).enqueueChanged())
        assertEquals(0, store.calls)
    }

    @Test fun `the phone_steps event carries the contract fields`() {
        val e = HubPhoneStepsSource.stepsEvent(record(5), "install123", received)
        val env = Json.parseToJsonElement(e.payloadJson).jsonObject
        assertEquals("activity/phone_steps", env["category"]!!.jsonPrimitive.content)
        assertEquals("com.pulseloop.activity.phone_steps.v1", env["type"]!!.jsonPrimitive.content)
        assertEquals("phone_steps:b7:300000000000", env["subject"]!!.jsonPrimitive.content)
        val data = env["data"]!!.jsonObject
        for (k in listOf("start", "end", "steps", "support", "timing", "parent_steps", "boot_id", "m_start_ns", "m_end_ns", "utc_anchor_id", "received_at")) {
            assertTrue("missing $k", k in data)
        }
        assertTrue(data["m_start_ns"]!!.jsonPrimitive.isString)
        // received_at is not part of the identity: the same record later is the same event.
        assertEquals(e.eventId, HubPhoneStepsSource.stepsEvent(record(5), "install123", received.plusSeconds(999)).eventId)
        assertTrue(e.eventId.startsWith("pl-"))
    }

    @Test fun `only closed acquisition intervals upload`() = runBlocking {
        val store = PhoneMem().apply {
            intervals += PhoneAcquisitionEntity(seq = 1, fromMs = t0, toMs = t0 + 3_600_000, state = "listening", lastSeenMs = t0 + 3_600_000)
            intervals += PhoneAcquisitionEntity(seq = 2, fromMs = t0 + 3_600_000, toMs = null, state = "listening", lastSeenMs = t0 + 3_700_000)
        }
        val outbox = FakeHubOutboxDao()
        phoneSource(store, outbox, FakeHubSettings("https://hub.example")).enqueueChanged()
        val data = outbox.rows.values.single().let { Json.parseToJsonElement(it.payloadJson).jsonObject }
        assertEquals("phone/acquisition", data["category"]!!.jsonPrimitive.content)
        assertEquals("listening", data["data"]!!.jsonObject["state"]!!.jsonPrimitive.content)
    }

    @Test fun `a listening interval carries the detector registration and observed_zero`() {
        fun data(detector: String?, state: String = "listening") = HubPhoneStepsSource.acquisitionEvent(
            PhoneAcquisitionEntity(seq = 1, fromMs = t0, toMs = t0 + 3_600_000, state = state, lastSeenMs = t0 + 3_600_000, detector = detector),
            "install123", received,
        )!!.let { Json.parseToJsonElement(it.payloadJson).jsonObject["data"]!!.jsonObject }
        val registered = data("registered")
        assertEquals("registered", registered["detector"]!!.jsonPrimitive.content)
        assertEquals(true, registered["observed_zero"]!!.jsonPrimitive.content.toBoolean())
        for (other in listOf("absent", "failed")) {
            val d = data(other)
            assertEquals(other, d["detector"]!!.jsonPrimitive.content)
            assertEquals(false, d["observed_zero"]!!.jsonPrimitive.content.toBoolean())
        }
        // Rows from before 2.8.1, and every non-listening state: neither field (unknown, as before).
        for (d in listOf(data(null), data(null, state = "stopped"), data("registered", state = "stopped"))) {
            assertTrue("detector" !in d && "observed_zero" !in d)
        }
    }

    @Test fun `health connect rows page into hc record and hc deleted events`() = runBlocking {
        val store = HcMem()
        (1L..25L).forEach {
            store.rows += HcRecordEntity(
                seq = it, key = "Steps:id$it", recordType = "Steps", hcId = "id$it", deleted = it == 25L,
                lastModifiedMs = t0 + it, startMs = t0, readAtMs = t0,
                dataJson = if (it == 25L) """{"schema_version":1,"record_type":"Steps"}"""
                else """{"schema_version":1,"record_type":"Steps","payload":{"count":$it}}""",
            )
        }
        val outbox = FakeHubOutboxDao()
        val cursor = MemCursor()
        val source = HubHealthConnectSource(store, outbox, FakeHubSettings("https://hub.example"), cursor, now = { received }, pageSize = 10, maxPagesPerCall = 2)
        assertEquals(20, source.enqueueChanged())
        assertEquals("20", cursor.value)
        assertEquals(5, source.enqueueChanged())
        val categories = outbox.rows.values.map { (Json.parseToJsonElement(it.payloadJson).jsonObject["category"]!!.jsonPrimitive.content) }
        assertEquals(24, categories.count { it == "hc/record" })
        assertEquals(1, categories.count { it == "hc/deleted" })
        val deleted = outbox.rows.values.map { Json.parseToJsonElement(it.payloadJson).jsonObject }.single { it["category"]!!.jsonPrimitive.content == "hc/deleted" }
        assertEquals("Steps:id25", deleted["subject"]!!.jsonPrimitive.content)
        assertFalse((deleted["data"] as JsonObject).containsKey("payload"))
    }
}
