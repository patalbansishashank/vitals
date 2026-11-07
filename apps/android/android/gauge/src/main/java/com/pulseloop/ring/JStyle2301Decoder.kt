package com.pulseloop.ring

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * Decoder for the J-Style 2301 history packets used by the J-Style 2301 ring.
 *
 * [DECODER_VERSION] `jstyle2301/2` is the ring-evidence decoder of SPEC GA: every minute of a
 * `0x52` record is emitted (zeros included), an all-zero-minutes record with a positive total is
 * one marked [StepSupport.TEN_MINUTE_FALLBACK], and `0x53` carries its native epoch and raw codes.
 *
 * [sportTelemetryEnabled] gates the `0x18` cumulative counters ([JStyle2301Flags]).
 */
class JStyle2301Decoder(
    private val zoneId: ZoneId = ZoneId.systemDefault(),
    initialFirmwareRevision: String? = null,
    private val now: () -> Instant = Instant::now,
    private val sportTelemetryEnabled: Boolean = JStyle2301Flags.SPORT_TELEMETRY_DECODE,
) {
    internal var firmwareProfile: JStyle2301FirmwareProfile =
        JStyle2301FirmwareProfile.forRevision(initialFirmwareRevision)
        private set

    fun decode(packet: ByteArray): List<RingDecodedEvent> {
        if (packet.isEmpty()) return emptyList()
        return when (val opcode = packet[0].toInt() and 0xFF) {
            JStyle2301Protocol.INFO_BATTERY -> decodeBattery(packet)
            JStyle2301Protocol.INFO_FIRMWARE -> decodeFirmware(packet)
            JStyle2301Protocol.AUTHENTICATE -> decodeAuthentication(packet)
            JStyle2301Protocol.MEASUREMENT_WITH_TYPE -> decodeMeasurement(packet)
            JStyle2301Protocol.REALTIME_STEP -> decodeRealtimeActivity(packet)
            JStyle2301Protocol.SPORT_TELEMETRY -> decodeSportTelemetry(packet)
            JStyle2301Protocol.SPORT_MODE -> listOf(RingDecodedEvent.CommandAck(opcode.toUByte()))
            // Clock set ack and clock read-back. The read-back's value is consumed by
            // [JStyle2301Driver.ingest], which measures the ring's offset from it.
            JStyle2301Protocol.SET_TIME, JStyle2301Protocol.GET_TIME ->
                listOf(RingDecodedEvent.TimeSyncAck(now()))
            JStyle2301Protocol.INFO_CHIP, JStyle2301Protocol.INFO_NAME ->
                listOf(RingDecodedEvent.CommandAck(opcode.toUByte()))
            else -> JStyle2301HistoryStream.forOpcode(opcode)?.let { decodeHistory(packet, it) }
                ?: listOf(RingDecodedEvent.Unknown(opcode.toUByte(), packet))
        }
    }

    private fun decodeBattery(packet: ByteArray): List<RingDecodedEvent> {
        val percent = packet.getOrNull(1)?.u8() ?: return emptyList()
        return listOf(RingDecodedEvent.Battery(percent))
    }

    private fun decodeFirmware(packet: ByteArray): List<RingDecodedEvent> {
        if (packet.size < 5) return emptyList()
        val version = packet.copyOfRange(1, 5).joinToString("") { (it.u8()).toString(16).uppercase() }
        firmwareProfile = JStyle2301FirmwareProfile.forRevision("V$version")
        return listOf(RingDecodedEvent.FirmwareRevision("V$version"))
    }

    private fun decodeAuthentication(packet: ByteArray): List<RingDecodedEvent> {
        val accepted = packet.getOrNull(1)?.u8() == 1
        return listOf(RingDecodedEvent.AuthenticationResult(accepted))
    }

    private fun decodeMeasurement(packet: ByteArray): List<RingDecodedEvent> {
        val type = packet.getOrNull(1)?.u8()
        // Every 0x28 reply is health-classified even when it is a zero start/stop ack. Otherwise
        // the raw physiological payload would fall through diagnostics as an unmasked unknown.
        if (type != JStyle2301Protocol.MEASUREMENT_TYPE_HEART_RATE) {
            return listOf(RingDecodedEvent.SportTelemetry(0, now()))
        }
        return listOf(RingDecodedEvent.HeartRateSample(
            packet.getOrNull(2)?.u8() ?: 0, now(), measurementResult = true))
    }

    private fun decodeRealtimeActivity(packet: ByteArray): List<RingDecodedEvent> {
        val at = now()
        val bpm = packet.getOrNull(21)?.u8()
        return buildList {
            add(RingDecodedEvent.SportTelemetry(0, at))
            if (bpm != null && bpm in 30..220) {
                add(RingDecodedEvent.HeartRateSample(
                    bpm, at, measurementStream = true))
            }
        }
    }

    /**
     * `0x18` sport frame. Layout from the bundled SDK (docs/jstyle-2301-manual-heart-rate.md):
     * bpm byte 1, cumulative steps bytes 2-5, cumulative calories bytes 6-9, active time 10-13.
     * The little-endian order and the kcal hundredths scale are the SDK's convention for the
     * `0x51` total and are **unverified for 0x18**: no captured frame exists yet (GA.3), so the
     * counters are decoded only behind [sportTelemetryEnabled] while the raw frames are logged
     * for golden tests (`ring_sport_frames`, [JStyle2301Flags.SPORT_FRAME_CAPTURE_DAYS]).
     */
    private fun decodeSportTelemetry(packet: ByteArray): List<RingDecodedEvent> {
        if (packet.size < 14) return emptyList()
        val bpm = packet[1].u8()
        val at = now()
        return buildList {
            // Name every 0x18 packet as health telemetry even during warm-up (bpm=0), otherwise
            // its steps/calories payload would leave diagnostics through the unmasked unknown path.
            add(
                if (sportTelemetryEnabled) RingDecodedEvent.SportTelemetry(
                    bpm, at,
                    stepsCumulative = u32le(packet, 2),
                    vendorKcalCumulative = u32le(packet, 6) / 100.0,
                ) else RingDecodedEvent.SportTelemetry(bpm, at)
            )
            if (bpm in 30..220) add(RingDecodedEvent.HeartRateSample(bpm, at))
        }
    }

    private fun decodeHistory(
        packet: ByteArray,
        stream: JStyle2301HistoryStream,
    ): List<RingDecodedEvent> = when (stream) {
        JStyle2301HistoryStream.ACTIVITY_TOTAL -> decodeActivityTotal(withoutTerminal(packet, stream))
        JStyle2301HistoryStream.ACTIVITY_DETAIL -> decodeActivityDetail(withoutTerminal(packet, stream))
        JStyle2301HistoryStream.SLEEP -> decodeSleep(withoutTerminal(packet, stream))
        JStyle2301HistoryStream.WORKOUT_HEART_RATE -> decodeWorkoutHeartRate(withoutTerminal(packet, stream))
        JStyle2301HistoryStream.HEART_RATE -> decodeScalarHistory(withoutTerminal(packet, stream), stream) {
            listOf(timestamp(it)?.let { at -> history(MeasurementKind.HEART_RATE, it[9].u8().toDouble(), at) })
        }
        JStyle2301HistoryStream.HRV -> decodeHrv(withoutTerminal(packet, stream))
        JStyle2301HistoryStream.TEMPERATURE -> decodeScalarHistory(withoutTerminal(packet, stream), stream) {
            listOf(timestamp(it)?.let { at -> history(MeasurementKind.TEMPERATURE, u16le(it, 9) * 0.1, at) })
        }
        JStyle2301HistoryStream.SPO2 -> decodeScalarHistory(withoutTerminal(packet, stream), stream) {
            listOf(timestamp(it)?.let { at -> history(MeasurementKind.SPO2, it[9].u8().toDouble(), at) })
        }
    }

    private fun decodeActivityTotal(body: ByteArray): List<RingDecodedEvent> {
        val size = activityRecordSize(body)
        return fixedRecords(body, 0x51, size).flatMap { record ->
            val at = date(record, 2) ?: return@flatMap emptyList()
            val steps = u32le(record, 5).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
            val exerciseDurationRaw = u32le(record, 9)
            val distanceM = (u32le(record, 13) * 10L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
            val calories = (u32le(record, 17) / 100.0).roundToInt()
            val goal = if (size == 26) record[21].u8() else u16le(record, 21)
            val opaqueActiveTime = u32le(record, size - 4)
            buildList {
                add(RingDecodedEvent.ActivityUpdate(
                    at,
                    steps,
                    distanceM,
                    calories,
                    activeMinutes = firmwareProfile.activeMinutes(exerciseDurationRaw),
                    replaceActiveMinutes = firmwareProfile.replacesActiveMinutes,
                ))
                add(vendor(EXERCISE_DURATION_KEY, exerciseDurationRaw.toDouble(), "s", at))
                add(vendor(ACTIVE_TIME_KEY, opaqueActiveTime.toDouble(), "vendor_units", at))
                if (goal > 0) add(vendor(STEP_GOAL_KEY, goal.toDouble(), "steps", at))
            }
        }
    }

    /**
     * `0x52` 10-minute records (GA.1). Bytes 9-10 are the record's step total, 15-24 its ten
     * minute counts. Every minute is emitted with [StepSupport.MINUTE], zeros included, because a
     * native zero minute is an observation and a missing one is not. When the minutes sum to 0 but
     * the total is positive, the record is emitted once as a 600 s
     * [StepSupport.TEN_MINUTE_FALLBACK] instead; it is never split into invented minutes. Each
     * row keeps the parent total, which can differ from the sum of its minutes.
     */
    private fun decodeActivityDetail(body: ByteArray): List<RingDecodedEvent> =
        fixedRecords(body, 0x52, 25).flatMap { record ->
            val at = timestamp(record) ?: return@flatMap emptyList()
            val totalSteps = u16le(record, 9)
            val totalCalories = u16le(record, 11) / 100.0
            val totalDistanceM = u16le(record, 13) * 10
            val minuteSteps = record.copyOfRange(15, 25).map { it.u8() }
            val minuteTotal = minuteSteps.sum()
            buildList {
                // This is the exact 10-minute record value. Keep it vendor-namespaced until the
                // daily 65.6 kcal ring total vs the vendor app's 80 kcal app total is fully explained.
                if (totalCalories > 0) {
                    add(vendor("activity_detail_calories", totalCalories, "kcal", at))
                }
                if (minuteTotal <= 0 && totalSteps > 0) {
                    add(RingDecodedEvent.ActivityBucket(
                        at, totalSteps, totalDistanceM,
                        durationS = RECORD_SECONDS,
                        support = StepSupport.TEN_MINUTE_FALLBACK,
                        parentTotalSteps = totalSteps,
                        parentRecordStart = at,
                    ))
                    return@buildList
                }
                var assignedDistance = 0
                val lastPopulated = minuteSteps.indices.lastOrNull { minuteSteps[it] > 0 }
                minuteSteps.forEachIndexed { index, steps ->
                    val distance = when {
                        steps <= 0 -> 0
                        index == lastPopulated -> totalDistanceM - assignedDistance
                        else -> (totalDistanceM.toDouble() * steps / minuteTotal).roundToInt().also {
                            assignedDistance += it
                        }
                    }.coerceAtLeast(0)
                    add(RingDecodedEvent.ActivityBucket(
                        at.plusSeconds(index * 60L), steps, distance,
                        durationS = 60,
                        support = StepSupport.MINUTE,
                        parentTotalSteps = totalSteps,
                        parentRecordStart = at,
                    ))
                }
            }
        }

    /**
     * `0x53` (GA.2): a 130-byte record holds one stage byte per minute, a 34-byte record one per
     * five minutes. Stages are always expanded to minutes; [RingDecodedEvent.SleepTimeline.nativeEpochS]
     * says which it was and the raw bytes travel alongside. An unknown firmware still maps every
     * byte to UNKNOWN ([JStyle2301FirmwareProfile.sleepStage]) and never to a sleep stage.
     */
    private fun decodeSleep(body: ByteArray): List<RingDecodedEvent> {
        if (body.size == 130) {
            val at = timestamp(body) ?: return emptyList()
            val count = minOf(body[9].u8(), body.size - 10)
            val raw = body.copyOfRange(10, 10 + count)
            val stages = raw.map(::sleepStage)
            return if (stages.isEmpty()) emptyList()
            else listOf(RingDecodedEvent.SleepTimeline(
                at, stages, historyHorizonDays = HISTORY_DAYS,
                nativeEpochS = 60, rawStageCodes = raw.map { it.u8() },
            ))
        }
        return fixedRecords(body, 0x53, 34).mapNotNull { record ->
            val at = timestamp(record) ?: return@mapNotNull null
            val count = minOf(record[9].u8(), 24)
            val raw = record.copyOfRange(10, 10 + count)
            val stages = raw.flatMap { stage -> List(5) { sleepStage(stage) } }
            if (stages.isEmpty()) null
            else RingDecodedEvent.SleepTimeline(
                at, stages, historyHorizonDays = HISTORY_DAYS,
                nativeEpochS = 300, rawStageCodes = raw.map { it.u8() },
            )
        }
    }

    private fun decodeWorkoutHeartRate(body: ByteArray): List<RingDecodedEvent> =
        fixedRecords(body, 0x54, 24).flatMap { record ->
            val at = timestamp(record) ?: return@flatMap emptyList()
            record.copyOfRange(9, 24).mapIndexed { index, byte ->
                val bpm = byte.u8()
                if (bpm == 0) null
                // The 0x54 record is the ring's workout stream: 15 readings, one every 10 s, by
                // layout. That fixed cadence travels with each reading (HrProvenance); the all-day
                // 0x55/0x56 heart rate below never gets one.
                else RingDecodedEvent.HistoryMeasurement(
                    MeasurementKind.HEART_RATE, bpm.toDouble(), at.plusSeconds(index * WORKOUT_HR_CADENCE_S.toLong()),
                    HISTORY_DAYS, provenance = HrProvenance.WORKOUT_HISTORY, cadenceS = WORKOUT_HR_CADENCE_S,
                )
            }.filterNotNull()
        }

    private fun decodeHrv(body: ByteArray): List<RingDecodedEvent> =
        fixedRecords(body, 0x56, 15).flatMap { record ->
            val at = timestamp(record) ?: return@flatMap emptyList()
            val rawHrv = record[9].u8()
            val vascularAge = record[10].u8()
            val heartRate = record[11].u8()
            val stress = record[12].u8()
            val systolic = record[13].u8()
            val diastolic = record[14].u8()
            buildList {
                if (rawHrv > 0) {
                    add(vendor("hrv_raw", rawHrv.toDouble(), "vendor_units", at))
                    firmwareProfile.hrvMillis(rawHrv)?.let {
                        add(history(MeasurementKind.HRV, it, at))
                    }
                }
                if (vascularAge > 0) add(vendor("vascular_age", vascularAge.toDouble(), "years", at))
                if (heartRate > 0) add(history(MeasurementKind.HEART_RATE, heartRate.toDouble(), at))
                if (stress > 0) add(history(MeasurementKind.STRESS, stress.toDouble(), at))
                // These are opaque firmware estimates, not cuff readings. Keep them vendor-
                // namespaced so Health Connect can never mistake them for measured blood pressure.
                if (systolic in 60..250 && diastolic in 30..150) {
                    add(vendor("blood_pressure_systolic_estimate", systolic.toDouble(), "mmHg", at))
                    add(vendor("blood_pressure_diastolic_estimate", diastolic.toDouble(), "mmHg", at))
                }
            }
        }

    private fun decodeScalarHistory(
        body: ByteArray,
        stream: JStyle2301HistoryStream,
        decode: (ByteArray) -> List<RingDecodedEvent?>,
    ): List<RingDecodedEvent> = fixedRecords(body, stream.opcode, stream.recordSize!!)
        .flatMap(decode).filterNotNull()

    private fun history(kind: MeasurementKind, value: Double, at: Instant): RingDecodedEvent =
        RingDecodedEvent.HistoryMeasurement(
            kind,
            value,
            at,
            HISTORY_DAYS,
            provenance = if (kind == MeasurementKind.HRV || kind == MeasurementKind.STRESS) {
                "vendor_history"
            } else {
                "device_history"
            },
        )

    private fun vendor(key: String, value: Double, unit: String, at: Instant) =
        RingDecodedEvent.VendorMetric(key, value, unit, at, isHistory = true)

    private fun sleepStage(byte: Byte): SleepStage = firmwareProfile.sleepStage(byte.u8())

    private fun withoutTerminal(packet: ByteArray, stream: JStyle2301HistoryStream): ByteArray {
        if (packet.size >= 2 && packet[packet.lastIndex - 1].u8() == stream.opcode &&
            packet.last().u8() == 0xFF
        ) return packet.copyOf(packet.size - 2)
        val size = stream.recordSize
        if (size != null && packet.lastOrNull()?.u8() == 0xFF && packet.size % size == 1) {
            return packet.copyOf(packet.size - 1)
        }
        return packet
    }

    private fun fixedRecords(body: ByteArray, opcode: Int, size: Int): List<ByteArray> = buildList {
        var offset = 0
        while (offset + size <= body.size) {
            val record = body.copyOfRange(offset, offset + size)
            if (record[0].u8() == opcode) add(record)
            offset += size
        }
    }

    private fun activityRecordSize(body: ByteArray): Int = when {
        body.size == 2 -> 27
        body.size % 26 == 0 -> 26
        body.size % 27 == 0 -> 27
        body.size >= 2 && (body.size - 2) % 26 == 0 -> 26
        else -> 27
    }

    private fun timestamp(record: ByteArray, offset: Int = 3): Instant? {
        if (record.size < offset + 6) return null
        val fields = (offset until offset + 6).map { bcd(record[it]) ?: return null }
        return try {
            LocalDateTime.of(
                LocalDate.of(2000 + fields[0], fields[1], fields[2]),
                LocalTime.of(fields[3], fields[4], fields[5]),
            ).atZone(zoneId).toInstant()
        } catch (_: DateTimeException) {
            null
        }
    }

    private fun date(record: ByteArray, offset: Int): Instant? {
        if (record.size < offset + 3) return null
        val year = bcd(record[offset]) ?: return null
        val month = bcd(record[offset + 1]) ?: return null
        val day = bcd(record[offset + 2]) ?: return null
        return try {
            LocalDate.of(2000 + year, month, day).atStartOfDay(zoneId).toInstant()
        } catch (_: DateTimeException) {
            null
        }
    }

    private fun bcd(byte: Byte): Int? {
        val value = byte.u8()
        val high = value ushr 4
        val low = value and 0x0F
        return if (high <= 9 && low <= 9) high * 10 + low else null
    }

    private fun u16le(data: ByteArray, offset: Int): Int {
        if (offset + 2 > data.size) return 0
        return data[offset].u8() or (data[offset + 1].u8() shl 8)
    }

    private fun u32le(data: ByteArray, offset: Int): Long {
        if (offset + 4 > data.size) return 0
        return (data[offset].u8().toLong()) or
            (data[offset + 1].u8().toLong() shl 8) or
            (data[offset + 2].u8().toLong() shl 16) or
            (data[offset + 3].u8().toLong() shl 24)
    }

    private fun Byte.u8(): Int = toInt() and 0xFF

    companion object {
        /** The ring-evidence decoder (SPEC GA); uploaded as `decoder_version` on J-Style events. */
        const val DECODER_VERSION = "jstyle2301/2"
        /** One `0x52` activity-detail record. */
        const val RECORD_SECONDS = 600
        /** The packets are self-dated and the tested ring returned a much deeper archive. */
        const val HISTORY_DAYS = 3_650L
        /** Seconds between the readings of one 0x54 workout heart-rate record (by layout). */
        const val WORKOUT_HR_CADENCE_S = 10
        const val EXERCISE_DURATION_KEY = "exercise_duration_raw"
        const val ACTIVE_TIME_KEY = "active_time_raw"
        const val STEP_GOAL_KEY = "step_goal"
        /** Vendor values from the 0x51 day-total record: stamped with a date (local midnight), not
         *  by the ring clock, so clock correction must never move them. */
        val DAY_TOTAL_KEYS = setOf(EXERCISE_DURATION_KEY, ACTIVE_TIME_KEY, STEP_GOAL_KEY)
    }
}
