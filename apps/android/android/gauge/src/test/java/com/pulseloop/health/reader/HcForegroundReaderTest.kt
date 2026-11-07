package com.pulseloop.health.reader

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The foreground Health Connect read when background read is unavailable (0.6.3 audit S19). */
class HcForegroundReaderTest {

    private val steps = HcType.STEPS.readPermission
    private val background = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    private fun cap(granted: Set<String>, backgroundFeature: Boolean = true) =
        HcCapability.from(true, granted, backgroundFeature = backgroundFeature, historyFeature = true)

    @Test fun `read path and the stated background limitation`() {
        assertEquals(HcReadPath.NONE, HcCapability.UNAVAILABLE.readPath)
        assertEquals(HcReadPath.NONE, cap(setOf(background)).readPath)
        assertEquals(HcReadPath.BACKGROUND, cap(setOf(steps, background)).readPath)
        assertNull(cap(setOf(steps, background)).backgroundLimitation)

        val notGranted = cap(setOf(steps))
        assertEquals(HcReadPath.FOREGROUND_ONLY, notGranted.readPath)
        assertEquals(HcBackgroundLimitation.NOT_GRANTED, notGranted.backgroundLimitation)
        assertTrue(notGranted.canReadInForeground)
        assertFalse(notGranted.canReadInBackground)

        // A Health Connect too old for the feature can't grant it, whatever the grant set says.
        val unsupported = cap(setOf(steps, background), backgroundFeature = false)
        assertEquals(HcReadPath.FOREGROUND_ONLY, unsupported.readPath)
        assertEquals(HcBackgroundLimitation.UNSUPPORTED, unsupported.backgroundLimitation)
    }

    @Test fun `runs only foreground-only, paired, and throttled unless the grants changed`() {
        val fg = cap(setOf(steps))
        val t0 = 1_000_000_000L
        assertTrue(HcForegroundReader.shouldRun(true, fg, null, t0))
        assertFalse("unpaired: nowhere to upload", HcForegroundReader.shouldRun(false, fg, null, t0))
        assertFalse("the worker covers it", HcForegroundReader.shouldRun(true, cap(setOf(steps, background)), null, t0))
        assertFalse("nothing readable", HcForegroundReader.shouldRun(true, cap(emptySet()), null, t0))

        val last = HcForegroundReader.LastRun(t0, setOf(HcType.STEPS))
        assertFalse("resume right after a pass", HcForegroundReader.shouldRun(true, fg, last, t0 + 60_000))
        assertTrue(HcForegroundReader.shouldRun(true, fg, last, t0 + HcForegroundReader.MIN_INTERVAL_MS))
        val more = cap(setOf(steps, HcType.WEIGHT.readPermission))
        assertTrue("a new grant reads at once", HcForegroundReader.shouldRun(true, more, last, t0 + 1_000))
        assertTrue("a clock set back never blocks reads", HcForegroundReader.shouldRun(true, fg, last, t0 - 1_000))
    }

    @Test fun `the reader reads with ordinary grants only when the caller is in the foreground`() = runBlocking {
        val now = Instant.parse("2026-10-27T12:00:00Z")
        val hc = HealthConnectReaderTest.FakeHc()
        hc.records += HcRecordView(
            type = HcType.STEPS, id = "a", originPackage = "com.google.android.apps.fitness",
            device = HcRecordView.DeviceInfo(Device.TYPE_PHONE, "Google", "Pixel 8"),
            recordingMethod = Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, clientRecordId = null,
            lastModified = now.minusSeconds(60), start = now.minusSeconds(600), end = now.minusSeconds(60),
            startOffsetMin = 330, endOffsetMin = 330, payload = buildJsonObject { put("count", 50) },
        )
        val store = HealthConnectReaderTest.FakeStore()
        val reader = HealthConnectReader(hc, store, setOf("android"), { now })
        val foregroundOnly = cap(setOf(steps))
        assertTrue(reader.run(foregroundOnly).outcomes.isEmpty())
        assertTrue(store.rows.isEmpty())
        val result = reader.run(foregroundOnly, foreground = true)
        assertEquals(HealthConnectReader.TypeOutcome.CURRENT, result.outcomes[HcType.STEPS])
        assertEquals(setOf("Steps:a"), store.rows.keys)
        // Same cursor afterwards: a background grant later carries on from it.
        assertTrue(HcChangesCursor.decode(HcType.STEPS, store.state).backfillDone)
    }
}
