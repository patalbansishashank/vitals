package com.pulseloop.ring

object JStyle2301UUIDs {
    const val SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"
    const val WRITE = "0000fff6-0000-1000-8000-00805f9b34fb"
    const val NOTIFY = "0000fff7-0000-1000-8000-00805f9b34fb"
}

enum class JStyle2301HistoryStream(val label: String, val opcode: Int, val recordSize: Int?) {
    ACTIVITY_TOTAL("activity", 0x51, null),
    ACTIVITY_DETAIL("activity detail", 0x52, 25),
    SLEEP("sleep", 0x53, 34),
    WORKOUT_HEART_RATE("workout heart rate", 0x54, 24),
    HEART_RATE("heart rate", 0x55, 10),
    HRV("HRV and stress", 0x56, 15),
    TEMPERATURE("temperature", 0x62, 11),
    SPO2("blood oxygen", 0x66, 10);

    /** The stream's name in `state/sync` coverage events. */
    val key: String get() = name.lowercase()

    companion object {
        fun forOpcode(opcode: Int): JStyle2301HistoryStream? = entries.firstOrNull { it.opcode == opcode }
    }
}

/**
 * Feature switches for unverified J-Style decoding (SPEC GA). Compile-time on purpose: flipping
 * one is a reviewed change once a capture exists, not a user setting.
 */
object JStyle2301Flags {
    /**
     * GA.3: decode `0x18` cumulative steps and vendor kcal into `activity/sport_telemetry`. Off
     * until golden bytes come from a captured frame; no capture existed on 2026-10-27.
     */
    const val SPORT_TELEMETRY_DECODE = false

    /** GA.3: days the raw inbound `0x18` frames are kept in `ring_sport_frames` for those goldens. */
    const val SPORT_FRAME_CAPTURE_DAYS = 7

    /**
     * GA.4: the J-Style auto-HR interval command is **not** implemented. Its opcode is confirmed
     * neither by the vendor SDK (no decompile in this tree) nor by a capture, so all-day HR stays
     * as sparse as the ring's own default and nothing downstream may assume a cadence.
     */
    const val AUTO_HR_INTERVAL_IMPLEMENTED = false
}

/** Commands verified against the ring vendor's Android app's bundled J-Style 2301 SDK. */
object JStyle2301Protocol {
    const val INFO_BATTERY = 0x13
    const val INFO_CHIP = 0x21
    const val INFO_FIRMWARE = 0x27
    const val INFO_NAME = 0x3E
    const val AUTHENTICATE = 0x3C
    const val REALTIME_STEP = 0x09
    const val MEASUREMENT_WITH_TYPE = 0x28
    const val MEASUREMENT_TYPE_HEART_RATE = 0x02
    const val SPORT_TELEMETRY = 0x18
    const val SPORT_MODE = 0x19
    const val SPORT_RUN = 0
    /** Vendor `DeviceConst.CMD_SET_TIME` / `CMD_GET_TIME`. */
    const val SET_TIME = 0x01
    const val GET_TIME = 0x41
    const val SPORT_WALK = 9

    fun infoRequest(opcode: Int): ByteArray = command(opcode)

    /**
     * Vendor `BleSDK.SetDeviceTime`: BCD `yy MM dd HH mm ss` of the phone's **local** wall clock,
     * the same encoding the ring later stamps onto every history record (decoded in
     * [JStyle2301Decoder] against the same zone).
     */
    fun setTime(local: java.time.LocalDateTime): ByteArray = packet(
        SET_TIME,
        bcd(local.year % 100), bcd(local.monthValue), bcd(local.dayOfMonth),
        bcd(local.hour), bcd(local.minute), bcd(local.second),
    )

    /** Vendor `BleSDK.GetDeviceTime`: the reply echoes `0x41` then BCD `yy MM dd HH mm ss`. */
    fun getTime(): ByteArray = command(GET_TIME)

    /** The ring's clock from a `0x41` reply, read as local wall clock in [zone]; null if malformed. */
    fun deviceTime(packet: ByteArray, zone: java.time.ZoneId): java.time.Instant? {
        if (packet.size < 7 || (packet[0].toInt() and 0xFF) != GET_TIME) return null
        val f = (1..6).map { unbcd(packet[it]) ?: return null }
        return try {
            java.time.LocalDateTime.of(2000 + f[0], f[1], f[2], f[3], f[4], f[5])
                .atZone(zone).toInstant()
        } catch (_: java.time.DateTimeException) {
            null
        }
    }

