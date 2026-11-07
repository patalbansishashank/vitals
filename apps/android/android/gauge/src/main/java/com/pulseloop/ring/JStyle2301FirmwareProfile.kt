package com.pulseloop.ring

/**
 * Version-specific semantics layered on top of the J-Style 2301 wire framing.
 *
 * The opcodes and record cutters describe the protocol family. They are not evidence that a byte
 * has kept the same meaning across firmware revisions. An unknown revision therefore retains
 * opaque values but does not promote them to HRV or named sleep stages.
 */
internal enum class JStyle2301FirmwareProfile(
    val revision: String?,
    val requiresAuthentication: Boolean,
) {
    /** Physical J-Style 2301 ring + vendor-app Health Connect comparison, captured on 2026-09-13/14. */
    V0525("V0525", requiresAuthentication = false),

    /**
     * Authentication, HRV, and activity-time semantics verified on the physical V0789 ring.
     * Consecutive vendor-app comparisons resolve its observed sleep vocabulary: 1/2/3 retain the
     * Deep/Light/REM meanings, while 5 and the short 10/11 markers are Awake.
     */
    V0789("V0789", requiresAuthentication = true),

    /** A revision for which we have not captured a matching vendor-app baseline. */
    UNKNOWN(null, requiresAuthentication = false),
    ;

    fun hrvMillis(raw: Int): Double? = when (this) {
        // 399/399 timestamp-matched samples: vendor-app RMSSD == floor(raw / 2 + 5).
        // V0789: 2/2 timestamp-matched post-OTA samples agreed exactly with the vendor app's Health
        // Connect RMSSD (raw 91 -> 50 ms, raw 113 -> 61 ms), using the same V0525 transform.
        V0525, V0789 -> (raw / 2 + 5).toDouble()
        UNKNOWN -> null
    }

    fun sleepStage(raw: Int): SleepStage = when (this) {
        V0525 -> when (raw) {
            1 -> SleepStage.DEEP
            2 -> SleepStage.LIGHT
            3 -> SleepStage.REM
            // 5 is the ordinary awake code. 11/12 occur only as the first minute of a V0525
            // packet and aligned with the vendor app's awake intervals on every overlapping occurrence.
            5, 11, 12 -> SleepStage.AWAKE
            else -> SleepStage.UNKNOWN
        }
        V0789 -> when (raw) {
            1 -> SleepStage.DEEP
            2 -> SleepStage.LIGHT
            3 -> SleepStage.REM
            // Two consecutive V0789 comparisons resolved 5 as Awake. The apparent conflict in
            // the first comparison came from comparing every raw-5 minute with the vendor app's WASO only:
            // the wider ring window also contains pre-sleep wake. On the next night, raw 5 covered
            // both that leading interval and the in-session wake, and excluding it brought Lumen's
            // asleep total to within one minute of the vendor app's. 10/11 remain observed awake markers.
            5, 10, 11 -> SleepStage.AWAKE
            else -> SleepStage.UNKNOWN
        }
        UNKNOWN -> SleepStage.UNKNOWN
    }

    fun activeMinutes(exerciseDurationRaw: Long): Int? = when (this) {
        // The SDK's realtime parser divides this field by 60; its total-history parser omits the
        // division. The live V0525 sequence (693 -> 722 -> 730 -> 735) also advances as seconds,
        // not minutes. Match integer-minute display semantics without rounding incomplete minutes.
        // V0789 retains the 27-byte activity record and the field remains seconds: the first
        // post-OTA total reported 34 with only 77 steps at 02:27, not a plausible 34 active min.
        V0525, V0789 -> (exerciseDurationRaw / 60L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        UNKNOWN -> null
    }

    val replacesActiveMinutes: Boolean get() = this == V0525 || this == V0789

    companion object {
        fun forRevision(revision: String?): JStyle2301FirmwareProfile =
            when (revision?.trim()?.uppercase()?.removePrefix("V")) {
                "0525" -> V0525
                "0789" -> V0789
                else -> UNKNOWN
            }
    }
}
