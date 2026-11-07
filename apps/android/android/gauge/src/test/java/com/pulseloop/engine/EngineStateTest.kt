package com.pulseloop.engine

import com.pulseloop.ring.RingConnectionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// org.json is real under Robolectric (the plain JVM stub returns nothing)
@RunWith(RobolectricTestRunner::class)
class EngineStateTest {
    private val perms = EngineState.Permissions(Perm.GRANTED, Perm.PARTIAL, Perm.DENIED, Perm.GRANTED, shortVideoAccessibility = false, batteryUnrestricted = true)

    @Test fun `a passive state has the contract's shape, without fields it has no value for`() {
        val json = EngineState(
            mode = EngineMode.PASSIVE, gaugeInstalled = true, gaugePendingUploads = 12,
            ring = EngineState.Ring(), permissions = perms, upload = EngineState.Upload(),
            shortVideo = EngineState.ShortVideo(enabled = true, dailyLimit = 30),
        ).toJson()
        assertEquals("passive", json.getString("mode"))
        assertEquals(true, json.getJSONObject("gauge").getBoolean("installed"))
        assertEquals(12, json.getJSONObject("gauge").getInt("pendingUploads"))
        val ring = json.getJSONObject("ring")
        assertEquals("none", ring.getString("state"))
        assertFalse(ring.has("name")); assertFalse(ring.has("address")); assertFalse(ring.has("battery")); assertFalse(ring.has("lastSyncAt"))
        val p = json.getJSONObject("permissions")
        assertEquals("granted", p.getString("bluetooth"))
        assertEquals("partial", p.getString("healthConnect"))
        assertEquals("denied", p.getString("activityRecognition"))
        assertEquals("granted", p.getString("notifications"))
        assertFalse(p.getBoolean("shortVideoAccessibility"))
        assertTrue(p.getBoolean("batteryUnrestricted"))
        val upload = json.getJSONObject("upload")
        assertFalse(upload.getBoolean("paired")); assertEquals(0, upload.getInt("pending")); assertFalse(upload.has("lastSentAt"))
        val sv = json.getJSONObject("shortVideo")
        assertEquals(30, sv.getInt("dailyLimit"))
        assertEquals(0, sv.getJSONObject("today").getInt("instagram"))
    }

    @Test fun `the restricted-settings hint is in the permissions only when the phone has one`() {
        fun permissions(restricted: Boolean?) = EngineState(
            mode = EngineMode.ACTIVE, gaugeInstalled = false, gaugePendingUploads = null,
            ring = EngineState.Ring(), permissions = perms.copy(shortVideoRestricted = restricted), upload = EngineState.Upload(),
            shortVideo = EngineState.ShortVideo(enabled = true, dailyLimit = 30),
        ).toJson().getJSONObject("permissions")
        assertTrue(permissions(true).getBoolean("shortVideoRestricted"))
        assertFalse(permissions(false).getBoolean("shortVideoRestricted"))
        // unknown is left out, never null (the contract's rule); the base state has none
        assertFalse(permissions(null).has("shortVideoRestricted"))
        assertNull(perms.shortVideoRestricted)
    }

    @Test fun `an unknown Gauge queue is null and a switched-off limit is null`() {
        val json = EngineState(
            mode = EngineMode.NEEDS_TAKEOVER, gaugeInstalled = false, gaugePendingUploads = null,
            ring = EngineState.Ring(EngineState.RingState.CONNECTED, "J-Style", "AA:BB:CC:DD:EE:FF", 81, "2026-10-30T10:00:00Z", null),
            permissions = perms, upload = EngineState.Upload(true, 3, "2026-10-30T10:01:00Z", null),
            shortVideo = EngineState.ShortVideo(enabled = false, dailyLimit = EngineState.limitOf(false, 30), instagram = 4, youtube = 2),
        ).toJson()
        assertTrue(json.getJSONObject("gauge").isNull("pendingUploads"))
        assertTrue(json.getJSONObject("shortVideo").isNull("dailyLimit"))
        assertEquals(4, json.getJSONObject("shortVideo").getJSONObject("today").getInt("instagram"))
        val ring = json.getJSONObject("ring")
        assertEquals("connected", ring.getString("state")); assertEquals("AA:BB:CC:DD:EE:FF", ring.getString("address")); assertEquals(81, ring.getInt("battery"))
        assertEquals("needsTakeover", json.getString("mode"))
    }

    @Test fun `ring state exposes only whether a local credential is configured`() {
        val json = EngineState(
            mode = EngineMode.ACTIVE, gaugeInstalled = false, gaugePendingUploads = null,
            ring = EngineState.Ring(credentialConfigured = true, credentialRequired = true), permissions = perms,
            upload = EngineState.Upload(), shortVideo = EngineState.ShortVideo(),
        ).toJson().getJSONObject("ring")
        assertTrue(json.getBoolean("credentialConfigured"))
        assertTrue(json.getBoolean("credentialRequired"))
        assertFalse(json.getBoolean("credentialRejected"))
        assertFalse(json.getBoolean("credentialAuthenticated"))
        assertEquals(setOf("state", "credentialConfigured", "credentialRequired", "credentialRejected", "credentialAuthenticated"), json.keys().asSequence().toSet())
    }

    @Test fun `permissions fold to granted, denied, partial or unavailable`() {
        assertEquals(Perm.GRANTED, EngineState.perm(listOf(true, true)))
        assertEquals(Perm.DENIED, EngineState.perm(listOf(false, false)))
        assertEquals(Perm.PARTIAL, EngineState.perm(listOf(true, false)))
        assertEquals(Perm.UNAVAILABLE, EngineState.perm(emptyList()))
    }

    @Test fun `every connection state of the ring maps to one of the five`() {
        val s = EngineState.RingState.entries.map { it.wire }
        assertEquals(listOf("none", "scanning", "connecting", "connected", "disconnected"), s)
        assertEquals(EngineState.RingState.NONE, EngineState.ringState(RingConnectionState.IDLE, known = false))
        assertEquals(EngineState.RingState.DISCONNECTED, EngineState.ringState(RingConnectionState.IDLE, known = true))
        assertEquals(EngineState.RingState.CONNECTING, EngineState.ringState(RingConnectionState.RECONNECTING, known = true))
        assertEquals(EngineState.RingState.DISCONNECTED, EngineState.ringState(RingConnectionState.FAILED, known = true))
        assertEquals(EngineState.RingState.SCANNING, EngineState.ringState(RingConnectionState.SCANNING, known = false))
        assertEquals(EngineState.RingState.CONNECTED, EngineState.ringState(RingConnectionState.CONNECTED, known = true))
    }

    @Test fun `the limit shows only while the counter limits`() {
        assertEquals(30, EngineState.limitOf(true, 30))
        assertNull(EngineState.limitOf(false, 30))
    }
}
