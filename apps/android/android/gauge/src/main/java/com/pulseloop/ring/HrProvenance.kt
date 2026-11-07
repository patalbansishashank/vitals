package com.pulseloop.ring

/**
 * Heart-rate provenance and cadence on the wire (energy SPEC §S2.3, "hr-support/1"; audit A1/F01).
 *
 * The server gives a reading supported time only when its sampling cadence is declared:
 * `data.cadence_s`, or the provenance markers [WORKOUT_HISTORY] / [DEVICE_WORKOUT]
 * (`packages/companion/src/home/hrSupport.ts` `declaredCadenceS`). Gauge therefore labels exactly
 * two kinds of reading as workout readings, each with a cadence it has verified:
 *
 * - [WORKOUT_HISTORY]: a reading of a ring's own workout stream, whose cadence the record layout
 *   fixes (J-Style `0x54`: 15 readings, 10 s apart).
 * - [DEVICE_WORKOUT]: a live sample taken while a workout records in Gauge, whose cadence is the
 *   measured gap to the previous live sample of that workout ([MAX_LIVE_CADENCE_S] at most).
 *
 * Ordinary all-day history (5-minute grids and similar) is never a workout reading: its rows keep
 * `device_history` / `vendor_history` and carry no cadence. [workoutCadence] is the one gate.
 */
object HrProvenance {
    const val WORKOUT_HISTORY = "workout_history"
    const val DEVICE_WORKOUT = "device_workout"
    /** A live gap longer than this is a dropout, not a cadence: such a sample declares none. */
    const val MAX_LIVE_CADENCE_S = 30
    /** The server's own ceiling for a declared cadence. */
    private const val MAX_DECLARED_S = 3_600

    fun isWorkout(provenance: String?): Boolean = provenance == WORKOUT_HISTORY || provenance == DEVICE_WORKOUT

    /** The cadence to keep for a reading: only a workout reading's, and only a plausible one. */
    fun workoutCadence(provenance: String?, cadenceS: Int?): Int? =
        cadenceS?.takeIf { isWorkout(provenance) && it in 1..MAX_DECLARED_S }
}
