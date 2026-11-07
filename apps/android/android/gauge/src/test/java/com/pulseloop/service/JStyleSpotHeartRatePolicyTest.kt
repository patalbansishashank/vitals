package com.pulseloop.service

import com.pulseloop.ring.JStyle2301Decoder
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.RingEventBridge
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class JStyleSpotHeartRatePolicyTest {
    @Test fun `manual HR UI progresses acquiring live countdown complete cancel and error`() {
        val acquiring = RingSyncCoordinator.activeManualHrUiState(null, 32)
        assertTrue(acquiring.active)
        assertEquals(RingSyncCoordinator.ManualHrPhase.ACQUIRING, acquiring.phase)
        assertNull(acquiring.bpm)
        val live90 = RingSyncCoordinator.activeManualHrUiState(90, 16)
        val live93 = RingSyncCoordinator.activeManualHrUiState(93, 7)
        assertEquals(RingSyncCoordinator.ManualHrPhase.LIVE, live90.phase)
        assertEquals(90, live90.bpm)
        assertEquals(16, live90.remainingSeconds)
        assertEquals(93, live93.bpm)
        assertEquals(7, live93.remainingSeconds)
        val complete = RingSyncCoordinator.finishedManualHrUiState(92, cancelled = false)
        assertEquals(RingSyncCoordinator.ManualHrPhase.COMPLETE, complete.phase)
        assertEquals(92, complete.bpm)
        assertFalse(complete.active)
        assertEquals(RingSyncCoordinator.ManualHrPhase.CANCELLED,
            RingSyncCoordinator.finishedManualHrUiState(null, cancelled = true).phase)
        assertEquals(RingSyncCoordinator.ManualHrPhase.ERROR,
            RingSyncCoordinator.finishedManualHrUiState(null, cancelled = false).phase)
    }

    @Test fun `captured zero to stable 0x09 sequence settles at 92`() {
        var elapsed = 0L
        val window = HRSampleWindow { elapsed }
        val decoder = JStyle2301Decoder(
            ZoneId.of("UTC"), initialFirmwareRevision = "V0789",
            now = { Instant.ofEpochMilli(elapsed) },
        )
        val stable = listOf(90, 89, 90, 91, 92, 92, 93, 93, 93, 93, 93, 93, 92, 92, 92, 92)
        window.begin(0)
        for (second in 0..30) {
            elapsed = second * 1_000L
            val bpm = when {
                second == 2 -> 77 // cached/early value: inside warm-up, must not survive
                second >= 15 -> stable[second - 15]
                else -> 0
            }
            val packet = ByteArray(22).also { it[0] = 0x09; it[21] = bpm.toByte() }
            decoder.decode(packet).flatMap { RingEventBridge.eventsFor(it, Instant.ofEpochMilli(elapsed)) }
                .filterIsInstance<PulseEvent.HeartRateSample>()
                .filter { it.measurementStream }
                .forEach { window.collect(it.bpm, elapsed) }
        }
        assertEquals(92, window.stableValue)
        assertEquals(92, RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = false, acceptsSingleResult = true,
            singleResult = null, windowResult = window.stableValue))
    }

    @Test fun `single late vendor result is accepted without streamed sample quorum`() {
        assertEquals(72, RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = false, acceptsSingleResult = true, singleResult = 72, windowResult = null))
    }

    @Test fun `zero direct ack falls back to verified stream tail`() {
        assertEquals(92, RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = false, acceptsSingleResult = true, singleResult = 0, windowResult = 92))
    }

    @Test fun `timeout and cancellation produce no reading`() {
        assertNull(RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = false, acceptsSingleResult = true, singleResult = null, windowResult = null))
        assertNull(RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = true, acceptsSingleResult = true, singleResult = 72, windowResult = 80))
    }

    @Test fun `vendor spot accepts only explicit 0x28 or 0x09 provenance`() {
        assertTrue(RingSyncCoordinator.isVendorSpotHeartRateInput(true, true, true, false))
        assertTrue(RingSyncCoordinator.isVendorSpotHeartRateInput(true, true, false, true))
        assertFalse(RingSyncCoordinator.isVendorSpotHeartRateInput(true, true, false, false)) // 0x18 sport
        assertFalse(RingSyncCoordinator.isVendorSpotHeartRateInput(false, true, false, true)) // late 0x09
        assertTrue(RingSyncCoordinator.isVendorSpotHeartRateInput(true, false, false, false))
    }

    @Test fun `streamed families retain existing settled window result`() {
        assertEquals(81, RingSyncCoordinator.selectSpotHeartRateResult(
            aborted = false, acceptsSingleResult = false, singleResult = 72, windowResult = 81))
    }
}
