package com.pulseloop.hub

import com.pulseloop.data.sources.HcRecordEntity
import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.health.reader.HcCapability
import com.pulseloop.health.reader.HcRecordMapper
import com.pulseloop.health.reader.HcRecordView
import com.pulseloop.health.reader.HcType
import com.pulseloop.phone.PhoneStepSegmenter
import com.pulseloop.phone.toEntity
import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The §2.1 event fixture for package GB's categories (`activity/phone_steps`, `phone/acquisition`,
 * `hc/record`, `hc/deleted`), built by the app's own segmenter and mappers, for S1/S2. It includes
 * the owner's treadmill shape: ten minutes of phone detector steps at ~100/min.
 *
 * Always checks the fixture; writes it when `LUMEN_GB_FIXTURE_OUT` names a file:
 * `LUMEN_GB_FIXTURE_OUT=/abs/gb.json ./gradlew :app:testDebugUnitTest --tests '*HubPhoneHcFixture*'`.
 * (GA's `HubE2eFixtureTest` keeps the ring categories.)
 */
class HubPhoneHcFixtureTest {
    @Test fun `builds the GB upload fixture`() {
        val events = build()
        val byCategory = events.groupBy { it["category"]!!.jsonPrimitive.content }
        assertEquals(setOf("activity/phone_steps", "phone/acquisition", "hc/record", "hc/deleted"), byCategory.keys)
        for (e in events) {
            assertEquals("1.0", e["specversion"]!!.jsonPrimitive.content)
            assertTrue(e["id"]!!.jsonPrimitive.content.startsWith("pl-"))
            assertEquals("urn:pulseloop:installation:$INSTALLATION", e["source"]!!.jsonPrimitive.content)
        }
        val treadmill = byCategory.getValue("activity/phone_steps").map { it["data"]!!.jsonObject }
            .filter { it["timing"]!!.jsonPrimitive.content == "detector" }
        assertEquals(1_000L, treadmill.sumOf { it["steps"]!!.jsonPrimitive.content.toLong() })
        assertEquals(events.size, events.map { it["id"]!!.jsonPrimitive.content }.distinct().size)
        System.getenv("LUMEN_GB_FIXTURE_OUT")?.takeIf { it.isNotBlank() }?.let { path ->
            val doc = buildJsonObject {
                put("installationId", INSTALLATION)
                put("events", JsonArray(events))
            }
            File(path).apply { parentFile?.mkdirs() }.writeText(Json.encodeToString(JsonObject.serializer(), doc))
        }
    }

    companion object {
        const val INSTALLATION = "5e2d8c41a7f94b0e9c3d1f6a2b7e8d90"
        private val T0: Instant = Instant.parse("2026-10-21T04:30:00Z") // 10:00 IST
        private val RECEIVED: Instant = Instant.parse("2026-10-21T05:00:00Z")

        fun build(): List<JsonObject> {
            val anchor = PhoneStepSegmenter.UtcAnchor("b42:${T0.toEpochMilli()}:9000000000000", "b42", T0.toEpochMilli(), 9_000_000_000_000L)
            val m0 = anchor.mNs
            val min = 60_000_000_000L
            // Treadmill: 10 min, 100 steps/min, phone in the pocket, detector timing (support:'minute').
            val treadmill = PhoneStepSegmenter.resolve(
                PhoneStepSegmenter.CounterSpan("b42", m0, m0 + 10 * min, 1_000, listenedThroughout = true),
                anchor,
                (1..1_000).map { m0 + it * 600_000_000L },
            )
            // Then the phone on the desk for 50 min and a short walk: one coarse counterSpan.
            val coarse = PhoneStepSegmenter.resolve(
                PhoneStepSegmenter.CounterSpan("b42", m0 + 10 * min, m0 + 60 * min, 240, listenedThroughout = false),
                anchor,
                null,
            )
            val phone = (treadmill + coarse).mapIndexed { i, r -> r.toEntity(RECEIVED.toEpochMilli()).copy(seq = i + 1L) }
                .map { HubPhoneStepsSource.stepsEvent(it, INSTALLATION, RECEIVED) }
            val acquisition = listOf(
                PhoneAcquisitionEntity(1, T0.toEpochMilli(), T0.toEpochMilli() + 1_800_000, "listening", 0),
                PhoneAcquisitionEntity(2, T0.toEpochMilli() + 1_800_000, T0.toEpochMilli() + 3_600_000, "stopped", 0),
            ).mapNotNull { HubPhoneStepsSource.acquisitionEvent(it, INSTALLATION, RECEIVED) }

            val natives = setOf(HcCapability.LEGACY_DEVICE_ORIGIN)
            fun view(type: HcType, id: String, origin: String, start: Instant, end: Instant, payload: JsonObject, method: Int = 2) = HcRecordView(
                type, id, origin, HcRecordView.DeviceInfo(2, "Google", "Pixel 8"), method, null,
                start, start, end, 330, 330, payload,
            )
            val hcViews = listOf(
                view(HcType.STEPS, "hc-steps-1", "android", T0, T0.plusSeconds(600), buildJsonObject { put("count", 980) }),
                view(HcType.WEIGHT, "hc-weight-1", "com.withings.wiscale2", T0, T0, buildJsonObject { put("kg", 81.4) }, method = 3),
                view(HcType.HEART_RATE, "hc-hr-1", "com.google.android.apps.fitness", T0, T0.plusSeconds(60),
                    Json.parseToJsonElement("""{"samples":[{"t":"2026-10-21T04:30:00Z","bpm":96},{"t":"2026-10-21T04:30:30Z","bpm":101}]}""").jsonObject),
            )
            val hc = hcViews.mapIndexed { i, v ->
                HcRecordEntity(i + 1L, v.key, v.type.recordType, v.id, false, v.lastModified.toEpochMilli(), v.start.toEpochMilli(),
                    HcRecordMapper.data(v, natives).toString(), RECEIVED.toEpochMilli())
            } + HcRecordEntity(9, "Steps:hc-steps-0", "Steps", "hc-steps-0", true, RECEIVED.toEpochMilli(), T0.toEpochMilli(),
                """{"schema_version":1,"observed_at":"$RECEIVED","record_type":"Steps"}""", RECEIVED.toEpochMilli())
            val hcEvents = hc.mapNotNull { HubHealthConnectSource.event(it, INSTALLATION, RECEIVED) }

            return (phone + acquisition + hcEvents).map { Json.parseToJsonElement(it.payloadJson).jsonObject }
        }
    }
}
