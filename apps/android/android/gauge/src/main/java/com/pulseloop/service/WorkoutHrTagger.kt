package com.pulseloop.service

import com.pulseloop.ring.HrProvenance
import com.pulseloop.ring.PulseEvent

/**
 * The workout currently recording in Gauge, as the persistence collector needs it: published by
 * [LiveWorkoutManager] on every state change, read by [WorkoutHrTagger]. Null while nothing records
 * or the recording is paused (a pause is never supported time).
 *
 * Each unpaused stretch of a recording is its own **segment** (0.6.3 final review aR18): a new
 * `segment` generation and `segmentStartMs` at the recording's start and at every resume. The
 * tagger observes spacing only within one segment, so a cadence can never span a pause — even
 * when no heart-rate event arrived during the pause to reset it.
 */
object RecordingWindow {
    data class Active(
        val sessionId: String,
        val startedAtMs: Long,
        /** Moves at the recording's start and at every resume. */
        val segment: Long = 0,
        /** When this unpaused stretch began: the recording's start, or the resume. */
        val segmentStartMs: Long = startedAtMs,
    )

    @Volatile
    var current: Active? = null
        private set

    /** Test seam: the resume instant. */
    @Volatile
    internal var clock: () -> Long = { System.currentTimeMillis() }

    private var generation = 0L
    /** The recording last published (running or paused): telling a resume from a new start. */
    private var lastSessionId: String? = null

    fun update(state: LiveWorkoutManager.WorkoutState) {
        val session = state.activeSession
        val running = state.isRecording && !state.isPaused && session != null && session.statusRaw == "recording"
        val prev = current
        current = when {
            !running -> null
            // a tick of the same unpaused stretch keeps its segment
            prev != null && prev.sessionId == session!!.id -> prev
            else -> {
                val resumed = lastSessionId == session!!.id
                Active(session.id, session.startedAt, ++generation, if (resumed) maxOf(session.startedAt, clock()) else session.startedAt)
            }
        }
        lastSessionId = if (state.isRecording && session != null) session.id else null
    }

    internal fun setForTest(active: Active?) {
        current = active
        lastSessionId = active?.sessionId
    }
}

/**
 * Tags live heart-rate samples taken while a workout records (audit A1/F01, [HrProvenance]).
 *
 * A sample inside the recording gets its workout's id, and — when the gap to the previous live
 * sample of the same recording is a plausible stream cadence (1 s to [HrProvenance.MAX_LIVE_CADENCE_S])
 * — that gap as its verified cadence, so the server can give it supported time. The first sample of
 * a recording, the first after a pause, and one after a dropout declare no cadence: their spacing
 * has not been observed. Spot readings, measurement frames, samples outside a recording and every
 * other event pass through untouched. Only the persistence collector calls this, so no lock.
 */
class WorkoutHrTagger(private val recording: () -> RecordingWindow.Active? = { RecordingWindow.current }) {
    private var lastSessionId: String? = null
    private var lastSegment: Long? = null
    private var lastAtMs: Long? = null

    fun tag(event: PulseEvent): PulseEvent {
        if (event !is PulseEvent.HeartRateSample) return event
        if (event.spot || event.measurementResult || event.measurementStream) return event
        val active = recording()
        val at = event.timestamp.toEpochMilli()
        // before the recording, or a sample from the pause delivered after the resume: not workout time
        if (active == null || at < active.startedAtMs || at < active.segmentStartMs) {
            if (active == null) { lastSessionId = null; lastSegment = null; lastAtMs = null }
            return event
        }
        // (aR18) spacing is observed only within one unpaused segment: a pause resets it even with no sample in it
        val previous = lastAtMs.takeIf { lastSessionId == active.sessionId && lastSegment == active.segment }
        val gapMs = previous?.let { at - it }
        val cadence = gapMs
            ?.takeIf { it >= 1_000L && it <= HrProvenance.MAX_LIVE_CADENCE_S * 1_000L }
            ?.let { ((it + 500L) / 1_000L).toInt() }
        if (previous == null || at > previous) {
            lastSessionId = active.sessionId
            lastSegment = active.segment
            lastAtMs = at
        }
        return event.copy(cadenceS = cadence, workoutSessionId = active.sessionId)
    }
}
