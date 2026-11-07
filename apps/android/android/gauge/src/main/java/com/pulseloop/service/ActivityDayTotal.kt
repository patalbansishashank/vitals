package com.pulseloop.service

/**
 * The one rule for a day's step total, the number every screen, widget and coach tool reads from
 * `activity_daily.steps`: the larger of what the wearable reported for the day and the sum of the
 * day's distinct history buckets. Live counts lead the bucket history during the day; history
 * fills a day the live count missed. The stored total is never an input, so a wrong value
 * (2.7.3's duplicate buckets) is replaced by the next update instead of being ratcheted forever.
 */
object ActivityDayTotal {
    /** Totals above this are the old little-endian live-decode garbage, never a real day. */
    const val IMPLAUSIBLE_STEPS = 200_000

    fun steps(deviceSteps: Int?, bucketSteps: Int): Int = maxOf(deviceSteps ?: 0, bucketSteps)

    /** The device's own count after a new report: it only climbs within a day, unless garbage. */
    fun ratchetDevice(previous: Int?, reported: Int): Int =
        if (previous == null || previous > IMPLAUSIBLE_STEPS) reported else maxOf(previous, reported)

}
