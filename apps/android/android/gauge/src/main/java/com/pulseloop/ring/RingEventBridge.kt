package com.pulseloop.ring

import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Ported from [RingEventBridge] in RingEventBridge.swift.
 * Pure mapping from decoded ring packets to typed [PulseEvent]s with sanity gates.
 */
object RingEventBridge {
    private val hrRange = 30..220
    val spo2Range = 70..100
    private val stressRange = 1..100
    private val hrvRange = 1..300
    private val temperatureRange = 30.0..45.0
    private val systolicRange = 60..250
    private val diastolicRange = 30..150
    private val bloodSugarRange = 20.0..600.0
    private const val maxBucketSteps = 5000
    private const val maxBucketDistance = 6000

    fun eventsFor(decoded: RingDecodedEvent, now: Instant = Instant.now()): List<PulseEvent> = when (decoded) {
        is RingDecodedEvent.ActivityUpdate ->
            listOf(PulseEvent.ActivityUpdate(
                decoded._timestamp,
                decoded.steps,
                decoded.distanceMeters.toDouble(),
                decoded.calories.toDouble(),
                decoded.activeMinutes,
                decoded.replaceActiveMinutes,
            ))

        is RingDecodedEvent.ActivityBucket -> {
            if (decoded.steps !in 0..maxBucketSteps || decoded.distanceMeters !in 0..maxBucketDistance) emptyList()
            else listOf(PulseEvent.ActivityBucket(
                decoded._timestamp, decoded.steps, decoded.distanceMeters.toDouble(),
                rawTimestamp = decoded.rawTimestamp?.takeIf { it != decoded._timestamp },
                durationS = decoded.durationS,
                support = decoded.support,
                parentTotalSteps = decoded.parentTotalSteps,
                parentRecordStart = decoded.parentRecordStart,
            ))
        }

        is RingDecodedEvent.HeartRateSample -> {
            if (decoded.bpm !in hrRange) emptyList()
            else listOf(PulseEvent.HeartRateSample(
                decoded.bpm, clamp(decoded._timestamp, now),
                measurementResult = decoded.measurementResult,
                measurementStream = decoded.measurementStream,
            ))
        }

        is RingDecodedEvent.HeartRateComplete ->
            listOf(PulseEvent.HeartRateComplete(decoded._timestamp))

        is RingDecodedEvent.Spo2Result ->
            listOf(PulseEvent.Spo2Result(decoded.value, decoded._timestamp))

        is RingDecodedEvent.HistoryMeasurement -> {
            if (!isPlausibleHistoryMeasurement(decoded.kind_field, decoded.value)) emptyList()
            // A ring's on-device log can still hold records stamped under a previous clock — e.g.
            // a jring that logged against a UTC RTC before the app started setting it to local
            // time. Those decode hours into the future. Drop anything outside the history horizon
            // rather than persisting a sample that poisons "today", peak HR and the 24h trends.
            else if (!isWithinHistoryWindow(decoded._timestamp, now, decoded.historyHorizonDays)) emptyList()
            else listOf(PulseEvent.HistoryMeasurement(
                decoded.kind_field,
                decoded.value,
                decoded._timestamp,
                decoded.provenance,
                rawTimestamp = decoded.rawTimestamp?.takeIf { it != decoded._timestamp },
                cadenceS = HrProvenance.workoutCadence(decoded.provenance, decoded.cadenceS),
            ))
        }

        is RingDecodedEvent.StressSample -> {
            if (decoded.value !in stressRange) emptyList()
            else listOf(PulseEvent.StressSample(decoded.value, keyed(decoded._timestamp, now, decoded.isHistory), decoded.isHistory))
        }

        is RingDecodedEvent.HrvSample -> {
            if (decoded.value !in hrvRange) emptyList()
            else listOf(PulseEvent.HrvSample(decoded.value, clamp(decoded._timestamp, now)))
        }

        is RingDecodedEvent.TemperatureSample -> {
            if (decoded.celsius !in temperatureRange) emptyList()
            else listOf(PulseEvent.TemperatureSample(decoded.celsius, keyed(decoded._timestamp, now, decoded.isHistory), decoded.isHistory))
        }

        is RingDecodedEvent.VendorMetric -> {
            if (!decoded.value.isFinite() || decoded.key.isBlank()) emptyList()
            else listOf(
                PulseEvent.VendorMetric(
                    key = decoded.key,
                    value = decoded.value,
                    unit = decoded.unit,
                    timestamp = if (decoded.isHistory) decoded._timestamp else clamp(decoded._timestamp, now),
                    isHistory = decoded.isHistory,
                    rawTimestamp = decoded.rawTimestamp?.takeIf { it != decoded._timestamp },
                )
            )
        }

        is RingDecodedEvent.HistorySyncProgress ->
            listOf(PulseEvent.SyncProgress(decoded.stage))

        is RingDecodedEvent.HistorySyncFinished ->
            listOf(PulseEvent.SyncProgress("done"))

        is RingDecodedEvent.SleepTimeline -> {
            if (!isWithinHistoryWindow(decoded._timestamp, now, decoded.historyHorizonDays) || decoded.stages.isEmpty()) emptyList()
            else listOf(PulseEvent.SleepTimeline(
                decoded._timestamp, decoded.stages, decoded.completeSession,
                rawTimestamp = decoded.rawTimestamp?.takeIf { it != decoded._timestamp },
                nativeEpochS = decoded.nativeEpochS,
                rawStageCodes = decoded.rawStageCodes,
            ))
        }

        is RingDecodedEvent.Battery -> {
            if (decoded.percent !in 0..100) emptyList()
            else listOf(PulseEvent.BatteryLevel(decoded.percent))
        }

        is RingDecodedEvent.Status ->
            listOf(PulseEvent.DeviceStateChanged(RingConnectionState.CONNECTED, decoded.address, decoded.firmware))

        // Sport telemetry is a diagnostics marker; its bpm arrives as its own HeartRateSample.
        // Its cumulative counters exist only when the J-Style 0x18 decoder flag is on (GA.3).
        is RingDecodedEvent.SportTelemetry -> decoded.stepsCumulative?.let { steps ->
            listOf(PulseEvent.SportTelemetrySample(
                clamp(decoded._timestamp, now), steps, decoded.vendorKcalCumulative,
                decoded.bpm.takeIf { it in hrRange },
            ))
        }.orEmpty()

        is RingDecodedEvent.HistoryCoverage ->
            listOf(PulseEvent.HistoryCoverage(decoded.stream, decoded.from, decoded.to, decoded.complete, decoded.reason))

        is RingDecodedEvent.TimeSyncAck, is RingDecodedEvent.CommandAck,
        is RingDecodedEvent.AuthenticationResult, is RingDecodedEvent.Unknown ->
            emptyList()

        is RingDecodedEvent.FirmwareVersion ->
            listOf(PulseEvent.FirmwareVersion(decoded.version))

        is RingDecodedEvent.FirmwareRevision -> {
            if (decoded.version.isBlank()) emptyList()
            else listOf(PulseEvent.FirmwareRevision(decoded.version))
        }

        is RingDecodedEvent.Spo2Complete ->
            listOf(PulseEvent.Spo2Complete(decoded._timestamp))

        is RingDecodedEvent.MeasurementComplete ->
            listOf(PulseEvent.MeasurementComplete(decoded.mode, decoded.success, decoded._timestamp))

        is RingDecodedEvent.Spo2Progress ->
            emptyList() // Phase 1 does not fan these out

        is RingDecodedEvent.BindNotify ->
            emptyList() // Bind/unbind handshake is driven in the sync engine / BLE client

        is RingDecodedEvent.BandFunction ->
            emptyList() // Consumed by JringSyncEngine directly; produces no PulseEvent

        is RingDecodedEvent.SupportFunctions ->
            emptyList() // Consumed by RingBLEClient to refine active capabilities; produces no PulseEvent

        is RingDecodedEvent.ChipScheme ->
            emptyList() // Diagnostic only

        is RingDecodedEvent.WearingStatus ->
            listOf(PulseEvent.WearState(decoded.worn))

        is RingDecodedEvent.TimingHistoryFrame ->
            emptyList() // Drives CRPSyncEngine's next-frame follow-up; its samples arrive as
                        // separate HistoryMeasurement events. Produces no PulseEvent itself.

        is RingDecodedEvent.MeasurementRejected ->
            listOf(PulseEvent.MeasurementRejected(decoded.mode))

        is RingDecodedEvent.BloodPressureSample -> {
            if (decoded.systolic in systolicRange && decoded.diastolic in diastolicRange) {
                listOf(
                    PulseEvent.BloodPressureSample(
                        decoded.systolic,
                        decoded.diastolic,
                        keyed(decoded._timestamp, now, decoded.isHistory),
                        decoded.isHistory,
                    )
                )
            } else emptyList()
        }

        is RingDecodedEvent.BloodSugarSample -> {
            if (decoded.mgdl in bloodSugarRange) listOf(PulseEvent.BloodSugarSample(decoded.mgdl, decoded._timestamp))
            else emptyList()
        }

        // Half a frame carries nothing to act on; it exists only so the raw-packet log can mask it.
        is RingDecodedEvent.FramePending -> emptyList()
    }

