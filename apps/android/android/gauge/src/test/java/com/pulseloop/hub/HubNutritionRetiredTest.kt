package com.pulseloop.hub

import com.pulseloop.data.entity.DerivedUpdateEntity
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Nutrition moved to the Vitals app: Gauge stops uploading nutrition scores and hides old ones. */
class HubNutritionRetiredTest {
    private val scope = "2026-10-20T00:00:00Z"

    private fun row(kind: String) = DerivedUpdateEntity(
        kind = kind, entityType = "local_insight", entityId = scope,
        payloadJSON = """{"value":82.0,"unit":"score","confidence":"low","algorithm_version":"lumen-nutrition-v1"}""",
    )

    @Test fun `the backfill never uploads a stored nutrition score`() {
        assertNull(HubBackfill.insightEvent(row("nutrition_score")))
        assertNotNull(HubBackfill.insightEvent(row("recovery_score")))
    }

    @Test fun `old nutrition scores are hidden on the server with one valid deletion`() {
        val now = Instant.parse("2026-10-27T09:00:00Z")
        val events = HubEventMapper.retiredInsightDeletions("install-1", now)
        assertEquals(1, events.size)
        val event = events.single()
        assertEquals(HubEventMapper.DELETION_CATEGORY, event.category)
        val target = Json.parseToJsonElement(event.payloadJson).jsonObject
            .getValue("data").jsonObject.getValue("target").jsonObject
        assertEquals("insights/nutrition_score", target.getValue("category").jsonPrimitive.content)
        assertEquals(Instant.EPOCH.toString(), target.getValue("from").jsonPrimitive.content)
        assertEquals(now.toString(), target.getValue("to").jsonPrimitive.content)
        assertTrue(HubEventMapper.isValidTarget(target))
    }
}