    private fun bcd(value: Int): Int = ((value / 10) shl 4) or (value % 10)

    private fun unbcd(byte: Byte): Int? {
        val v = byte.toInt() and 0xFF
        val hi = v ushr 4
        val lo = v and 0x0F
        return if (hi <= 9 && lo <= 9) hi * 10 + lo else null
    }

    fun historyRequest(stream: JStyle2301HistoryStream, continuation: Boolean = false): ByteArray =
        command(stream.opcode, if (continuation) 2 else 0)

    /** Vendor `BleSDK.RealTimeStep(true, false)`, sent 500 ms before the measurement command. */
    fun prepareRealtimeMeasurement(enable: Boolean = true): ByteArray = packet(
        REALTIME_STEP, if (enable) 0x01 else 0x00, 0x00,
    )

    /** Vendor `BleSDK.SetDeviceMeasurementWithType(AutoHeartRate, seconds, start)`. */
    fun heartRateMeasurement(start: Boolean, seconds: Int = 30): ByteArray {
        require(seconds in 1..0xFFFF) { "measurement duration must fit two bytes" }
        return packet(
            MEASUREMENT_WITH_TYPE,
            MEASUREMENT_TYPE_HEART_RATE,
            if (start) 1 else 0,
            seconds and 0xFF,
            (seconds ushr 8) and 0xFF,
        )
    }

    /** Vendor `BleSDK.EnterActivityMode(2, mode, state)`: 1 start, 4 stop. */
    fun sportMode(mode: Int, state: Int): ByteArray {
        require(mode in 0..0xFF && state in 1..4)
        return packet(SPORT_MODE, state, mode, 0, 2)
    }

    /** Non-mutating, connection-scoped authentication required by the ring's firmware V0789. */
    fun authenticationRequest(password: String): ByteArray {
        require(password.length in 1..14) { "ring credential must contain 1 to 14 characters" }
        require(password.all { it.code in 0x20..0x7E }) {
            "ring credential must contain printable ASCII only"
        }
        return authenticationRequest(password.toByteArray(Charsets.US_ASCII))
    }

    /** Byte form for the built-in firmware passcode; no decoded copy or diagnostic string. */
    fun authenticationRequest(encoded: ByteArray): ByteArray {
        require(encoded.size in 1..14 && encoded.all { (it.toInt() and 0xFF) in 0x20..0x7E }) {
            "ring firmware passcode is invalid"
        }
        return ByteArray(16).also { packet ->
            packet[0] = AUTHENTICATE.toByte()
            encoded.copyInto(packet, destinationOffset = 1)
            packet[15] = packet.take(15).sumOf { it.toInt() and 0xFF }.and(0xFF).toByte()
        }
    }

    /** Safe representation for diagnostics; preserves the opcode and erases the credential. */
    fun redactedAuthenticationRequest(): ByteArray = command(AUTHENTICATE)

    fun command(opcode: Int, mode: Int? = null): ByteArray {
        require(opcode in 0..0xFF) { "opcode must fit in one byte" }
        require(mode == null || mode == 0 || mode == 2) { "history mode must be 0 or 2" }
        return ByteArray(16).also { packet ->
            packet[0] = opcode.toByte()
            if (mode != null) packet[1] = mode.toByte()
            packet[15] = packet.take(15).sumOf { it.toInt() and 0xFF }.and(0xFF).toByte()
        }
    }

    private fun packet(opcode: Int, vararg payload: Int): ByteArray {
        require(opcode in 0..0xFF && payload.size <= 14)
        return ByteArray(16).also { packet ->
            packet[0] = opcode.toByte()
            payload.forEachIndexed { index, value -> packet[index + 1] = value.toByte() }
            packet[15] = packet.take(15).sumOf { it.toInt() and 0xFF }.and(0xFF).toByte()
        }
    }

    fun isTerminal(packet: ByteArray, stream: JStyle2301HistoryStream): Boolean =
        packet.isNotEmpty() && (packet[0].toInt() and 0xFF) == stream.opcode &&
            (packet.last().toInt() and 0xFF) == 0xFF
}
