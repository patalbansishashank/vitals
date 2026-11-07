package com.pulseloop.service

import android.content.Context
import android.content.Intent
import androidx.work.WorkManager
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityEventEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.ui.components.ActivityMeta
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.asStateFlow

/**
 * Ported from [LiveWorkoutManager] in LiveWorkoutManager.swift.
 * Single orchestrator for a live workout: state machine, GPS, sensor polling, and
 * foreground service notification (replaces Live Activity).
 */
class LiveWorkoutManager(
    private val coordinator: RingSyncCoordinator,
    private val db: PulseLoopDatabase,
    val gps: GpsRouteRecorder,
    private val context: Context,
) {
    data class WorkoutState(
        val isRecording: Boolean = false,
        val isPaused: Boolean = false,
        val activeSession: ActivitySessionEntity? = null,
        val elapsedSeconds: Int = 0,
        val distanceMeters: Double = 0.0,
        val latestHeartRate: Int? = null,
        val latestSpO2: Int? = null,
        val hrZone: HeartRateZones.Zone = HeartRateZones.Zone.REST,
        /** Set when a finish completes — the record route observes this to navigate to the
         *  summary, since a finish from the notification action has no button handler to do it
         *  (iOS routes off state the same way after an App Group command). */
        val finishedSessionId: String? = null,
    )

    private val _state = kotlinx.coroutines.flow.MutableStateFlow(WorkoutState())
    val state = _state.asStateFlow()

    private val polling = WorkoutSensorPollingService(coordinator, db)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var tickJob: Job? = null
    /** The Gauge type the ring's sport mode and the GPS profile follow for the active recording. */
    private var activeSportType: String? = null

    // Foreground service intent for start/stop
    private val serviceIntent = Intent(context, WorkoutForegroundService::class.java)

    init {
        polling.onPollCompleted = { refreshNotification() }
        // The persistence collector tags live heart rate taken while this records (A1).
        scope.launch { state.collect { RecordingWindow.update(it) } }
        // Notification actions (pause/resume/finish) arrive through the bus — the service has no
        // access to the real workout logic, so it posts and we apply (iOS App Group pattern).
        scope.launch {
            WorkoutCommandBus.commands.collect { command ->
                val s = _state.value.activeSession ?: return@collect
                when (command) {
                    WorkoutCommandBus.COMMAND_PAUSE -> if (s.statusRaw == "recording") pause(s)
                    WorkoutCommandBus.COMMAND_RESUME -> if (s.statusRaw == "paused") resume(s)
                    WorkoutCommandBus.COMMAND_FINISH ->
                        if (s.statusRaw == "recording" || s.statusRaw == "paused") finish(s)
                    WorkoutCommandBus.COMMAND_GPS_BLOCKED -> onGpsBlocked()
                }
            }
        }
    }

    // MARK: - Lifecycle

    /** A started recording, and why a requested route is not being recorded (null = it is, or none asked). */
    data class Started(val session: ActivitySessionEntity, val gpsUnavailable: String?)

    suspend fun start(type: String, useGps: Boolean): ActivitySessionEntity = startRecording(type, useGps).session

    /**
     * Starts a recording of coarse [type] (`walk | run | cycle | other`, or any Gauge type), with
     * the catalogue [activityTypeId] Vitals picked, if any (0.6.3 S26). The ring's sport mode follows
     * [RecordingActivityType.sportTypeFor]; the session keeps [type]. A route is recorded only when
     * [useGps] and location is usable; otherwise the recording starts without one (the no-GPS
     * fallback, S20) and [Started.gpsUnavailable] says why.
     */
    suspend fun startRecording(type: String, useGps: Boolean, activityTypeId: String? = null): Started {
        // A stale "workout complete" dismiss worker from a just-finished workout shares the
        // ongoing notification's id — cancel it before it can fire into this workout's card
        // (second-pass finding #25).
        WorkManager.getInstance(context).cancelUniqueWork(WorkoutForegroundService.DISMISS_WORK_NAME)
        val sportType = RecordingActivityType.sportTypeFor(activityTypeId, type)
        var gpsUnavailable = if (useGps) WorkoutGpsAccess.blocker(context) else null
        val startedAt = System.currentTimeMillis()
        var session = ActivitySessionEntity(
            type = type,
            startedAt = startedAt,
            useGps = useGps && gpsUnavailable == null,
        )
        db.activitySessionDao().upsert(session)

        coordinator.startWorkoutHeartRate(sportType)
        if (session.useGps && !gps.start(session.id, sportType)) {
            gpsUnavailable = WorkoutGpsAccess.blocker(context) ?: WorkoutGpsAccess.PERMISSION_MISSING
            session = session.copy(useGps = false)
            db.activitySessionDao().upsert(session)
        }
        db.activityEventDao().insert(ActivityEventEntity(
            sessionId = session.id,
            kind = RecordingStart.STARTED_EVENT,
            timestamp = startedAt,
            payloadJSON = RecordingStart(activityTypeId, sportType, useGps, gpsUnavailable).toJson(),
        ))
        activeSportType = sportType
        polling.start(session.id)
        startForegroundService(withLocation = session.useGps)

        startTick(session)
        // Fresh state (not copy): clears any previous workout's finishedSessionId/paused flags.
        _state.value = WorkoutState(isRecording = true, activeSession = session)
        return Started(session, gpsUnavailable)
    }

    /** The workout service could not run as `location`: stop the route, record why, carry on. */
    private suspend fun onGpsBlocked() {
        val s = _state.value.activeSession ?: return
        gps.stop()
        val updated = s.copy(useGps = false, updatedAt = System.currentTimeMillis())
        db.activitySessionDao().upsert(updated)
        db.activityEventDao().insert(ActivityEventEntity(
            sessionId = s.id,
            kind = RecordingStart.GPS_UNAVAILABLE_EVENT,
            timestamp = System.currentTimeMillis(),
            payloadJSON = RecordingStart.gpsUnavailablePayload(WorkoutGpsAccess.BACKGROUND_BLOCKED),
        ))
        _state.value = _state.value.copy(activeSession = updated)
    }

    suspend fun pause(session: ActivitySessionEntity) {
        val now = System.currentTimeMillis()
        // Mirror iOS PulseServices.pause (PulseServices.swift): write the `paused` +
        // `gps_stopped` ActivityEvents so the Strava TCX build can pair this pause with its
        // later `resumed` and drop the trackpoints recorded while paused. Both events share
        // this one `now` timestamp, exactly like iOS's single Date() stamp.
        // The endedAt column STILL doubles as the pausedAt marker alongside the events:
        // resume() turns it into the pause span and clears it, and it is what
        // totalPauseSeconds is computed from — the tick clock, the finish carry, and the TCX
        // TotalTimeSeconds all key on it. iOS computes the span from the last `paused` event
        // instead; keeping the marker means all that existing math is untouched. Do NOT add to
        // totalPauseSeconds here: the pause span isn't known until resume/finish, and the old
        // code added the entire elapsed-since-start, corrupting every downstream duration.
        val updated = session.copy(
            statusRaw = "paused",
            endedAt = now,
            updatedAt = now,
        )
        db.activitySessionDao().upsert(updated)
        // The pause markers themselves (why: see the comment above). The TCX builder reacts
        // only to `paused`/`resumed`; `gps_stopped` documents the GPS stop, for parity with iOS.
        db.activityEventDao().insert(ActivityEventEntity(sessionId = session.id, kind = "paused", timestamp = now))
        db.activityEventDao().insert(ActivityEventEntity(sessionId = session.id, kind = "gps_stopped", timestamp = now))
        gps.stop()
        polling.pause()
        coordinator.pauseWorkoutHeartRate()
        tickJob?.cancel()
        _state.value = _state.value.copy(isPaused = true, activeSession = updated)
        refreshNotification()
    }

    suspend fun resume(session: ActivitySessionEntity) {
        val now = System.currentTimeMillis()
        // Only the actual pause span joins the total (iOS: `now - lastPause.timestamp` at resume
        // — the span from the last `paused` event; the endedAt marker holds the same value here).
        val pausedAt = session.endedAt ?: now
        val updated = session.copy(
            statusRaw = "recording",
            endedAt = null,
            totalPauseSeconds = session.totalPauseSeconds + maxOf(0.0, (now - pausedAt) / 1000.0),
            updatedAt = now,
        )
        db.activitySessionDao().upsert(updated)
        // Mirror iOS PulseServices.resume: `resumed` closes the open pause for the TCX builder;
        // `gps_started` documents the GPS restart. Same shared `now` as iOS's single Date().
        db.activityEventDao().insert(ActivityEventEntity(sessionId = session.id, kind = "resumed", timestamp = now))
        db.activityEventDao().insert(ActivityEventEntity(sessionId = session.id, kind = "gps_started", timestamp = now))
        if (updated.useGps) gps.start(updated.id, activeSportType ?: updated.type)
        polling.resume()
        coordinator.resumeWorkoutHeartRate()
        startTick(updated)
        _state.value = _state.value.copy(isPaused = false, activeSession = updated)
        refreshNotification()
    }

    suspend fun finish(session: ActivitySessionEntity) {
        gps.stop()
        polling.stop()
        tickJob?.cancel()
        val now = System.currentTimeMillis()
        // Finishing from a paused state: the trailing pause span (pause → finish) is not active
        // time. iOS currently counts it as active (its pause total only advances at resume) —
        // deliberate divergence, noted as an upstream-iOS candidate in docs/ios-sync.md.
        val pauseCarry = if (session.statusRaw == "paused") {
            maxOf(0.0, (now - (session.endedAt ?: now)) / 1000.0)
        } else 0.0
        val finished = session.copy(
            statusRaw = "finished",
            endedAt = now,
            totalPauseSeconds = session.totalPauseSeconds + pauseCarry,
            updatedAt = now,
        )
        val summarized = ActivityAggregates.recompute(db, finished)
        db.activitySessionDao().upsert(summarized)
        ActivityRollup.credit(db, summarized)
        coordinator.stopWorkoutHeartRate()
        finishForegroundService(summarized)
        _state.value = WorkoutState(finishedSessionId = summarized.id)
        // Workout score / VO2 estimate / today's activity score should reach the same durable
        // broadcast path immediately, without waiting for the next ring-history sync.
        LocalInsightEngine.recomputeAndPublish(db, now)
        com.pulseloop.hub.HubSync.requestUpload(context)
    }

    suspend fun cancel(session: ActivitySessionEntity) {
        gps.stop()
        polling.stop()
        stopForegroundService()
        tickJob?.cancel()
        db.activitySessionDao().upsert(session.copy(
            statusRaw = "cancelled", endedAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis()
        ))
        coordinator.stopWorkoutHeartRate()
        _state.value = WorkoutState()
        com.pulseloop.hub.HubSync.requestUpload(context)
    }

    // MARK: - Tick loop

    private fun startTick(session: ActivitySessionEntity) {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isActive) {
                val now = System.currentTimeMillis()
                // The live clock shows *active* time — wall time minus completed pauses (iOS
                // RecordViews: `now - startedAt - totalPauseSeconds`). Pauses cancel this tick,
                // and resume restarts it with the updated session, so the captured total is
                // always current.
                val elapsed = maxOf(0, ((now - session.startedAt) / 1000.0 - session.totalPauseSeconds).toInt())
                val distance = gps.state.value.totalDistance
                val hr = coordinator.latestHRValue
                val zone = hr?.let { HeartRateZones.zoneFor(it) } ?: HeartRateZones.Zone.REST

                _state.value = _state.value.copy(
                    elapsedSeconds = elapsed,
                    distanceMeters = distance,
                    latestHeartRate = hr,
                    hrZone = zone,
                )

                if (elapsed % 5 == 0) refreshNotification()
                delay(1000)
            }
        }
    }

    // MARK: - Notification

    private fun refreshNotification() {
        serviceIntent.apply {
            val s = _state.value
            val notification = Intent(context, WorkoutForegroundService::class.java).apply {
                putExtra("activityName", s.activeSession?.let { ActivityMeta.label(it.type) } ?: "Workout")
                putExtra("status", if (s.isPaused) "paused" else "recording")
                putExtra("elapsedSeconds", s.elapsedSeconds)
                putExtra("distanceMeters", s.distanceMeters)
                putExtra("heartRate", s.latestHeartRate ?: 0)
            }
            context.startService(notification)
        }
    }

    private fun startForegroundService(withLocation: Boolean) {
        val intent = Intent(context, WorkoutForegroundService::class.java)
            .putExtra(WorkoutForegroundService.EXTRA_WITH_LOCATION, withLocation)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun stopForegroundService() {
        context.stopService(Intent(context, WorkoutForegroundService::class.java))
    }

    // Replaces the ongoing tracker notification with a "workout complete" summary card that
    // lingers for a while before auto-dismissing, instead of vanishing immediately (mirrors iOS
    // Live Activity's `.after(.now + 10*60)` dismissal policy vs. `.immediate` on cancel/discard).
    private fun finishForegroundService(session: ActivitySessionEntity) {
        // Duration excludes paused spans (iOS `finishedState`), clamped at 0 — with pauses
        // longer than the wall span an unclamped value renders as negative.
        val elapsedSeconds = maxOf(
            0,
            (((session.endedAt ?: System.currentTimeMillis()) - session.startedAt) / 1000.0 - session.totalPauseSeconds).toInt(),
        )
        val intent = Intent(context, WorkoutForegroundService::class.java).apply {
            action = WorkoutForegroundService.ACTION_FINISH
            putExtra("activityName", ActivityMeta.label(session.type))
            putExtra("sessionId", session.id)
            putExtra("elapsedSeconds", elapsedSeconds)
            putExtra("distanceMeters", session.distanceMeters ?: 0.0)
            session.calories?.let { putExtra("calories", it) }
            session.avgHeartRate?.let { putExtra("avgHeartRate", it) }
        }
        context.startService(intent)
    }

    fun destroy() { scope.cancel(); tickJob?.cancel() }
}
