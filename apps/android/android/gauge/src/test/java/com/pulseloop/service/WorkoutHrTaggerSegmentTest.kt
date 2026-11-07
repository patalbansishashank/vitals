package com.pulseloop.service

import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.ring.PulseEvent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.time.Instant

/**
 * 0.6.3 final review aR18: a live sample's declared cadence never spans a pause, even when no heart-rate event arrives
 * during the pause. [RecordingWindow] starts a new recording segment (generation) at every resume, and
 * [WorkoutHrTagger] observes spacing only within one segment.
 */
class WorkoutHrTaggerSegmentTest {
    @After fun reset() {
        RecordingWindow.setForTest(null)
        RecordingWindow.clock = { System.currentTimeMillis() }
    }

    private fun hr(tagger: WorkoutHrTagger, s: Long) =
        tagger.tag(PulseEvent.HeartRateSample(100, Instant.ofEpochSecond(s))) as PulseEvent.HeartRateSample

    @Test fun `a pause with no heart-rate event still resets the cadence`() {
        var active: RecordingWindow.Active? = RecordingWindow.Active("w1", 0, segment = 1, segmentStartMs = 0)
        val tagger = WorkoutHrTagger { active }
        assertNull(hr(tagger, 10).cadenceS)
        assertEquals(5, hr(tagger, 15).cadenceS)
        // paused at 16 s, resumed at 20 s: no sample arrived while paused
        active = RecordingWindow.Active("w1", 0, segment = 2, segmentStartMs = 20_000)
        val first = hr(tagger, 22)
        assertEquals("w1", first.workoutSessionId)
        assertNull("the first sample after the resume declares nothing (its spacing was not observed)", first.cadenceS)
        assertEquals(2, hr(tagger, 24).cadenceS)
    }

    @Test fun `a sample from the paused time delivered after the resume is not workout time`() {
        var active: RecordingWindow.Active? = RecordingWindow.Active("w1", 0, segment = 1, segmentStartMs = 0)
        val tagger = WorkoutHrTagger { active }
        hr(tagger, 10)
        active = RecordingWindow.Active("w1", 0, segment = 2, segmentStartMs = 20_000)
        val late = hr(tagger, 18)
        assertNull(late.workoutSessionId)
        assertNull(late.cadenceS)
        assertNull(hr(tagger, 21).cadenceS)
        assertEquals(3, hr(tagger, 24).cadenceS)
    }

    @Test fun `every resume of the same recording is a new segment that starts at the resume`() {
        var now = 1_000_000L
        RecordingWindow.clock = { now }
        val session = ActivitySessionEntity(id = "w1", type = "run", statusRaw = "recording", startedAt = 990_000L)
        val recording = LiveWorkoutManager.WorkoutState(isRecording = true, activeSession = session)
        RecordingWindow.update(recording)
        val first = RecordingWindow.current!!
        assertEquals(990_000L, first.segmentStartMs) // the first segment starts with the recording
        now += 5_000
        RecordingWindow.update(recording.copy(elapsedSeconds = 15)) // a tick: same segment
        assertSame(first, RecordingWindow.current)
        now += 5_000
        RecordingWindow.update(recording.copy(isPaused = true, activeSession = session.copy(statusRaw = "paused")))
        assertNull(RecordingWindow.current)
        now += 30_000
        RecordingWindow.update(recording)
        val resumed = RecordingWindow.current!!
        assertEquals("w1", resumed.sessionId)
        assertNotEquals(first.segment, resumed.segment)
        assertEquals(now, resumed.segmentStartMs)
        // a new recording is a new segment from its own start
        RecordingWindow.update(LiveWorkoutManager.WorkoutState())
        val next = ActivitySessionEntity(id = "w2", type = "walk", statusRaw = "recording", startedAt = now + 60_000)
        now += 61_000
        RecordingWindow.update(LiveWorkoutManager.WorkoutState(isRecording = true, activeSession = next))
        assertEquals(next.startedAt, RecordingWindow.current!!.segmentStartMs)
        assertNotEquals(resumed.segment, RecordingWindow.current!!.segment)
    }
}
