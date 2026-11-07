package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.SleepStage
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class HubEventMapperTest {
    private val observed = Instant.parse("2026-10-20T07:30:00Z")
    private val received = Instant.parse("2026-10-20T07:35:00Z")

    private fun root(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    @Test fun `category is the MQTT topic suffix for every kind of record`() {
        val cases = listOf(
            PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 61.0, observed) to "metrics/hr",
            PulseEvent.BloodPressureSample(120, 80, observed, isHistory = true) to "metrics/blood_pressure",
            PulseEvent.VendorMetric("Vascular Age", 39.0, "years", observed) to "vendor/vascular_age",
            PulseEvent.ActivityUpdate(observed, 1000, 700.0, 50.0) to "activity/daily",
            PulseEvent.ActivityBucket(observed, 100, 70.0) to "activity/buckets",
            PulseEvent.SleepTimeline(observed, listOf(SleepStage.LIGHT, SleepStage.DEEP)) to "sleep/timeline",
            PulseEvent.DerivedInsight("sleep_score", 82.0, "score", observed, "medium", "v1") to "insights/sleep_score",
            PulseEvent.BatteryLevel(55) to "state/battery",
        )
        for ((event, category) in cases) {
            val hub = HubEventMapper.toHubOutbox(event, "install123", received)!!
            val mqtt = BroadcastEventMapper.toOutbox(event, "install123", received)!!
            assertEquals(category, hub.category)
            assertEquals(mqtt.topicSuffix, hub.category)
            // Same deterministic id on both transports.
            assertEquals(mqtt.eventId, hub.eventId)
            val envelope = root(hub.payloadJson)
            assertEquals(category, envelope.getValue("category").jsonPrimitive.content)
            assertEquals("1.0", envelope.getValue("specversion").jsonPrimitive.content)
            assertEquals("urn:pulseloop:installation:install123", envelope.getValue("source").jsonPrimitive.content)
            val data = envelope.getValue("data").jsonObject
            assertEquals("1", data.getValue("schema_version").jsonPrimitive.content)
            assertTrue("observed_at" in data && "received_at" in data)
            // MQTT keeps its payload exactly as before: the topic already carries the category.
            assertFalse("category" in root(mqtt.payloadJson))
        }
        assertNull(HubEventMapper.toHubOutbox(PulseEvent.ActivitySyncReset, "i", received))
    }

    @Test fun `a reading deletion is a 90 second range in the reading's category`() {
        val deletedAt = Instant.parse("2026-10-21T09:00:00Z")
        val at = observed.toEpochMilli()
        val rows = listOf(
            MeasurementEntity(id = "history:hr:$at", kindRaw = "HEART_RATE", value = 70.0, unit = "bpm", timestamp = at, sourceRaw = "history"),
            MeasurementEntity(id = "vendor:vascular_age:$at", kindRaw = "VENDOR_VASCULAR_AGE", value = 39.0, unit = "years", timestamp = at, sourceRaw = "vendor_history"),
            MeasurementEntity(id = "bp-s", kindRaw = "BLOOD_PRESSURE_SYSTOLIC", value = 120.0, unit = "mmHg", timestamp = at, sourceRaw = "history"),
            MeasurementEntity(id = "bp-d", kindRaw = "BLOOD_PRESSURE_DIASTOLIC", value = 80.0, unit = "mmHg", timestamp = at, sourceRaw = "history"),
            MeasurementEntity(id = "x", kindRaw = "NOT_A_KIND", value = 1.0, unit = "", timestamp = at, sourceRaw = "live"),
        )
        val events = HubEventMapper.measurementDeletions(rows, "install123", deletedAt)
        val targets = events.map { root(it.payloadJson).getValue("data").jsonObject.getValue("target").jsonObject }
        val categories = targets.map { it.getValue("category").jsonPrimitive.content }
        // One blood-pressure reading, both rows: one combined target plus each per-kind spelling.
        assertEquals(
            listOf("metrics/hr", "vendor/vascular_age", "metrics/blood_pressure", "metrics/bp_sys", "metrics/bp_dia"),
            categories,
        )
        for (event in events) {
            assertEquals("deletion", event.category)
            val envelope = root(event.payloadJson)
            assertEquals("com.pulseloop.deletion.v1", envelope.getValue("type").jsonPrimitive.content)
            assertEquals("deletion", envelope.getValue("category").jsonPrimitive.content)
            val data = envelope.getValue("data").jsonObject
            assertEquals("1", data.getValue("schema_version").jsonPrimitive.content)
            assertEquals(deletedAt.toString(), data.getValue("observed_at").jsonPrimitive.content)
        }
        val hr = targets.first()
        assertEquals("hr", hr.getValue("kind").jsonPrimitive.content)
        assertEquals("2026-10-20T07:28:30Z", hr.getValue("from").jsonPrimitive.content)
        assertEquals("2026-10-20T07:31:30Z", hr.getValue("to").jsonPrimitive.content)
        assertEquals(events.size, events.map { it.eventId }.toSet().size)
    }

    @Test fun `every deletion target but star names both ends of its range`() {
        val at = Instant.parse("2026-10-21T09:00:00Z")
        val rows = MeasurementKind.entries.map { kind ->
            MeasurementEntity(id = "history:${kind.key}:1", kindRaw = kind.name, value = 1.0, unit = "u", timestamp = observed.toEpochMilli(), sourceRaw = "history")
        } + MeasurementEntity(id = "v", kindRaw = "VENDOR_stress index", value = 1.0, unit = "", timestamp = observed.toEpochMilli(), sourceRaw = "vendor_history")
        val events = HubEventMapper.measurementDeletions(rows, "install123", at) + HubEventMapper.resetAll("install123", at)
        for (e in events) {
            val target = root(e.payloadJson).getValue("data").jsonObject.getValue("target").jsonObject
            if (target.getValue("category").jsonPrimitive.content == "*") continue
            val from = Instant.parse(target.getValue("from").jsonPrimitive.content)
            val to = Instant.parse(target.getValue("to").jsonPrimitive.content)
            assertTrue(!from.isAfter(to))
        }
        fun target(vararg pairs: Pair<String, String>) = JsonObject(pairs.associate { it.first to JsonPrimitive(it.second) })
        assertTrue(HubEventMapper.isValidTarget(target("category" to "*")))
        assertFalse(HubEventMapper.isValidTarget(target("category" to "metrics/hr", "from" to "2026-10-20T07:28:30Z")))
        assertFalse(HubEventMapper.isValidTarget(target("category" to "sleep/timeline", "to" to "2026-10-20T07:28:30Z")))
        assertFalse(HubEventMapper.isValidTarget(target("category" to "metrics/hr", "from" to "2026-10-21T00:00:00Z", "to" to "2026-10-20T00:00:00Z")))
        assertFalse(HubEventMapper.isValidTarget(target("category" to "metrics/hr", "from" to "yesterday", "to" to "2026-10-20T00:00:00Z")))
        assertThrows(IllegalArgumentException::class.java) {
            HubEventMapper.deletion(target("category" to "metrics/hr"), "install123", at)
        }
    }

    @Test fun `reset sends category star and each deletion is a distinct event`() {
        val first = HubEventMapper.resetAll("install123", Instant.parse("2026-10-21T09:00:00Z"))
        val second = HubEventMapper.resetAll("install123", Instant.parse("2026-10-21T09:00:01Z"))
        val target = root(first.payloadJson).getValue("data").jsonObject.getValue("target").jsonObject
        assertEquals(mapOf("category" to "*"), target.mapValues { it.value.jsonPrimitive.content })
        assertNotEquals(first.eventId, second.eventId)
        assertTrue(first.eventId.startsWith("pl-"))
    }
}
