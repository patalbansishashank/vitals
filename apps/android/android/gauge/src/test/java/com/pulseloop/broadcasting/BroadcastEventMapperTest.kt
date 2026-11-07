package com.pulseloop.broadcasting

import com.pulseloop.ring.RING_VENDOR
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PacketDirection
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDecodedEvent
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BroadcastEventMapperTest {
    private val observed = Instant.parse("2026-09-14T12:30:00Z")
    private val received = Instant.parse("2026-09-14T12:35:00Z")

    @Test
    fun `history metric maps to stable CloudEvent and topic`() {
        val event = PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 72.0, observed)
        val first = BroadcastEventMapper.toOutbox(event, "install123", received)!!
        val second = BroadcastEventMapper.toOutbox(event, "install123", received.plusSeconds(30))!!

        assertEquals(first.eventId, second.eventId)
        assertEquals("metrics/hr", first.topicSuffix)
        assertEquals(1, first.qos)
        val root = Json.parseToJsonElement(first.payloadJson).jsonObject
        assertEquals("1.0", root.getValue("specversion").jsonPrimitive.content)
        assertEquals("health.metric.observed", root.getValue("type").jsonPrimitive.content)
        val data = root.getValue("data").jsonObject
        assertEquals("72.0", data.getValue("value").jsonPrimitive.content)
        assertEquals("device_history", data.getValue("provenance").jsonPrimitive.content)
        assertEquals("true", data.getValue("replayed").jsonPrimitive.content)
    }

    @Test
    fun `device connection payload omits Bluetooth address and name`() {
        val row = BroadcastEventMapper.toOutbox(
            PulseEvent.DeviceStateChanged(
                state = RingConnectionState.CONNECTED,
                address = "AA:BB:CC:DD:EE:FF",
                name = "$RING_VENDOR Smart Ring 7307",
            ),
            "install123",
            received,
        )!!
        assertFalse(row.payloadJson.contains("AA:BB"))
        assertFalse(row.payloadJson.contains("7307"))
        assertTrue(row.retain)
    }

    @Test
    fun `opaque vendor value is retained but clearly namespaced`() {
        val row = BroadcastEventMapper.toOutbox(
            PulseEvent.VendorMetric("vascular age", 39.0, "years", observed),
            "install123",
            received,
        )!!
        assertEquals("vendor/vascular_age", row.topicSuffix)
        assertTrue(row.payloadJson.contains("device_history_estimate"))
        assertTrue(row.payloadJson.contains("unverified"))
    }

    @Test
    fun `derived insight carries algorithm version confidence and inputs`() {
        val row = BroadcastEventMapper.toOutbox(
            PulseEvent.DerivedInsight(
                key = "recovery_score",
                value = 73.0,
                unit = "score",
                scopeStart = observed,
                confidence = "medium",
                algorithmVersion = "test-v1",
                inputs = mapOf("sleep_score" to 81.0, "hrv" to 47.0),
            ),
            "install123",
            received,
        )!!
        assertEquals("insights/recovery_score", row.topicSuffix)
        assertTrue(row.retain)
        assertTrue(row.payloadJson.contains("test-v1"))
        assertTrue(row.payloadJson.contains("locally_derived"))
    }

    @Test
    fun `raw BLE packet is never externally broadcast`() {
        assertNull(
            BroadcastEventMapper.toOutbox(
                PulseEvent.RawPacket(
                    PacketDirection.INCOMING,
                    byteArrayOf(0x55, 72),
                    RingDecodedEvent.Unknown(0x55u, byteArrayOf(0x55, 72)),
                ),
                "install123",
                received,
            )
        )
    }

    @Test
    fun `settings validation requires an address host and wildcard-free topic`() {
        val good = MqttBroadcastSettings(true, "ssl://broker.example:8883", "pulseloop/v1", "client", "", "")
        assertNull(good.validationError())
        assertTrue(good.copy(brokerUri = "broker.example").validationError() != null)
        assertTrue(good.copy(baseTopic = "pulseloop/#").validationError() != null)
        assertNull(good.copy(enabled = false, brokerUri = "").validationError())
    }
}
