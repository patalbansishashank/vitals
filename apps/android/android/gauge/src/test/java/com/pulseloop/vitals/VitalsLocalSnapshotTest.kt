package com.pulseloop.vitals

import java.time.LocalDate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The engine's local snapshot (Gauge 2.8.7's provider answer, now read in-process by the Vitals plugin). */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class VitalsLocalSnapshotTest {
    @Test fun `the snapshot is schema 1 with counts and times only`() {
        val json = JSONObject(
            VitalsLocalSnapshot.json(
                VitalsLocalSnapshot.Input(
                    at = 1_793_000_000_000L, app = "2.8.7-debug", paired = true, pending = 37, lastSentAt = 1_792_999_000_000L,
                    lastError = "timeout", lastErrorAt = 1_792_999_500_000L, retryAt = null, needsRepair = false,
                    today = LocalDate.parse("2026-10-29"), ringSteps = 6120, ringStepsAt = 1_792_999_900_000L,
                ),
            ),
        )
        assertEquals(1, json.getInt("schema"))
        assertEquals(setOf("schema", "at", "app", "upload", "today"), json.keys().asSequence().toSet())
        val upload = json.getJSONObject("upload")
        assertEquals(37, upload.getInt("pending"))
        assertEquals("2026-10-26T07:16:40Z", upload.getString("lastSentAt"))
        assertTrue(upload.isNull("retryAt"))
        val today = json.getJSONObject("today")
        assertEquals("2026-10-29", today.getString("date"))
        assertEquals(6120, today.getInt("ringSteps"))
    }
}
