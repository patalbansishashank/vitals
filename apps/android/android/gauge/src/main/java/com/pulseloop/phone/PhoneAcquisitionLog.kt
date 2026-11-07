package com.pulseloop.phone

import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.PhoneSourceDao

/**
 * When the phone counter was actually acquiring (`phone/acquisition`, SPEC §2.1): intervals of
 * `listening | stopped | noSensor | noPermission`. Unknown is not zero (SPEC §1.2): a minute
 * outside a `listening` interval is unknown for the phone, never a confirmed zero.
 *
 * - One interval is open at a time. A transition closes it and opens the next in one transaction.
 * - (P) An interval never crosses a UTC hour boundary: the next [touch] after the hour closes it and
 *   opens a continuation, so the server learns about a long listening stretch within the hour
 *   instead of when the service next stops. Only closed intervals are uploaded.
 * - [touch] records the last moment the state is known to have held. After a process death the
 *   open interval is closed at that moment on the next [recover], and the gap until now is logged
 *   as `stopped`. That under-reports listening, which is the safe direction.
 * - A `listening` interval also records whether the step detector was actually registered
 *   ([DETECTOR_REGISTERED] / [DETECTOR_ABSENT] / [DETECTOR_FAILED], Gauge 2.8.1): only a registered
 *   detector lets the server count the interval's step-free minutes as observed zero. A change of
 *   detector state opens a new interval, like a change of state; an hourly continuation keeps it.
 */
class PhoneAcquisitionLog(private val store: Store) {

    /** The slice of [PhoneSourceDao] the log needs; in memory in tests. */
    interface Store {
        suspend fun openInterval(): PhoneAcquisitionEntity?
        suspend fun transition(closing: PhoneAcquisitionEntity?, next: PhoneAcquisitionEntity?)
        suspend fun touchOpen(at: Long)
    }

    class DaoStore(private val dao: PhoneSourceDao) : Store {
        override suspend fun openInterval() = dao.openInterval()
        override suspend fun transition(closing: PhoneAcquisitionEntity?, next: PhoneAcquisitionEntity?) = dao.transition(closing, next)
        override suspend fun touchOpen(at: Long) = dao.touchOpen(at)
    }

    /** Close an interval left open by a previous process at its last-seen time; log the gap. */
    suspend fun recover(now: Long) {
        val open = store.openInterval() ?: return
        val closedAt = open.lastSeenMs.coerceIn(open.fromMs, now)
        store.transition(open.copy(toMs = closedAt), null)
        if (now > closedAt) {
            store.transition(PhoneAcquisitionEntity(fromMs = closedAt, toMs = now, state = STOPPED, lastSeenMs = now), null)
        }
    }

    /**
     * Enter [state] at [at]; [detector] is the step detector's registration for `listening` (ignored
     * for other states). A repeat of the current state and detector only touches it.
     */
    suspend fun enter(state: String, at: Long, detector: String? = null) {
        val det = if (state == LISTENING) detector else null
        val open = store.openInterval()
        if (open != null && open.state == state && open.detector == det) {
            touch(at)
            return
        }
        val closing = open?.copy(toMs = at.coerceAtLeast(open.fromMs), lastSeenMs = at)
        store.transition(closing, PhoneAcquisitionEntity(fromMs = at, toMs = null, state = state, lastSeenMs = at, detector = det))
    }

    /** The current state still holds at [at]; rolls the interval over at a UTC hour boundary. */
    suspend fun touch(at: Long) {
        var open = store.openInterval() ?: return
        while (true) {
            val hourEnd = (Math.floorDiv(open.fromMs, HOUR_MS) + 1) * HOUR_MS
            if (at < hourEnd) break
            store.transition(
                open.copy(toMs = hourEnd, lastSeenMs = hourEnd),
                PhoneAcquisitionEntity(fromMs = hourEnd, toMs = null, state = open.state, lastSeenMs = hourEnd, detector = open.detector),
            )
            open = store.openInterval() ?: return
        }
        store.touchOpen(at)
    }

    companion object {
        const val LISTENING = "listening"
        const val STOPPED = "stopped"
        const val NO_SENSOR = "noSensor"
        const val NO_PERMISSION = "noPermission"
        /** `TYPE_STEP_DETECTOR` registered beside the counter: every step is timed, so a step-free minute is observed zero. */
        const val DETECTOR_REGISTERED = "registered"
        /** The phone has no step detector: counter only. */
        const val DETECTOR_ABSENT = "absent"
        /** The detector exists but `registerListener` refused it. */
        const val DETECTOR_FAILED = "failed"
        private const val HOUR_MS = 3_600_000L
    }
}
