package com.pulseloop.service

import android.content.pm.ServiceInfo
import android.os.Build
import com.pulseloop.data.entity.ActivityEventEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.6.3 S26 (catalogue id → ring sport type, kept on the session) and S20 (GPS access + fallback). */
class RecordingActivityTypeTest {

    @Test fun `catalogue ids map to the ring's sport type and unknown ids fall back to the coarse type`() {
        assertEquals("run", RecordingActivityType.sportTypeFor("treadmill_run", "other"))
        assertEquals("run", RecordingActivityType.sportTypeFor("jog_outdoor", "walk"))
        assertEquals("walk", RecordingActivityType.sportTypeFor("treadmill_incline_walk", "other"))
        assertEquals("walk", RecordingActivityType.sportTypeFor("brisk_walk", "other"))
        assertEquals("cycle", RecordingActivityType.sportTypeFor("air_bike", "other"))
        assertEquals("cycle", RecordingActivityType.sportTypeFor("stationary_bike", "cycle"))
        assertEquals("gym", RecordingActivityType.sportTypeFor("mudgar_pair", "other"))
        assertEquals("gym", RecordingActivityType.sportTypeFor("mudgar_two_hand", "other"))
        assertEquals("gym", RecordingActivityType.sportTypeFor("dumbbells", "other"))
        assertEquals("gym", RecordingActivityType.sportTypeFor("db_curl", "other"))
        assertEquals("yoga", RecordingActivityType.sportTypeFor("hatha_yoga", "other"))
        assertEquals("yoga", RecordingActivityType.sportTypeFor("trikonasana", "other"))
        assertEquals("hike", RecordingActivityType.sportTypeFor("hike", "walk"))
        assertEquals("sport", RecordingActivityType.sportTypeFor("badminton", "other"))
        assertEquals("dance", RecordingActivityType.sportTypeFor("garba", "other"))
        // Unknown id: kept, but the ring follows the coarse type.
        assertEquals("walk", RecordingActivityType.sportTypeFor("something_new", "walk"))
        // No id: exactly the 2.8.0 behaviour.
        for (t in listOf("walk", "run", "cycle", "other")) assertEquals(t, RecordingActivityType.sportTypeFor(null, t))
    }

    @Test fun `ids are lowercase catalogue words, at most 48 characters`() {
        assertTrue(RecordingActivityType.isValidId("treadmill_run"))
        assertTrue(RecordingActivityType.isValidId("a".repeat(48)))
        assertFalse(RecordingActivityType.isValidId("a".repeat(49)))
        assertFalse(RecordingActivityType.isValidId(""))
        assertFalse(RecordingActivityType.isValidId("Treadmill"))
        assertFalse(RecordingActivityType.isValidId("air bike"))
        assertFalse(RecordingActivityType.isValidId("_x"))
        assertFalse(RecordingActivityType.isValidId("x/../y"))
    }

    @Test fun `the started event round-trips, and a later gps_unavailable event overrides`() {
        val start = RecordingStart("treadmill_run", "run", gpsRequested = true, gpsUnavailable = null)
        val events = listOf(
            ActivityEventEntity(sessionId = "s", kind = "paused", timestamp = 5),
            ActivityEventEntity(sessionId = "s", kind = RecordingStart.STARTED_EVENT, timestamp = 1, payloadJSON = start.toJson()),
        )
        assertEquals(start, RecordingStart.fromEvents(events))
        val blocked = events + ActivityEventEntity(
            sessionId = "s", kind = RecordingStart.GPS_UNAVAILABLE_EVENT, timestamp = 3,
            payloadJSON = RecordingStart.gpsUnavailablePayload(WorkoutGpsAccess.BACKGROUND_BLOCKED),
        )
        assertEquals(start.copy(gpsUnavailable = "gps_background_blocked"), RecordingStart.fromEvents(blocked))
        // A pre-2.8.1 session has no started event.
        assertNull(RecordingStart.fromEvents(events.take(1)))
        // No catalogue id: the field is absent, not empty.
        val coarse = RecordingStart(null, "walk", gpsRequested = false, gpsUnavailable = null)
        assertFalse(coarse.toJson().contains("activity_type_id"))
        assertEquals(coarse, RecordingStart.fromEvents(listOf(ActivityEventEntity(sessionId = "s", kind = "started", timestamp = 1, payloadJSON = coarse.toJson()))))
    }

    @Test fun `gps needs precise location and location switched on`() {
        assertEquals("gps_permission_missing", WorkoutGpsAccess.blocker(fineGranted = false, coarseGranted = false, locationOn = true))
        assertEquals("gps_precise_permission_missing", WorkoutGpsAccess.blocker(fineGranted = false, coarseGranted = true, locationOn = true))
        assertEquals("gps_location_off", WorkoutGpsAccess.blocker(fineGranted = true, coarseGranted = true, locationOn = false))
        assertNull(WorkoutGpsAccess.blocker(fineGranted = true, coarseGranted = false, locationOn = true))
    }

    @Test fun `the workout service runs as location only while a route is recorded`() {
        val health = ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        val location = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        assertEquals(health or location, WorkoutForegroundService.serviceTypes(34, withLocation = true))
        assertEquals(health, WorkoutForegroundService.serviceTypes(34, withLocation = false))
        assertEquals(0, WorkoutForegroundService.serviceTypes(Build.VERSION_CODES.P, withLocation = true))
    }
}
