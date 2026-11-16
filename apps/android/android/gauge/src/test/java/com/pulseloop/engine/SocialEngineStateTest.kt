package com.pulseloop.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** (SPEC social-time) The optional `social` field of the engine state: its wire shape, and that it is left out when absent. */
@RunWith(RobolectricTestRunner::class)
class SocialEngineStateTest {
    private val perms = EngineState.Permissions(Perm.GRANTED, Perm.GRANTED, Perm.GRANTED, Perm.GRANTED, shortVideoAccessibility = false, batteryUnrestricted = true)

    private fun state(social: EngineState.Social?) = EngineState(
        mode = EngineMode.ACTIVE, gaugeInstalled = false, gaugePendingUploads = null,
        ring = EngineState.Ring(), permissions = perms, upload = EngineState.Upload(),
        shortVideo = EngineState.ShortVideo(), social = social,
    ).toJson()

    @Test fun `an older native build sends no social field`() {
        assertFalse(state(null).has("social"))
    }

    @Test fun `the social field carries the grant, today, the band and the apps`() {
        val json = state(
            EngineState.Social(
                usageAccess = true,
                today = EngineState.Social.Day("2026-11-16", 1980, mapOf("instagram" to 1200, "youtube" to 600, "reddit" to 180)),
                targetMinMinutes = 30,
                targetMaxMinutes = 45,
                enabledApps = listOf("instagram", "youtube", "facebook", "snapchat", "twitter", "reddit", "tiktok"),
            ),
        ).getJSONObject("social")
        assertTrue(json.getBoolean("usageAccess"))
        assertEquals(30, json.getInt("targetMinMinutes"))
        assertEquals(45, json.getInt("targetMaxMinutes"))
        assertEquals(7, json.getJSONArray("enabledApps").length())
        val today = json.getJSONObject("today")
        assertEquals("2026-11-16", today.getString("date"))
        assertEquals(1980, today.getInt("totalSeconds"))
        assertEquals(1200, today.getJSONObject("perApp").getInt("instagram"))
        assertEquals(180, today.getJSONObject("perApp").getInt("reddit"))
    }

    @Test fun `an empty day shows zero and no per-app entries`() {
        val today = state(
            EngineState.Social(false, EngineState.Social.Day("2026-11-16", 0, emptyMap()), 30, 45, emptyList()),
        ).getJSONObject("social").getJSONObject("today")
        assertEquals(0, today.getInt("totalSeconds"))
        assertEquals(0, today.getJSONObject("perApp").length())
    }
}