    /**
     * A live reading can't postdate its receipt. Ring-stamped history is never clamped: it is keyed
     * by its own stamp, and pinning it to this sync's receipt instant (2.7.3) gave it a key no later
     * sync reproduces, so the next sync stored it again. A ring clock that is really off is
     * corrected by [RingClockCorrector] before this point; what is left is under a minute.
     */
    private fun clamp(at: Instant, now: Instant): Instant = RingClockOffset.notAfter(at, now)

    /** History keeps its stamp (it is the row's key); a live reading is clamped. */
    private fun keyed(at: Instant, now: Instant, isHistory: Boolean): Instant = if (isHistory) at else clamp(at, now)

    private fun isPlausibleHistoryMeasurement(kind: MeasurementKind, value: Double): Boolean {
        if (!value.isFinite()) return false
        return when (kind) {
            MeasurementKind.HEART_RATE -> value.toInt() in hrRange
            MeasurementKind.SPO2 -> value.toInt() in spo2Range
            MeasurementKind.STRESS, MeasurementKind.FATIGUE -> value.toInt() in stressRange
            MeasurementKind.HRV -> value.toInt() in hrvRange
            MeasurementKind.TEMPERATURE -> value in temperatureRange
            MeasurementKind.BLOOD_PRESSURE_SYSTOLIC -> value.toInt() in systolicRange
            MeasurementKind.BLOOD_PRESSURE_DIASTOLIC -> value.toInt() in diastolicRange
            MeasurementKind.BLOOD_SUGAR -> value in bloodSugarRange
            MeasurementKind.RESPIRATORY_RATE -> value.toInt() in 5..60
            MeasurementKind.VO2MAX -> value.toInt() in 1..100
        }
    }

    /** Shared plausibility window: within the last ~8 days (the history horizon) and no more
     *  than an hour into the future. A timestamp outside it indicates a misdecoded frame. */
    private fun isWithinHistoryWindow(date: Instant, now: Instant, horizonDays: Long = 8): Boolean {
        val lower = now.minus(horizonDays.coerceIn(1, 3_650), ChronoUnit.DAYS)
        val upper = now.plus(1, ChronoUnit.HOURS)
        return !date.isBefore(lower) && !date.isAfter(upper)
    }
}
