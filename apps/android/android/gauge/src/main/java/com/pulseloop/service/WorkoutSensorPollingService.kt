package com.pulseloop.service

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivitySensorPollEntity
import kotlinx.coroutines.*
import androidx.room.withTransaction

/**
 * Ported from [WorkoutSensorPollingService] in WorkoutSensorPollingService.swift.
 * Periodically polls the ring for HR (~60s) and SpO2 (~5min) during a workout.
 */
class WorkoutSensorPollingService(
    private val coordinator: RingSyncCoordinator,
    private val db: PulseLoopDatabase,
) {
    var onPollCompleted: (() -> Unit)? = null

    private var sessionId: String? = null
    private var pollingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var nextHRPoll = 0L
    private var nextSpO2Poll = 0L
    private var isPolling = false

    private val hrIntervalMs = 60_000L
    private val spo2IntervalMs = 300_000L
    private val disconnectedRetryMs = 10_000L

    fun start(sessionId: String) {
        this.sessionId = sessionId
        nextHRPoll = System.currentTimeMillis()
        nextSpO2Poll = System.currentTimeMillis()
        launchLoop()
    }

    fun pause() { pollingJob?.cancel(); pollingJob = null }
    fun resume() { launchLoop() }
    fun stop() { pollingJob?.cancel(); pollingJob = null; sessionId = null }

    private fun launchLoop() {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                val now = System.currentTimeMillis()

                // A continuous realtime stream is already feeding coordinator.latestHRValue —
                // don't spot-poll on top of it. measureHR()'s cleanup unconditionally disables
                // the ring's HR sensor (coordinator.stopWorkoutHeartRate() is the only thing that
                // should stop it), so spot-polling here would silently kill the workout's own
                // stream within one poll cycle (iOS #57f).
                if (!isPolling && now >= nextHRPoll && !coordinator.workoutHRActive) {
                    val didRead = poll("hr") { coordinator.measureHR() }
                    nextHRPoll = System.currentTimeMillis() + if (didRead) hrIntervalMs else disconnectedRetryMs
                }

                if (!isPolling && now >= nextSpO2Poll) {
                    val didRead = poll("spo2") { coordinator.measureSpO2() }
                    nextSpO2Poll = System.currentTimeMillis() + if (didRead) spo2IntervalMs else disconnectedRetryMs
                }

                delay(5000)
            }
        }
    }

    private suspend fun poll(kind: String, measure: suspend () -> Int?): Boolean {
        val sid = sessionId ?: return true
        if (!coordinator.isConnected) {
            record(sid, kind, "skipped", errorMessage = "ring disconnected")
            return false
        }
        isPolling = true
        return try {
            record(sid, kind, "started")
            val value = measure()
            if (value != null) {
                record(sid, kind, "success", value = value.toDouble())
                true
            } else {
                record(sid, kind, "failed", errorMessage = "no reading")
                false
            }
        } finally {
            isPolling = false
            onPollCompleted?.invoke()
        }
    }

    private suspend fun record(
        sessionId: String,
        kind: String,
        status: String,
        value: Double? = null,
        errorMessage: String? = null,
    ) = withContext(Dispatchers.IO) {
        db.withTransaction {
            db.activitySensorPollDao().insert(
                ActivitySensorPollEntity(
                    sessionId = sessionId,
                    timestamp = System.currentTimeMillis(),
                    kind = kind,
                    status = status,
                    value = value,
                    errorMessage = errorMessage,
                )
            )

            // Count one attempt at its "started" edge, then separately count failed/skipped
            // attempts. Keeping these counters on the workout row makes the finish summary and
            // archive cheap to read while the poll table preserves the full audit trail.
            if (status == "started" || status == "failed" || status == "skipped") {
                val session = db.activitySessionDao().byId(sessionId) ?: return@withTransaction
                val isHr = kind == "hr"
                val isSpo2 = kind == "spo2"
                val isFailure = status == "failed" || status == "skipped"
                db.activitySessionDao().upsert(
                    session.copy(
                        hrPollCount = if (isHr && status == "started") session.hrPollCount + 1 else session.hrPollCount,
                        hrPollFailureCount = if (isHr && isFailure) session.hrPollFailureCount + 1 else session.hrPollFailureCount,
                        spo2PollCount = if (isSpo2 && status == "started") session.spo2PollCount + 1 else session.spo2PollCount,
                        spo2PollFailureCount = if (isSpo2 && isFailure) session.spo2PollFailureCount + 1 else session.spo2PollFailureCount,
                        updatedAt = System.currentTimeMillis(),
                    )
                )
            }
        }
    }
}
