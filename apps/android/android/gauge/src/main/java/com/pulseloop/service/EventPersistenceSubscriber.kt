package com.pulseloop.service

import android.content.Context
import androidx.room.withTransaction
import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.BroadcastOutboxDispatcher
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.*
import com.pulseloop.health.HealthConnectExportWorker
import com.pulseloop.hub.HubEventMapper
import com.pulseloop.hub.HubSync
import com.pulseloop.ring.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Ported from [EventPersistenceSubscriber] in PulseEventBus.swift.
 * Subscribes to PulseEventBus and persists ring data to Room.
 */
class EventPersistenceSubscriber(
    private val context: Context,
    private val db: PulseLoopDatabase,
    /**
     * Fired after a data-bearing event lands in Room (measurements, activity, sleep) — the
     * Android analog of iOS `PulseDataChange`. The widget snapshot publisher hooks this
     * (debounced) so home-screen widgets refresh after every ring-sync batch.
     */
    private val onDataPersisted: (() -> Unit)? = null,
    private val enabledOverride: (() -> Boolean)? = null,
    private val installationIdOverride: (() -> String)? = null,
    private val flushOverride: (() -> Unit)? = null,
    /** Test seam for proving that failures after the first DAO write roll back one event only. */
    private val afterEventPersistOverride: ((PulseEvent) -> Unit)? = null,
    /** Test seam placed inside multi-write atomic helpers, after their first real DAO write. */
    private val afterAtomicWriteOverride: ((String) -> Unit)? = null,
    /** Test seam; production uses cancellable exponential delay capped at five seconds. */
    private val batchRetryDelay: suspend (Long) -> Unit = { delay(it) },
    /**
     * Test seam for the HTTPS home-server outbox: the installation id while paired, null when not.
     * Production reads [HubSync]'s cached pairing (no keystore access on this path).
     */
    private val hubInstallationIdOverride: (() -> String?)? = null,
    private val hubFlushOverride: (() -> Unit)? = null,
    /** Test seam for the ring identity stamped on ring-derived uploads (SPEC §2.1). */
    private val ringSourceOverride: (suspend () -> com.pulseloop.broadcasting.RingSourceIdentity?)? = null,
    /** Test seam for the 7-day `0x18` capture's clock (GA.3). */
    private val nowOverride: (() -> Long)? = null,
    /** Test seam for the recording workout ([RecordingWindow]). */
    private val recordingOverride: (() -> RecordingWindow.Active?)? = null,
) {
    /**
     * The kinds whose live samples are currently *not* stored, because a spot measurement is
     * settling them (issue #60). Driven by [PulseEvent.LiveSampleGate], which the coordinator
     * sends through the same bus as the samples, so this collector sees the gate close before the
     * samples it must drop and reopen before the settled reading it must keep — whatever its lag
     * behind the ring. Only touched from the collector, so it needs no lock.
     */
    private val closedGates = mutableSetOf<MeasurementKind>()

    /**
     * Timestamps of the spot readings this app stored itself, per kind — the rows a ring that
     * logs its own spot measurements will later re-supply from history (issue #60, RC-1: two HR
     * rows per measurement, same minute, values a few bpm apart). Loaded lazily from the table
     * and kept current here so the history path can answer "is this the ring's copy of one of
     * ours?" without a query per history sample. See [adoptRingsCopy].
     */
    private val spotReadings = mutableMapOf<MeasurementKind, MutableList<Long>>()

    /** Marks live heart rate taken during a recording workout with its verified cadence (A1). */
    private val workoutHr = WorkoutHrTagger(recordingOverride ?: { RecordingWindow.current })

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var job: Job? = null
    private val broadcastSettings by lazy { BroadcastOutboxDispatcher.settingsStore(context.applicationContext) }
    private val broadcastInstallationId by lazy { broadcastSettings.installationId }
    private val captureSettings by lazy { com.pulseloop.settings.ApiKeyStore(context.applicationContext) }
    private var rawPacketInsertCount = 0
    /** The connected ring's identity for this batch's uploads; reset when a device event lands. */
    private var batchRingSource: com.pulseloop.broadcasting.RingSourceIdentity? = null
    private var batchRingSourceLoaded = false
    private var batchDeletedIds: Set<String>? = null
    private var batchSpotWindows: List<MeasurementDeletionEntity>? = null
    private var batchingBuckets = false
    /** A stale bucket's server-side deletion was queued in this batch (see [queueHubBucketDeletions]). */
    private var hubDeletionsQueued = false
    private val pendingBucketDays = linkedSetOf<Long>()
    private val changedActivityDays = linkedSetOf<Long>()
    private val changedInsightInputs = linkedSetOf<String>()
    private val insightThrottle = LocalInsightThrottle(scope) { inputs -> LocalInsightEngine.recomputeAndPublish(db, changedInputs = inputs) }

    /**
     * True after this connection has committed at least one sensor/history input. Some wearables
     * terminate a long GATT session before their explicit sync-finished marker. The disconnect
     * event is ordered after the final notification, so it is a safe fallback point for running
     * deterministic local insights over the partial-but-durable batch.
     */
    private var syncHasPersistedInputs = false

    // Battery-history throttle (iOS #61b) — in-memory, so the first reading after each (re)launch
    // always records; a change or a 30-min floor logs a fresh row otherwise, keeping the table to a
    // few dozen rows/day instead of one per BLE battery read.
    private var lastBatteryPercent: Int? = null
    private var lastBatteryLogAt: Long? = null
    private val batteryMinIntervalMs = 30 * 60_000L

    fun start() {
        if (job != null) return
        job = scope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            OrderedEventBatcher.collect(PulseEventBus.events, flush = ::persistBatch)
        }
    }

    fun stop() { job?.cancel(); job = null; insightThrottle.stop() }

    internal suspend fun persistBatch(incoming: List<PulseEvent>) {
        if (incoming.isEmpty()) return
        // Tagged once per batch, so a rolled-back attempt's retry sees the same cadences.
        val events = incoming.map(workoutHr::tag)
        var failures = 0
        while (!persistBatchOnce(events)) {
            val wait = persistenceRetryDelayMillis(failures++)
            android.util.Log.w(
                "EventPersistence",
                "Retrying rolled-back ${events.size}-event persistence batch in ${wait}ms",
            )
            batchRetryDelay(wait)
        }
    }

    /** Returns only after a full commit or a rollback. Post-commit callbacks never re-enter here. */
    private suspend fun persistBatchOnce(events: List<PulseEvent>): Boolean {
        val gatesBefore = closedGates.toSet()
        val spotsBefore = spotReadings.mapValues { it.value.toMutableList() }
        val batteryBefore = lastBatteryPercent to lastBatteryLogAt
        val rawBefore = rawPacketInsertCount
        val daysBefore = changedActivityDays.toSet()
        val landed = mutableListOf<PulseEvent>()
        var queued = false
        var hubQueued = false
        hubDeletionsQueued = false
        batchRingSourceLoaded = false
        try {
            db.withTransaction {
                preloadTombstones(events)
                batchingBuckets = true
                for ((index, event) in events.withIndex()) {
                    val eventState = eventMemorySnapshot()
                    val savepoint = "persistence_event_$index"
                    db.openHelper.writableDatabase.execSQL("SAVEPOINT $savepoint")
                    try {
                        // Encoding happens only while enabled, before any writes for this event.
                        val enabled = enabledOverride?.invoke() ?: broadcastSettings.settings.value.enabled
                        // SPEC §2.1: every ring-derived event names the ring that produced it.
                        val source = if (BroadcastEventMapper.isRingDerived(event)) ringSource() else null
                        val outbound = if (enabled) BroadcastEventMapper.toOutbox(event, installationIdOverride?.invoke() ?: broadcastInstallationId, source = source) else null
                        // The home-server upload has its own outbox and cursor (MQTT blanks its
                        // payloads after publish), written in this same savepoint as the health rows.
                        val hubInstallation = if (hubInstallationIdOverride != null) hubInstallationIdOverride.invoke() else HubSync.pairedInstallationId()
                        val hubOutbound = hubInstallation?.let { HubEventMapper.toHubOutbox(event, it, source = source) }
                        if (event is PulseEvent.ActivityUpdate || event is PulseEvent.SyncProgress) flushBucketRollups()
                        val persisted = persistUnsafe(event)
                        if (event is PulseEvent.DeviceStateChanged || event is PulseEvent.DeviceIdentified ||
                            event is PulseEvent.FirmwareRevision || event is PulseEvent.DeviceForgotten
                        ) batchRingSourceLoaded = false
                        afterEventPersistOverride?.invoke(event)
                        if (persisted) {
                            val enqueued = outbound != null && db.broadcastOutboxDao().enqueue(outbound) != -1L
                            val hubEnqueued = hubOutbound != null && db.hubOutboxDao().enqueue(hubOutbound) != -1L
                            db.openHelper.writableDatabase.execSQL("RELEASE SAVEPOINT $savepoint")
                            landed += event
                            queued = queued || enqueued
                            hubQueued = hubQueued || hubEnqueued
                        } else {
                            db.openHelper.writableDatabase.execSQL("RELEASE SAVEPOINT $savepoint")
                        }
                    } catch (e: Exception) {
                        if (e is CancellationException || e is android.database.SQLException) throw e
                        // Room's nested withTransaction joins the outer transaction; it is not a
                        // savepoint. Roll back the one malformed event explicitly so early writes
                        // can never commit without its outbox row or landed marker.
                        try {
                            db.openHelper.writableDatabase.execSQL("ROLLBACK TO SAVEPOINT $savepoint")
                            db.openHelper.writableDatabase.execSQL("RELEASE SAVEPOINT $savepoint")
                        } catch (rollback: android.database.SQLException) {
                            rollback.addSuppressed(e)
                            throw rollback
                        }
                        restoreEventMemory(eventState)
                        android.util.Log.e("EventPersistence", "Failed to persist event", e)
                    }
                }
                flushBucketRollups()
            }
        } catch (e: Exception) {
            // A rolled-back transaction must also roll back the subscriber's in-memory state.
            closedGates.clear(); closedGates.addAll(gatesBefore)
            spotReadings.clear(); spotReadings.putAll(spotsBefore)
            lastBatteryPercent = batteryBefore.first; lastBatteryLogAt = batteryBefore.second
            rawPacketInsertCount = rawBefore
            changedActivityDays.clear(); changedActivityDays.addAll(daysBefore)
            if (e is CancellationException) throw e
            android.util.Log.e("EventPersistence", "Failed to persist batch", e)
            return false
        } finally {
            batchDeletedIds = null; batchSpotWindows = null; batchingBuckets = false; pendingBucketDays.clear()
        }
        runPostCommit("data callback") {
            if (landed.any(::isDataEvent)) onDataPersisted?.invoke()
        }
        runPostCommit("broadcast flush") {
            if (queued) (flushOverride ?: { BroadcastOutboxDispatcher.requestFlush(context) }).invoke()
        }
        runPostCommit("hub upload request") {
            if (hubQueued || hubDeletionsQueued) (hubFlushOverride ?: { HubSync.requestUpload(context) }).invoke()
        }
        for (event in landed) {
            if (isInsightInputEvent(event)) {
                syncHasPersistedInputs = true
                changedInsightInputs += when (event) {
                    is PulseEvent.HistoryMeasurement -> event.kind.name
                    else -> event.javaClass.simpleName
                }
            }
            if (event is PulseEvent.SyncProgress && event.stage == "done") {
                val insightInputs = changedInsightInputs.toSet()
                syncHasPersistedInputs = false
                changedInsightInputs.clear()
                runPostCommitSuspend("calorie estimates", ::recomputeCalorieEstimates)
                runPostCommitSuspend("resting HR baseline") { RestingHRBaselineService.refreshIfStale(db) }
                runPostCommit("Health Connect enqueue") { HealthConnectExportWorker.enqueue(context) }
                runPostCommit("local insight request") { insightThrottle.request(true, insightInputs) }
            } else if (event is PulseEvent.DeviceStateChanged &&
                event.state in setOf(RingConnectionState.DISCONNECTED, RingConnectionState.FAILED) &&
                syncHasPersistedInputs
            ) {
                val insightInputs = changedInsightInputs.toSet()
                syncHasPersistedInputs = false
                changedInsightInputs.clear()
                runPostCommit("local insight fallback") {
                    insightThrottle.request(false, insightInputs)
                }
            }
        }
        return true
    }

    private data class EventMemorySnapshot(
        val gates: Set<MeasurementKind>,
        val spots: Map<MeasurementKind, MutableList<Long>>,
        val batteryPercent: Int?,
        val batteryAt: Long?,
        val rawCount: Int,
        val bucketDays: Set<Long>,
        val activityDays: Set<Long>,
    )

    private fun eventMemorySnapshot() = EventMemorySnapshot(
        gates = closedGates.toSet(),
        spots = spotReadings.mapValues { it.value.toMutableList() },
        batteryPercent = lastBatteryPercent,
        batteryAt = lastBatteryLogAt,
        rawCount = rawPacketInsertCount,
        bucketDays = pendingBucketDays.toSet(),
        activityDays = changedActivityDays.toSet(),
    )

    private fun restoreEventMemory(snapshot: EventMemorySnapshot) {
        closedGates.clear(); closedGates.addAll(snapshot.gates)
        spotReadings.clear(); spotReadings.putAll(snapshot.spots)
        lastBatteryPercent = snapshot.batteryPercent; lastBatteryLogAt = snapshot.batteryAt
        rawPacketInsertCount = snapshot.rawCount
        pendingBucketDays.clear(); pendingBucketDays.addAll(snapshot.bucketDays)
        changedActivityDays.clear(); changedActivityDays.addAll(snapshot.activityDays)
    }

    private inline fun runPostCommit(label: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            android.util.Log.e("EventPersistence", "Post-commit $label failed", e)
        }
    }

    private suspend inline fun runPostCommitSuspend(
        label: String,
        crossinline block: suspend () -> Unit,
    ) {
        try {
            block()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            android.util.Log.e("EventPersistence", "Post-commit $label failed", e)
        }
    }

    /** The current real ring as [com.pulseloop.broadcasting.RingSourceIdentity], read once per batch. */
    private suspend fun ringSource(): com.pulseloop.broadcasting.RingSourceIdentity? {
        if (batchRingSourceLoaded) return batchRingSource
        val source = if (ringSourceOverride != null) ringSourceOverride.invoke() else {
            val device = db.deviceDao().currentReal()
            com.pulseloop.broadcasting.RingSourceIdentity(
                deviceKey = com.pulseloop.broadcasting.RingSourceIdentity.deviceKey(device?.bleAddressHint ?: device?.peripheralIdentifier),
                deviceModel = device?.let { it.wearableModelID ?: it.deviceType.name.lowercase() },
                firmware = device?.firmwareVersion,
                decoderVersion = device?.let { com.pulseloop.broadcasting.RingSourceIdentity.decoderVersion(it.deviceType) },
                zone = java.time.ZoneId.systemDefault(),
            )
        }
        batchRingSource = source
        batchRingSourceLoaded = true
        return source
    }

    private suspend fun preloadTombstones(events: List<PulseEvent>) {
        val keys = events.flatMap { event ->
            try { when (event) {
                is PulseEvent.HistoryMeasurement -> listOf(event.kind to event.timestamp.toEpochMilli())
                is PulseEvent.StressSample -> if (event.isHistory) listOf(MeasurementKind.STRESS to event.timestamp.toEpochMilli()) else emptyList()
                is PulseEvent.TemperatureSample -> if (event.isHistory) listOf(MeasurementKind.TEMPERATURE to event.timestamp.toEpochMilli()) else emptyList()
                is PulseEvent.BloodPressureSample -> if (event.isHistory) listOf(MeasurementKind.BLOOD_PRESSURE_SYSTOLIC to event.timestamp.toEpochMilli(), MeasurementKind.BLOOD_PRESSURE_DIASTOLIC to event.timestamp.toEpochMilli()) else emptyList()
                else -> emptyList()
            } } catch (_: ArithmeticException) {
                // A malformed Instant is rejected by this event's own persistence path;
                // preloading its tombstone must not discard the other events in the flush.
                emptyList()
            }
        }
        batchDeletedIds = if (keys.isEmpty()) emptySet() else db.measurementBatchDeletionDao().deletedIds(keys.map { historyMeasurementId(it.first, it.second) }).toSet()
        val spots = keys.filter { it.first.name in SPOT_RECONCILED_KINDS }
        batchSpotWindows = if (spots.isEmpty()) emptyList() else db.measurementBatchDeletionDao().spotWindows(spots.map { it.first.name }.distinct(), spots.minOf { it.second } - SPOT_MATCH_MS, spots.maxOf { it.second } + SPOT_MATCH_MS)
    }

    /** Events that change what the Today tiles (and therefore the widgets) show. */
    private fun isDataEvent(event: PulseEvent): Boolean = when (event) {
        is PulseEvent.HeartRateSample,
        is PulseEvent.Spo2Result,
        is PulseEvent.HistoryMeasurement,
        is PulseEvent.StressSample,
        is PulseEvent.HrvSample,
        is PulseEvent.BloodPressureSample,
        is PulseEvent.BloodSugarSample,
        is PulseEvent.TemperatureSample,
        is PulseEvent.VendorMetric,
        is PulseEvent.DerivedInsight,
        is PulseEvent.ActivityUpdate,
        is PulseEvent.ActivityBucket,
        is PulseEvent.SleepTimeline -> true
        else -> false
    }

    /** Raw inputs only. Derived events must not re-arm the disconnect fallback themselves. */
    private fun isInsightInputEvent(event: PulseEvent): Boolean = when (event) {
        is PulseEvent.HeartRateSample,
        is PulseEvent.Spo2Result,
        is PulseEvent.HistoryMeasurement,
        is PulseEvent.StressSample,
        is PulseEvent.HrvSample,
        is PulseEvent.BloodPressureSample,
        is PulseEvent.BloodSugarSample,
        is PulseEvent.TemperatureSample,
        is PulseEvent.VendorMetric,
        is PulseEvent.ActivityUpdate,
        is PulseEvent.ActivityBucket,
        is PulseEvent.SleepTimeline -> true
        else -> false
    }

    /**
     * Write a measurement the ring can re-supply — unless the user deleted it (issue #60).
     *
     * Every caller here uses a deterministic `history:<kind>:<timestamp>` id so that re-syncing a
     * day the ring still holds updates the same row instead of duplicating it. That idempotence is
     * exactly what would undo a deletion, so the tombstone is checked on the way in. A reading with
     * no tombstone is written as before.
     */
    private suspend fun upsertUnlessDeleted(measurement: MeasurementEntity): Boolean {
        if (batchDeletedIds?.contains(measurement.id) ?: db.measurementDeletionDao().isDeleted(measurement.id)) return false
        // The same reading deleted from the other side. A spot reading the user removed before the
        // ring's copy of it arrived has no `history:` tombstone to find — its row was a UUID — so
        // without this the ring's copy is written under an id nothing suppresses and the reading
        // comes back, needing a second delete. Only kinds `adoptRingsCopy` reconciles can produce
        // such a tombstone, so no other write pays for the lookup.
        if (measurement.kindRaw in SPOT_RECONCILED_KINDS &&
            (batchSpotWindows?.any { it.kindRaw == measurement.kindRaw && kotlin.math.abs(it.timestamp - measurement.timestamp) <= SPOT_MATCH_MS } ?: db.measurementDeletionDao().isSpotDeleted(
                measurement.kindRaw,
                measurement.timestamp - SPOT_MATCH_MS,
                measurement.timestamp + SPOT_MATCH_MS,
            ))
        ) return false
        db.measurementDao().upsert(measurement)
        return true
    }

    /**
     * A live reading of [kind]: the ring's stream, or a spot measurement's settled value.
     *
     * [awaitingRingsCopy] marks the second case *on a ring that logs its own spot measurements*,
     * so a later history sync can recognise the ring's copy and replace ours ([adoptRingsCopy]).
     * A spot reading from a ring that does not log one is stored exactly as before — a plain live
     * row, with no pending reconciliation and nothing that could delete it.
     */
    private suspend fun storeLiveReading(
        kind: MeasurementKind,
        value: Double,
        unit: String,
        at: Long,
        awaitingRingsCopy: Boolean,
        cadenceS: Int? = null,
        workoutSessionId: String? = null,
    ) {
        db.measurementDao().insert(MeasurementEntity(
            kindRaw = kind.name, value = value, unit = unit, timestamp = at,
            sourceRaw = if (awaitingRingsCopy) SOURCE_SPOT else "live",
            activitySessionId = workoutSessionId,
            cadenceS = cadenceS,
        ))
        if (awaitingRingsCopy) spotReadingsOf(kind).add(at)
    }

    private suspend fun spotReadingsOf(kind: MeasurementKind): MutableList<Long> =
        spotReadings.getOrPut(kind) {
            db.measurementDao().timestampsBySource(kind.name, SOURCE_SPOT, System.currentTimeMillis() - SPOT_LOOKBACK_MS)
                .toMutableList()
        }

    /**
     * The ring's copy of a spot reading replaces ours (issue #60, confirmed on RC-2).
     *
     * The YCBT ring logs every spot measurement into its own history — verified by reading five
     * SpO₂ runs back out of the ring's memory at the exact times they were taken — and the vendor
     * app's whole reaction to a `04 0e` success is to re-sync that history: the ring decides the
     * number, the app re-reads it. So when a history sample of the same kind lands within
     * [SPOT_MATCH_MS] of a reading we stored for our own settled value, it is that measurement
     * seen from the ring's side, and keeping both is the doubled row the tester saw. The ring's
     * row wins because it is the one that regenerates on every sync (and so the one a tombstone
     * can hold down); ours is deleted outright.
     *
     * **Only rings that actually log spot readings take part.** A row is marked [SOURCE_SPOT] at
     * write time only when the ring reported its own completion, so this can never fire on a CRP
     * or Colmi ring — where the nearest history sample is an unrelated point on the five-minute
     * all-day grid and would land inside [SPOT_MATCH_MS] of most measurements.
     */
    private suspend fun adoptRingsCopy(kind: MeasurementKind, historyAt: Long) {
        if (kind != MeasurementKind.HEART_RATE && kind != MeasurementKind.SPO2) return
        val ours = spotReadingsOf(kind)
        if (ours.isEmpty()) return
        val matched = spotReadingsMatching(ours, historyAt)
        if (matched.isEmpty()) return
        db.measurementDao().deleteBySourceBetween(kind.name, SOURCE_SPOT, historyAt - SPOT_MATCH_MS, historyAt + SPOT_MATCH_MS)
        ours.removeAll(matched)
    }

    private suspend fun persistUnsafe(event: PulseEvent): Boolean {
        var persistedForBroadcast = false
        when (event) {
            // A start/end verdict for one spot measurement (issue #59) — a control signal for the
            // coordinator's poll loop, carrying no value of its own. Nothing to store.
            is PulseEvent.MeasurementComplete -> persistedForBroadcast = true
            is PulseEvent.DeviceStateChanged -> {
                // Never resurrect a forgotten ring: after Forget / Factory Reset clears the
                // device row, the ring's own teardown still emits a late DISCONNECTED — only
                // a connection-establishing event may create a fresh row.
                // currentReal() (not current()) so a seeded demo-device row can never absorb a
                // real ring's identity — the ring gets its own row instead.
                val existing = db.deviceDao().currentReal()
                if (existing == null &&
                    event.state != RingConnectionState.CONNECTED &&
                    event.state != RingConnectionState.CONNECTING) return false
                val device = existing ?: DeviceEntity()
                val state = when (event.state) {
                    RingConnectionState.CONNECTED -> {
                        // Connecting deletes NOTHING — not stored history, not demo rows. Demo
                        // data is retired only from Settings → Privacy & Data, matching iOS, which
                        // has no connect-time purge at all and instead *detects* seeded rows
                        // (`isDemo`, `source == "mock"`, `DataFreshness.demo`) and adapts the UI.
                        // Demo data coexisting with a paired ring is an expected state, not a mess
                        // to clean up.
                        //
                        // The `when` below is the guard, and it is exhaustive on purpose — see
                        // [ConnectPurge]. It reads as dead code and is not: it is what makes
                        // re-introducing a connect-time delete a compile error rather than a
                        // one-line edit.
                        //
                        // History, because this keeps getting re-added: connect used to clear *all*
                        // sleep for every family except YCBT and rebuild it from the ring. No ring
                        // re-supplies more than its own buffer, and the two smallest re-supply a
                        // single day — CRP sends `queryHistorySleep(daysAgo=0)`, jring
                        // `makeHistoryQueryCommand()` with its 1-day default (JringDriver.kt:105,
                        // NOT `syncWindowDays`, which only sizes the progress bar) — so every
                        // connect destroyed each night older than that, and a new night replaced
                        // the last one instead of joining it (issue #43, zaggash's R11). The
                        // rebuild was never load-bearing: [upsertSleepSessionAtomic] reconciles one
                        // waking day at a time, idempotently, and re-points legacy mis-keyed blocks
                        // itself — which was the blanket clear's stated reason for existing. The
                        // demo purge was the last surviving fragment of that same model.
                        when (connectPurge(event.deviceType)) {
                            ConnectPurge.NOTHING -> {}
                        }
                        "CONNECTED"
                    }
                    RingConnectionState.DISCONNECTED -> "DISCONNECTED"
                    RingConnectionState.CONNECTING -> "CONNECTING"
                    RingConnectionState.SCANNING -> "SCANNING"
                    RingConnectionState.RECONNECTING -> "RECONNECTING"
                    RingConnectionState.FAILED -> "FAILED"
                    else -> "IDLE"
                }
                db.deviceDao().upsert(device.copy(
                    stateRaw = state,
                    // Capture the connected ring's advertised name so the UI reflects the actual
                    // device instead of the DeviceEntity default. Falls back to the existing name
                    // for events that don't carry one (e.g. disconnect).
                    name = event.name?.takeIf { it.isNotBlank() } ?: device.name,
                    advertisedName = event.name?.takeIf { it.isNotBlank() } ?: device.advertisedName,
                    bleAddressHint = event.address ?: device.bleAddressHint,
                    // 0x0C device-info already gives the complete "<CID><DID>V<version>" string.
                    firmwareVersion = event.firmware ?: device.firmwareVersion,
                    lastConnectedAt = if (state == "CONNECTED") System.currentTimeMillis() else device.lastConnectedAt,
                    lastSyncAt = if (state == "CONNECTED") System.currentTimeMillis() else device.lastSyncAt,
                    updatedAt = System.currentTimeMillis(),
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.DeviceIdentified -> {
                val device = db.deviceDao().currentReal() ?: DeviceEntity()
                db.deviceDao().upsert(device.copy(
                    deviceTypeRaw = event.deviceType.name,
                    // A connect that can't resolve the exact model (e.g. re-pair with the
                    // carousel on the wrong family) must not erase a previously stamped one.
                    wearableModelID = event.wearableModelID ?: device.wearableModelID,
                    advertisedName = event.advertisedName ?: device.advertisedName,
                    capabilitiesRaw = event.capabilities.toCsv(),
                    updatedAt = System.currentTimeMillis(),
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.DeviceForgotten -> {
                // This event is queued after all earlier ring events, so deleting here prevents a
                // pre-forget CONNECTED event still in the bus from recreating the cleared row.
                db.deviceDao().currentReal()?.let { db.deviceDao().deleteById(it.id) }
                persistedForBroadcast = true
            }
            is PulseEvent.BatteryLevel -> {
                val device = db.deviceDao().currentReal() ?: DeviceEntity()
                val now = System.currentTimeMillis()
                db.deviceDao().upsert(device.copy(
                    batteryPercent = event.percent,
                    updatedAt = now,
                ))
                recordBatterySample(event.percent, now)
                persistedForBroadcast = true
            }
            is PulseEvent.LiveSampleGate -> {
                if (event.closed) closedGates.add(event.kind) else closedGates.remove(event.kind)
            }
            is PulseEvent.HeartRateSample -> {
                // Manual-result frames are ephemeral inputs to the bounded spot leg. The
                // coordinator publishes the accepted result once with spot=true; storing this
                // frame too would duplicate it, while a late timeout reply would become false data.
                if (event.measurementResult || event.measurementStream) return false
                if (!event.spot && MeasurementKind.HEART_RATE in closedGates) return false
                storeLiveReading(
                    MeasurementKind.HEART_RATE, event.bpm.toDouble(), "bpm",
                    event.timestamp.toEpochMilli(), awaitsRingsCopy(event.spot, event.ringWillLogIt),
                    cadenceS = event.cadenceS, workoutSessionId = event.workoutSessionId,
                )
                persistedForBroadcast = true
            }
            is PulseEvent.Spo2Result -> {
                if (!event.spot && MeasurementKind.SPO2 in closedGates) return false
                storeLiveReading(
                    MeasurementKind.SPO2, event.value.toDouble(), "%",
                    event.timestamp.toEpochMilli(), awaitsRingsCopy(event.spot, event.ringWillLogIt),
                )
                persistedForBroadcast = true
            }
            is PulseEvent.HistoryMeasurement -> {
                val at = event.timestamp.toEpochMilli()
                val rawAt = event.rawTimestamp?.toEpochMilli()
                // Deleted by the user under the ring's raw stamp (before the clock correction moved
                // it): the corrected copy is the same reading and stays deleted.
                if (rawAt != null && db.measurementDeletionDao().isDeleted(historyMeasurementId(event.kind, rawAt))) return false
                removeStaleHistoryCopies(event.kind.name, at, rawAt, event.value)
                val written = upsertUnlessDeleted(MeasurementEntity(
                    id = historyMeasurementId(event.kind, at),
                    kindRaw = event.kind.name,
                    value = event.value, unit = event.kind.unit,
                    timestamp = at,
                    sourceRaw = if (event.provenance == "vendor_history") "vendor_history" else "history",
                    confidenceRaw = if (event.provenance == "vendor_history") "partial" else "known",
                    // A workout stream's verified cadence (A1); all-day history stores none.
                    cadenceS = com.pulseloop.ring.HrProvenance.workoutCadence(event.provenance, event.cadenceS),
                ))
                // A sample the user deleted adopts nothing: it is re-sent on every sync, and
                // letting it retire our spot rows within ±90 s would delete a retaken reading
                // each time the ring re-supplied the one that was already deleted.
                if (written) adoptRingsCopy(event.kind, at)
                persistedForBroadcast = written
            }
            is PulseEvent.StressSample -> {
                val measurement = MeasurementEntity(
                    id = if (event.isHistory) {
                        historyMeasurementId(MeasurementKind.STRESS, event.timestamp.toEpochMilli())
                    } else {
                        java.util.UUID.randomUUID().toString()
                    },
                    kindRaw = MeasurementKind.STRESS.name,
                    value = event.value.toDouble(), unit = "",
                    timestamp = event.timestamp.toEpochMilli(),
                    sourceRaw = "colmi",
                )
                persistedForBroadcast = if (event.isHistory) upsertUnlessDeleted(measurement)
                else {
                    db.measurementDao().insert(measurement)
                    true
                }
            }
            is PulseEvent.HrvSample -> {
                db.measurementDao().insert(MeasurementEntity(
                    kindRaw = MeasurementKind.HRV.name,
                    value = event.value.toDouble(), unit = "ms",
                    timestamp = event.timestamp.toEpochMilli(),
                    sourceRaw = "live",
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.BloodPressureSample -> {
                persistedForBroadcast = if (batchingBuckets) persistBloodPressureAtomic(event)
                else db.withTransaction { persistBloodPressureAtomic(event) }
            }
            is PulseEvent.BloodSugarSample -> {
                db.measurementDao().insert(MeasurementEntity(
                    kindRaw = MeasurementKind.BLOOD_SUGAR.name,
                    value = event.mgdl,
                    unit = MeasurementKind.BLOOD_SUGAR.unit,
                    timestamp = event.timestamp.toEpochMilli(),
                    sourceRaw = "live",
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.TemperatureSample -> {
                val measurement = MeasurementEntity(
                    id = if (event.isHistory) {
                        historyMeasurementId(MeasurementKind.TEMPERATURE, event.timestamp.toEpochMilli())
                    } else {
                        java.util.UUID.randomUUID().toString()
                    },
                    kindRaw = MeasurementKind.TEMPERATURE.name,
                    value = event.celsius, unit = "°C",
                    timestamp = event.timestamp.toEpochMilli(),
                    sourceRaw = "live",
                )
                persistedForBroadcast = if (event.isHistory) upsertUnlessDeleted(measurement)
                else {
                    db.measurementDao().insert(measurement)
                    true
                }
            }
            is PulseEvent.VendorMetric -> {
                val safeKey = event.key.uppercase().replace(Regex("[^A-Z0-9_]+"), "_").trim('_')
                if (safeKey.isBlank() || !event.value.isFinite()) return false
                val at = event.timestamp.toEpochMilli()
                if (event.isHistory) removeStaleHistoryCopies("VENDOR_$safeKey", at, event.rawTimestamp?.toEpochMilli(), event.value)
                db.measurementDao().upsert(MeasurementEntity(
                    id = "vendor:${safeKey.lowercase()}:$at",
                    kindRaw = "VENDOR_$safeKey",
                    value = event.value,
                    unit = event.unit,
                    timestamp = at,
                    sourceRaw = if (event.isHistory) "vendor_history" else "vendor_live",
                    confidenceRaw = "partial",
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.DerivedInsight -> {
                val safeKey = event.key.lowercase().replace(Regex("[^a-z0-9_]+"), "_").trim('_')
                if (safeKey.isBlank() || !event.value.isFinite()) return false
                val payload = JsonObject(linkedMapOf(
                    "value" to JsonPrimitive(event.value),
                    "unit" to JsonPrimitive(event.unit),
                    "confidence" to JsonPrimitive(event.confidence),
                    "algorithm_version" to JsonPrimitive(event.algorithmVersion),
                    "inputs" to JsonObject(event.inputs.toSortedMap().mapValues { JsonPrimitive(it.value) }),
                    "note" to JsonPrimitive(event.note ?: ""),
                )).toString()
                db.derivedUpdateDao().upsert(DerivedUpdateEntity(
                    id = "insight:$safeKey:${event.scopeStart.toEpochMilli()}",
                    timestamp = System.currentTimeMillis(),
                    kind = safeKey,
                    entityType = "local_insight",
                    entityId = event.scopeStart.toString(),
                    payloadJSON = payload,
                ))
                persistedForBroadcast = true
            }
            is PulseEvent.ActivityUpdate -> {
                upsertActivityDaily(
                    event.timestamp.toEpochMilli(),
                    event.steps,
                    event.calories,
                    event.distanceMeters,
                    event.activeMinutes,
                    event.replaceActiveMinutes,
                )
                persistedForBroadcast = true
            }
            is PulseEvent.ActivityBucket -> {
                // Per-slice ring history: upserted by timestamp + the day total recomputed as the
                // sum of distinct buckets, so re-syncs are idempotent (no drift). Routing these
                // through upsertActivityDaily's max() ratchet collapsed a history day's total to
                // its single largest bucket. Calories omitted (unverified ring field).
                applyActivityBucket(
                    event.timestamp.toEpochMilli(), event.steps, event.distanceMeters,
                    event.rawTimestamp?.toEpochMilli(),
                    BucketEvidence(
                        durationS = event.durationS,
                        support = event.support?.wire ?: StepSupport.LEGACY_UNKNOWN.wire,
                        parentTotal = event.parentTotalSteps,
                        parentStart = event.parentRecordStart?.toEpochMilli(),
                        deviceKey = event.deviceKey ?: ringSource()?.deviceKey,
                    ),
                )
                persistedForBroadcast = true
            }
            // GA.3 / GA.8: upload-only facts. Nothing is stored locally beyond the outbox row.
            is PulseEvent.SportTelemetrySample -> persistedForBroadcast = true
            is PulseEvent.HistoryCoverage -> persistedForBroadcast = true
            is PulseEvent.SleepTimeline -> {
                val valid = event.stages.isNotEmpty() && event.stages.size <= MAX_SLEEP_TIMELINE_MINUTES
                if (valid) upsertSleepSession(
                    event.timestamp.toEpochMilli(), event.stages, event.completeSession,
                    event.rawTimestamp?.toEpochMilli(),
                )
                persistedForBroadcast = valid
            }
            is PulseEvent.SyncProgress -> {
                if (event.stage == "done") {
                    val device = db.deviceDao().currentReal()
                    if (device != null) {
                        db.deviceDao().upsert(device.copy(lastFullSyncAt = System.currentTimeMillis()))
                    }
                    reconcileRecentlyFinishedWorkouts()
                    // Baseline learning, calorie estimates, insights and Health Connect enqueue
                    // run after the containing batch commits (see persistBatch).
                }
                persistedForBroadcast = true
            }
            is PulseEvent.HeartRateComplete -> {}
            is PulseEvent.Spo2Complete -> {}
            is PulseEvent.MeasurementRejected -> persistedForBroadcast = true
            is PulseEvent.WearState -> persistedForBroadcast = true
            is PulseEvent.RawPacket -> {
                db.rawPacketDao().insert(RawPacketEntity(
                    directionRaw = event.direction.name,
                    commandId = event.data.getOrNull(0)?.toInt()?.and(0xFF) ?: 0,
                    hexPayload = event.data.joinToString("") { "%02x".format(it) },
                    decodedKind = event.decoded.kind,
                    deviceTypeRaw = event.deviceType?.name,
                    firmwareRevision = event.firmwareRevision,
                ))
                captureSportFrame(event)
                if (++rawPacketInsertCount >= com.pulseloop.data.RawPacketRetention.PRUNE_EVERY) {
                    rawPacketInsertCount = 0
                    if (!captureSettings.rawPacketFullCapture) db.rawPacketDao().prune(
                        System.currentTimeMillis() - com.pulseloop.data.RawPacketRetention.WINDOW_MS,
                    )
                }
            }
            is PulseEvent.ActivitySyncReset -> {}
            is PulseEvent.FirmwareVersion -> {
                // 0xF6 must NOT write the firmware version. The ring streams two distinct 0xF6
                // sub-records — one (sub-byte 0x00) carries the real version (e.g. 138), the
                // other (sub-byte 0x41) carries an unrelated value that decodes to 2704. Because
                // the decoder can't reliably tell them apart and both stream constantly, letting
                // 0xF6 populate a blank field is exactly what produced the bogus "V2704".
                // The authoritative version comes from 0x0C device-info (see decodeStatus) and is
                // requested on every connect via runStartup(), with DIS 0x2A26 as a fallback, so
                // 0xF6 is never needed here. Kept as a decoded event purely for diagnostics.
            }
            is PulseEvent.FirmwareRevision -> {
                // Stamp the version onto an existing row only — never create one, so a late reply
                // can't resurrect a forgotten ring (same rule as DeviceStateChanged above).
                //
                // The firmware string also does NOT travel as DeviceStateChanged: that event means
                // the *connection state* changed, which a device-info reply doesn't, and
                // CRPSyncEngine.runStartup re-queries firmware on every pass — including the
                // ~30-minute background sync — so it would restate CONNECTED all session long.
                val device = db.deviceDao().currentReal() ?: return false
                if (event.version == device.firmwareVersion) return false  // blank is gated in the bridge
                db.deviceDao().upsert(device.copy(
                    firmwareVersion = event.version,
                    updatedAt = System.currentTimeMillis(),
                ))
                persistedForBroadcast = true
            }
        }
        return persistedForBroadcast
    }

    /**
     * Post-workout vitals backfill (iOS #57e): a ring's own HR/SpO2 log often only reaches the
     * phone on the *next* sync — a reconnect right after finishing, or a delayed history flush —
     * so a session can finish before its window's ring-log samples have landed. Every completed
     * sync re-derives aggregates for sessions that finished within [ActivityAggregates.backfillWindowMillis],
     * picking up whatever now sits in `[startedAt, endedAt]`. [ActivityAggregates.recompute] never
     * touches [ActivityRollup] (minutes/distance credited once at finish), so re-running it here is
     * idempotent and safe to call on every sync, not just the first one after finish.
     */
    private suspend fun reconcileRecentlyFinishedWorkouts() {
        val cutoff = System.currentTimeMillis() - ActivityAggregates.backfillWindowMillis
        for (session in db.activitySessionDao().finishedSince(cutoff)) {
            db.activitySessionDao().upsert(ActivityAggregates.recompute(db, session))
        }
    }

    /** Throttled battery-history write (iOS #61b): only on change or a 30-min floor. */
    private suspend fun recordBatterySample(percent: Int, now: Long) {
        if (percent !in 0..100) return
        val changed = percent != lastBatteryPercent
        val elapsed = lastBatteryLogAt?.let { now - it } ?: Long.MAX_VALUE
        if (!changed && elapsed < batteryMinIntervalMs) return
        lastBatteryPercent = percent
        lastBatteryLogAt = now
        db.batterySampleDao().insert(BatterySampleEntity(percent = percent, timestamp = now))
    }

    private suspend fun upsertActivityDaily(
        ts: Long,
        steps: Int,
        calories: Double,
        distanceM: Double,
        activeMinutes: Int? = null,
        replaceActiveMinutes: Boolean = false,
    ) {
        // Key the daily row by local midnight so it matches the Today dashboard and
        // MetricsService/notifications, which all read per-day rows by local-day boundary.
        val dayStart = com.pulseloop.util.TimeUtil.startOfDayLocal(ts)
        changedActivityDays += dayStart
        val existing = db.activityDailyDao().byDay(dayStart)
        val bucketSteps = db.activityBucketDao().totals(dayStart).steps
        if (existing != null) {
            // Normally keep the running daily max (steps only climb through the day). But if the
            // stored total is implausibly high — e.g. a value locked in by the old little-endian
            // live-activity decode before this fix — overwrite it so the day self-heals instead
            // of staying stuck at a garbage number until midnight.
            val stale = existing.steps > ActivityDayTotal.IMPLAUSIBLE_STEPS
            val device = ActivityDayTotal.ratchetDevice(if (stale) null else existing.deviceSteps, steps)
            db.activityDailyDao().upsert(existing.copy(
                deviceSteps = device,
                steps = ActivityDayTotal.steps(device, bucketSteps),
                calories = if (stale) calories else maxOf(existing.calories, calories),
                distanceMeters = if (stale) distanceM else maxOf(existing.distanceMeters, distanceM),
                activeMinutes = when {
                    replaceActiveMinutes && activeMinutes != null -> activeMinutes
                    stale -> activeMinutes ?: 0
                    else -> maxOf(existing.activeMinutes, activeMinutes ?: 0)
                },
                updatedAt = System.currentTimeMillis(),
            ))
        } else {
            db.activityDailyDao().upsert(ActivityDailyEntity(
                date = dayStart, steps = ActivityDayTotal.steps(steps, bucketSteps), calories = calories,
                distanceMeters = distanceM, activeMinutes = activeMinutes ?: 0, source = "ring",
                deviceSteps = steps,
            ))
        }
    }

    /**
     * Persist one intraday activity bucket from ring history (a Colmi `0x43` sample) and recompute
     * its day's total. The bucket is **upserted by its start time**, so re-syncing the same bucket
     * *replaces* it (never accumulates), and the day's `activity_daily` row is recomputed as the
     * **sum of distinct buckets** for that day. Mirrors `ActivityService.applyActivityBucket` on
     * iOS (the GadgetBridge model). Calories intentionally untouched (unverified ring field).
     */
    /** SPEC GA.1 columns of one `activity_buckets` row. */
    private data class BucketEvidence(
        val durationS: Int? = null,
        val support: String = StepSupport.LEGACY_UNKNOWN.wire,
        val parentTotal: Int? = null,
        val parentStart: Long? = null,
        val deviceKey: String? = null,
    )

    /**
     * GA.3: keep every inbound J-Style `0x18` frame for [JStyle2301Flags.SPORT_FRAME_CAPTURE_DAYS]
     * days, so the unverified cumulative-counter decoder can get golden bytes from real captures.
     * Raw SQL because the capture has no reader DAO yet; pruned on every insert.
     */
    private fun captureSportFrame(event: PulseEvent.RawPacket) {
        if (event.direction != PacketDirection.INCOMING || event.deviceType != RingDeviceType.JSTYLE_2301) return
        if (event.data.firstOrNull()?.toInt()?.and(0xFF) != JStyle2301Protocol.SPORT_TELEMETRY) return
        val now = nowOverride?.invoke() ?: System.currentTimeMillis()
        val sql = db.openHelper.writableDatabase
        sql.execSQL(
            "INSERT INTO ring_sport_frames (receivedAt, hexPayload, firmwareRevision) VALUES (?, ?, ?)",
            arrayOf<Any?>(now, event.data.joinToString("") { "%02x".format(it) }, event.firmwareRevision),
        )
        sql.execSQL(
            "DELETE FROM ring_sport_frames WHERE receivedAt < ?",
            arrayOf<Any?>(now - JStyle2301Flags.SPORT_FRAME_CAPTURE_DAYS * 86_400_000L),
        )
    }

    private suspend fun applyActivityBucket(
        ts: Long, steps: Int, distanceM: Double, rawTs: Long? = null, evidence: BucketEvidence = BucketEvidence(),
    ) {
        if (batchingBuckets) applyActivityBucketAtomic(ts, steps, distanceM, rawTs, evidence)
        else db.withTransaction { applyActivityBucketAtomic(ts, steps, distanceM, rawTs, evidence) }
    }

    private suspend fun applyActivityBucketAtomic(
        ts: Long, steps: Int, distanceM: Double, rawTs: Long?, evidence: BucketEvidence,
    ) {
        val dayStart = com.pulseloop.util.TimeUtil.startOfDayLocal(ts)
        // One ring record, one row. Remove the other copies of this bucket before writing it: the
        // one an older app stored at the ring's raw stamp before the clock correction moved it
        // ([rawTs]), and any stored a fraction of a second off by 2.7.3's per-connection noise
        // shifts. Their days are re-summed and the server is told to drop the same rows.
        val stale = staleBucketCopies(ts, rawTs)
        if (stale.isNotEmpty()) {
            db.activityBucketDao().deleteAt(stale.map { it.startEpoch })
            for (day in stale.map { it.date }.toSet() - dayStart) {
                if (batchingBuckets) pendingBucketDays += day else rollupActivityDay(day)
            }
            queueHubBucketDeletions(stale.map { it.startEpoch })
        }
        db.activityBucketDao().upsert(ActivityBucketEntity(
            startEpoch = ts,
            date = dayStart,
            steps = steps,
            distanceMeters = distanceM,
            durationS = evidence.durationS,
            support = evidence.support,
            parentTotal = evidence.parentTotal,
            parentStart = evidence.parentStart,
            deviceKey = evidence.deviceKey,
        ))
        afterAtomicWriteOverride?.invoke("activity_bucket")

        if (batchingBuckets) pendingBucketDays += dayStart else rollupActivityDay(dayStart)
    }

    private suspend fun staleBucketCopies(ts: Long, rawTs: Long?): List<ActivityBucketEntity> {
        val dao = db.activityBucketDao()
        val tolerance = com.pulseloop.data.ClockDuplicates.SAME_RECORD_MS
        val near = dao.startingBetween(ts - tolerance, ts + tolerance)
        val raw = rawTs?.takeIf { it != ts }?.let { dao.startingBetween(it, it) }.orEmpty()
        return (near + raw)
            .filter { it.startEpoch != ts && it.source !in setOf("demo", "mock") }
            .distinctBy { it.startEpoch }
    }

    private suspend fun queueHubBucketDeletions(starts: List<Long>) {
        queueHubDeletions(starts.map { Triple(HubEventMapper.BUCKET_CATEGORY, HubEventMapper.BUCKET_KIND, it) })
    }

    /**
     * Server deletions of stored rows removed here, exact instants per upload category. They go
     * through [com.pulseloop.hub.HubPendingDeletions] (coalesced into ranges where nothing that
     * stays lies between them, and paced), never straight into the outbox one per sample (0.6.3).
     */
    private suspend fun queueHubDeletions(targets: List<Triple<String, String?, Long>>) {
        if (targets.isEmpty() || hubInstallationId() == null) return
        if (com.pulseloop.hub.HubPendingDeletions.record(db, targets) > 0) hubDeletionsQueued = true
    }

    private fun hubInstallationId(): String? =
        if (hubInstallationIdOverride != null) hubInstallationIdOverride.invoke() else HubSync.pairedInstallationId()

    /**
     * The other stored copies of one ring-history reading ([com.pulseloop.data.ClockDuplicates]):
     * the one an older version kept at the ring's raw stamp [rawAt], and any under a second away
     * with the same value (2.7.3's per-connection noise shifts). Deleted before the reading is
     * written, and dropped on the server too.
     */
    private suspend fun removeStaleHistoryCopies(kindRaw: String, at: Long, rawAt: Long?, value: Double) {
        val dao = db.measurementDao()
        val tolerance = com.pulseloop.data.ClockDuplicates.SAME_RECORD_MS
        val near = dao.historyBetween(kindRaw, at - tolerance, at + tolerance).filter { it.timestamp != at && it.value == value }
        val raw = rawAt?.takeIf { it != at }?.let { dao.historyBetween(kindRaw, it, it) }.orEmpty()
        val stale = (near + raw).distinctBy { it.id }
        if (stale.isEmpty()) return
        dao.deleteByIds(stale.map { it.id })
        queueHubDeletions(stale.flatMap { row -> HubEventMapper.categoriesFor(row.kindRaw).map { (c, k) -> Triple(c, k, row.timestamp) } })
    }

    private suspend fun flushBucketRollups() {
        pendingBucketDays.toList().forEach { rollupActivityDay(it) }
        pendingBucketDays.clear()
    }

    private suspend fun rollupActivityDay(dayStart: Long) {
        changedActivityDays += dayStart
        val totals = db.activityBucketDao().totals(dayStart)
        val totalSteps = totals.steps
        val totalDistance = totals.distanceMeters

        val existing = db.activityDailyDao().byDay(dayStart)
        // Steps: [ActivityDayTotal] — the device's own day count or the distinct buckets, never the
        // stored total itself (a ratchet against it kept 2.7.3's doubled count for good).
        // Distance: a past day's truth is the sum of its distinct buckets (now true 15-minute slices —
        // see ColmiDecoder.decodeActivityHistory). For TODAY the live 0x0C cumulative total
        // leads the bucket history (the in-progress slice isn't served yet), so ratchet
        // against the existing row instead of overwriting — otherwise every reconnect visibly
        // drops today's count until the next live update. Keep the stale-garbage escape from
        // the live path.
        val isToday = dayStart == com.pulseloop.util.TimeUtil.startOfTodayLocal()
        val stale = existing != null && existing.steps > ActivityDayTotal.IMPLAUSIBLE_STEPS
        val ratchet = isToday && existing != null && !stale
        db.activityDailyDao().upsert(
            (existing ?: ActivityDailyEntity(date = dayStart, source = "ring_history")).copy(
                steps = ActivityDayTotal.steps(if (stale) null else existing?.deviceSteps, totalSteps),
                deviceSteps = if (stale) null else existing?.deviceSteps,
                distanceMeters = if (ratchet) maxOf(existing!!.distanceMeters, totalDistance) else totalDistance,
                source = if (ratchet) existing!!.source else "ring_history",
                syncedAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    private suspend fun upsertSleepSession(ts: Long, stages: List<SleepStage>, completeSession: Boolean, rawTs: Long? = null) {
        if (stages.isEmpty() || stages.size > MAX_SLEEP_TIMELINE_MINUTES) return
        if (batchingBuckets) upsertSleepSessionAtomic(ts, stages, completeSession, rawTs)
        else db.withTransaction { upsertSleepSessionAtomic(ts, stages, completeSession, rawTs) }
    }

    private suspend fun upsertSleepSessionAtomic(ts: Long, stages: List<SleepStage>, completeSession: Boolean, rawTs: Long? = null) {
        // Group packets by the waking-day boundary (sleep from 7 PM rolls to the next morning) so
        // a night that starts before midnight lands under the morning of waking instead of being
        // split into two sessions at midnight. Matches the iOS reference
        // (PulseEventBus.persistSleepTimeline + Calendar.wakingDay(forSleepStart:)).
        val dayStart = com.pulseloop.util.TimeUtil.wakingDayLocal(ts)
        val packetEnd = ts + stages.size * 60_000L
        // Include legacy rows keyed to the wrong day if they overlap this packet. Reconciliation
        // re-points their surviving blocks to the correct waking day.
        val overlapping = db.sleepSessionDao().ringOverlapping(ts, packetEnd)
        val existing = (db.sleepSessionDao().ringAllByDay(dayStart) + overlapping).distinctBy { it.id }
        val existingBlocks =
            if (existing.isEmpty()) emptyList()
            else db.sleepStageBlockDao().forSessions(existing.map { it.id })

        // YCBT complete records are authoritative for the ring session they describe, including
        // shortened revisions. Packet-based families replace only the packet interval. In both
        // cases the unaffected blocks remain available for SleepSegmentation to preserve
        // separate naps — and, for a complete record, the *other* ring sessions of the same night
        // (issue #63): see [completeSessionSurvivors] for why "the session it describes" is a
        // contiguous run of blocks and not every block of every row the packet touches.
        val replacements = buildStageBlocks("", ts, stages)
        val replaced = replaceOverlappingSleepBlocks(
            existing = if (completeSession) {
                completeSessionSurvivors(existingBlocks, ts, packetEnd)
            } else {
                existingBlocks
            },
            replacements = replacements,
            replacementStart = ts,
            replacementEnd = packetEnd,
        ).filter { it.durationMinutes > 0 }
        // A packet the clock correction moved: its raw copy, if an older version stored it, now
        // survives only past this packet's end. Cut it, and tell the server to drop the raw event.
        val dayBlocks = if (rawTs == null || completeSession) replaced
            else ClockShiftSleep.trimAfterCorrectedPacket(replaced, packetEnd, rawTs + stages.size * 60_000L)
        if (rawTs != null && dayBlocks.sumOf { it.durationMinutes } != replaced.sumOf { it.durationMinutes }) {
            queueHubDeletions(listOf(Triple(HubEventMapper.SLEEP_CATEGORY, HubEventMapper.SLEEP_KIND, rawTs)))
        }

        reconcileWakingDayAtomic(dayStart, existing, dayBlocks)
    }

    /**
     * Re-derive one waking day's sessions from its raw stage blocks: split by [SleepSegmentation],
     * then reconcile the Room rows — match each segment to the existing session whose prior
     * time-range overlaps it (so identity is stable even when a nap syncs before the night it
     * precedes), insert rows for unmatched segments, delete leftover empty rows, re-point every
     * block to its segment, and recompute bounds/score. Idempotent.
     *
     * Ported from iOS `SleepService.reconcileWakingDay`. Unlike iOS this emits no DerivedUpdateRow
     * change signal: Room's reactive Flows (SleepViewModel observes `recentFlow`) already refresh
     * the UI on any sleep-table write.
     *
     * This function's idempotence is now what protects stored history. Connecting no longer clears
     * the sleep tables (issue #43), so a re-synced day arrives on top of rows that are already
     * there and has to reconcile with them rather than repopulate an emptied table.
     *
     * Its caller owns one transaction: the body below deletes every existing row's blocks up front, then
     * re-upserts sessions and re-inserts blocks per segment one write at a time. Without a
     * transaction, each per-segment session upsert fires `recentFlow` mid-reconcile, and
     * SleepViewModel re-reads blocks for a session that's only partially rewritten — the sleep
     * architecture chart transiently renders with just the first few (chronologically-earliest)
     * blocks before the rest land. The caller's transaction defers the Flow's invalidation until commit,
     * so observers only ever see the fully-reconciled state (matches DemoDataSeeder's usage).
     */
    private suspend fun reconcileWakingDayAtomic(
        dayStart: Long,
        existing: List<SleepSessionEntity>,
        dayBlocks: List<SleepStageBlockEntity>,
    ) {
        val groups = SleepSegmentation.segment(dayBlocks)

        // No blocks left on this day — drop the empty rows entirely (their blocks cascade).
        if (groups.isEmpty()) {
            existing.forEach { db.sleepSessionDao().deleteById(it.id) }
            return
        }

        data class Segment(val blocks: List<SleepStageBlockEntity>, val start: Long, val end: Long)
        val segments = groups.map { g ->
            val sorted = g.sortedBy { it.startAt }
            val start = sorted.first().startAt
            val end = sorted.maxOf { it.startAt + it.durationMinutes * 60_000L }
            Segment(sorted, start, end)
        }

        fun overlap(a0: Long, a1: Long, b0: Long, b1: Long): Long =
            maxOf(0L, minOf(a1, b1) - maxOf(a0, b0))

        // Greedily match each segment to the best-overlapping unused row; a row also matches when it
        // contains the segment's start (covers a freshly-created zero-length container row). The
        // rows' pre-mutation bounds are the match key — `existing` is read before any write below.
        val available = existing.toMutableList()
        val matched: List<Pair<Segment, SleepSessionEntity?>> = segments.map { seg ->
            val best = available.maxByOrNull { overlap(seg.start, seg.end, it.startAt, it.endAt) }
            if (best != null && (overlap(seg.start, seg.end, best.startAt, best.endAt) > 0L ||
                    best.startAt in seg.start..seg.end)) {
                available.remove(best)
                seg to best
            } else {
                seg to null
            }
        }

        // Clear every existing row's blocks up front so re-pointing a block between sessions can't
        // leave a transient duplicate keyed to two sessions at once.
        existing.forEach { db.sleepStageBlockDao().deleteBySession(it.id) }

        val now = System.currentTimeMillis()
        for ((seg, row) in matched) {
            val id = row?.id ?: "sleep-$dayStart-${seg.start}"
            val totalMin = asleepMinutes(seg.blocks)
            // A score is persisted only when the complete stage vocabulary is known. For an
            // authenticated but not-yet-mapped firmware (such as V0789), UNKNOWN blocks still
            // contribute to duration but must not be turned into a fabricated low score.
            val score = SleepScore.calculateIfUsable(
                SleepSessionEntity(
                    id = row?.id ?: id, date = dayStart, startAt = seg.start, endAt = seg.end,
                    totalMinutes = totalMin,
                ),
                seg.blocks,
            )?.score

            // Parent session BEFORE its blocks (FK sleep_stage_blocks -> sleep_sessions.id).
            db.sleepSessionDao().upsert(
                (row ?: SleepSessionEntity(
                    id = id, date = dayStart, startAt = seg.start, endAt = seg.end,
                    totalMinutes = totalMin, score = score,
                )).copy(
                    date = dayStart,
                    startAt = seg.start,
                    endAt = seg.end,
                    totalMinutes = totalMin,
                    score = score,
                    syncedAt = now,
                    updatedAt = now,
                )
            )
            seg.blocks.forEach {
                db.sleepStageBlockDao().insert(
                    it.copy(
                        id = java.util.UUID.randomUUID().toString(),
                        sessionId = id,
                        startMinute = ((it.startAt - seg.start) / 60_000L).toInt().coerceAtLeast(0),
                    )
                )
            }
        }

        // Rows not matched to any segment had all their blocks re-pointed away — delete them.
        available.forEach { db.sleepSessionDao().deleteById(it.id) }
    }

    private suspend fun persistBloodPressureAtomic(event: PulseEvent.BloodPressureSample): Boolean {
        val at = event.timestamp.toEpochMilli()
        val systolic = MeasurementEntity(
            id = if (event.isHistory) {
                historyMeasurementId(MeasurementKind.BLOOD_PRESSURE_SYSTOLIC, at)
            } else {
                java.util.UUID.randomUUID().toString()
            },
            kindRaw = MeasurementKind.BLOOD_PRESSURE_SYSTOLIC.name,
            value = event.systolic.toDouble(), unit = "mmHg", timestamp = at,
            sourceRaw = if (event.isHistory) "history" else "live",
        )
        val diastolic = MeasurementEntity(
            id = if (event.isHistory) {
                historyMeasurementId(MeasurementKind.BLOOD_PRESSURE_DIASTOLIC, at)
            } else {
                java.util.UUID.randomUUID().toString()
            },
            kindRaw = MeasurementKind.BLOOD_PRESSURE_DIASTOLIC.name,
            value = event.diastolic.toDouble(), unit = "mmHg", timestamp = at,
            sourceRaw = if (event.isHistory) "history" else "live",
        )
        return if (event.isHistory) {
            val wroteSystolic = upsertUnlessDeleted(systolic)
            afterAtomicWriteOverride?.invoke("blood_pressure_systolic")
            val wroteDiastolic = upsertUnlessDeleted(diastolic)
            wroteSystolic || wroteDiastolic
        } else {
            db.measurementDao().insert(systolic)
            afterAtomicWriteOverride?.invoke("blood_pressure_systolic")
            db.measurementDao().insert(diastolic)
            true
        }
    }

    /**
     * Build SleepStageBlockEntity entries with run-length encoding.
     * Consecutive minutes of the same stage are merged into one block.
     */
    private fun buildStageBlocks(sessionId: String, startTs: Long, stages: List<SleepStage>): List<SleepStageBlockEntity> {
        if (stages.isEmpty()) return emptyList()
        val blocks = mutableListOf<SleepStageBlockEntity>()
        var currentStage = stages[0]
        var blockStart = startTs
        var blockMinute = 0
        var duration = 1

        for (i in 1 until stages.size) {
            val stage = stages[i]
            if (stage == currentStage) {
                duration++
            } else {
                blocks.add(SleepStageBlockEntity(
                    sessionId = sessionId,
                    startAt = blockStart,
                    startMinute = blockMinute,
                    durationMinutes = duration,
                    stageRaw = currentStage.name,
                ))
                currentStage = stage
                blockStart = startTs + i * 60_000L
                blockMinute = i
                duration = 1
            }
        }
        // Final block
        blocks.add(SleepStageBlockEntity(
            sessionId = sessionId,
            startAt = blockStart,
            startMinute = blockMinute,
            durationMinutes = duration,
            stageRaw = currentStage.name,
        ))
        return blocks
    }

    // ── Calorie estimation recompute (iOS #98) ───────────────────────────────────

    private suspend fun recomputeCalorieEstimates() {
        val profile = db.userProfileDao().get() ?: return
        val estimator = DailyCalorieEstimator.Profile(
            sex = profile.sex, age = profile.age,
            weightKg = profile.weightKg, heightCm = profile.heightCm,
        )
        for (dayStart in changedActivityDays.toList()) {
            DailyCalorieEstimator.recompute(dayStart, db, estimator)
        }
        changedActivityDays.clear()
    }

    companion object {
        private const val RETRY_INITIAL_MS = 100L
        private const val RETRY_MAX_MS = 5_000L
        internal fun persistenceRetryDelayMillis(failures: Int): Long {
            val shift = failures.coerceIn(0, 6)
            return (RETRY_INITIAL_MS shl shift).coerceAtMost(RETRY_MAX_MS)
        }
        /** `sourceRaw` of a spot measurement's settled reading **on a ring that will also log it
         *  itself** (issue #60) — i.e. a row still awaiting reconciliation with the ring's copy.
         *  Reads alongside `"live"` everywhere a source is filtered; nothing treats the two apart
         *  except [adoptRingsCopy]. */
        const val SOURCE_SPOT = "spot"
        /** How far a ring-history sample may sit from one of our spot readings and still be the
         *  ring's copy of it. The measurement itself runs 35–63 s and the ring stamps its log to
         *  the minute, so 90 s covers a stamp at either end of the run without reaching the ring's
         *  own all-day samples five minutes apart. */
        const val SPOT_MATCH_MS = 90_000L
        /** The kinds [adoptRingsCopy] reconciles, and so the only ones a `spot:` range tombstone
         *  can exist for. Kept as the raw names the measurement rows carry. */
        val SPOT_RECONCILED_KINDS = setOf(MeasurementKind.HEART_RATE.name, MeasurementKind.SPO2.name)
        /** How far back [spotReadings] is primed from the table on first use. */
        const val SPOT_LOOKBACK_MS = 7L * 24 * 60 * 60_000
        private const val MAX_SLEEP_TIMELINE_MINUTES = 24 * 60
    }
}

/**
 * Is this reading one the ring will hand back from its own history, so that the two copies have to
 * be reconciled later ([EventPersistenceSubscriber.adoptRingsCopy])? Both halves are required:
 * a streamed sample is not a spot reading, and a spot reading from a ring that keeps no log of it
 * has no second copy coming. Getting the second half wrong is not cosmetic — on a CRP or Colmi
 * ring the nearest history sample is an unrelated point on the five-minute all-day grid, so the
 * reconciliation would delete readings the user deliberately took (issue #60).
 */
internal fun awaitsRingsCopy(spot: Boolean, ringWillLogIt: Boolean): Boolean = spot && ringWillLogIt

/**
 * Which of our spot readings ([ours], epoch millis) a ring-history sample stamped [historyAt] is
 * the ring's own copy of — the pure half of [EventPersistenceSubscriber.adoptRingsCopy]
 * (issue #60): within [window] either side, and nothing else.
 */
internal fun spotReadingsMatching(
    ours: List<Long>,
    historyAt: Long,
    window: Long = EventPersistenceSubscriber.SPOT_MATCH_MS,
): List<Long> = ours.filter { kotlin.math.abs(it - historyAt) <= window }

internal fun historyMeasurementId(kind: MeasurementKind, timestamp: Long): String =
    "history:${kind.key}:$timestamp"

/**
 * True when a `DeviceStateChanged(CONNECTED, …)` is a real connection transition rather than a
 * mid-session re-assertion.
 *
 * **No production caller.** It gated the connect-time demo purge; with that purge gone a connect
 * does nothing worth gating, so this is currently exercised only by `EventPersistenceIdentityTest`.
 * It is kept because the distinction it draws is real, non-obvious, and re-derived wrongly every
 * time someone needs it — any future connect-time action wants exactly this gate.
 *
 * Exactly two things publish a CONNECTED event, and `deviceType` separates them cleanly:
 *  - `RingBLEClient`'s own connect always passes `deviceType = activeCoordinator.deviceType`, which
 *    is non-null by then (`installDriver` ran before the CCCD write that gates CONNECTED).
 *  - `RingEventBridge` maps every decoder's `RingDecodedEvent.Status` to CONNECTED and never sets
 *    `deviceType`. Those are ordinary device-info replies — jring `0x0C`, LuckRing dev-info, YCBT
 *    status packets — re-sent by `runStartup` on every sync pass, not connection events.
 *
 * `preservesSleepOnConnect` used to live beside this, carving YCBT out of a clear-and-rebuild that
 * every other family ran on connect. Both the carve-out and the rebuild are gone (issue #43): no
 * ring re-supplies more sleep than its own buffer holds, so "delete everything and ask again"
 * capped stored history at whatever the ring still had — one day, on CRP and jring.
 */
internal fun isConnectTransition(eventDeviceType: RingDeviceType?): Boolean = eventDeviceType != null

/**
 * What a CONNECTED event is allowed to remove: **nothing**.
 *
 * The enum has exactly one member, and that is the point. Connecting must never delete stored
 * history (issue #43) and — since the iOS-parity fix — must not delete demo rows either. Encoding
 * that as a *type* rather than a comment means widening what a connect may delete cannot be done
 * by editing one line: it needs a new member here, which fails to compile against the exhaustive
 * `when`s in [EventPersistenceSubscriber] and in `EventPersistenceIdentityTest`. That is the
 * tripwire the deleted `preservesSleepOnConnect` boolean never had — it made destructive clearing
 * a per-family *option*, and every family took it but one.
 *
 * Its limit, stated plainly so nobody trusts it further than it goes: it forces a compile error
 * only for an author who routes the new deletion through this enum. A bare
 * `db.measurementDao().clearDemo()` dropped straight into the CONNECTED arm still compiles. The
 * type documents and channels the invariant; the tests below it are what actually enforce it.
 *
 * A `DEMO_ROWS` member used to live here. It was the last fragment of the old "connect = clear
 * everything and rebuild from the ring" design, and it fired on every reconnect — measured at
 * roughly one every five minutes on a COLMI R10 — so seeded demo data could not survive alongside
 * a paired ring for more than a few minutes. iOS never had a connect-time purge at all, so this
 * now matches it.
 */
internal enum class ConnectPurge { NOTHING }

/**
 * Always [ConnectPurge.NOTHING].
 *
 * Kept as a function rather than inlined so the guard has one named place to sit, and so the
 * exhaustive `when`s that enforce it have something to switch on. The result does not depend on
 * [eventDeviceType] — nothing is deleted for any family — but the parameter is retained so that a
 * future connect-time action has the device in hand and reaches for [isConnectTransition] rather
 * than firing on decoder status echoes as well as real connects.
 */
@Suppress("UNUSED_PARAMETER")
internal fun connectPurge(eventDeviceType: RingDeviceType?): ConnectPurge = ConnectPurge.NOTHING

internal fun shouldReplaceCompleteSleep(
    existingStart: Long,
    existingMinutes: Int,
    incomingStart: Long,
    incomingMinutes: Int,
): Boolean = existingStart == incomingStart || incomingMinutes > existingMinutes

/**
 * The stored stage blocks a *complete* ring session leaves standing (issue #63).
 *
 * A YCBT ring closes a sleep session when it sees the wearer get up and opens a new one when they
 * settle again, so one night can be two `af fa` records three minutes apart. SleepSegmentation
 * (60-minute gap) rightly merges those into one stored row. The old rule then treated a complete
 * record as authoritative for **every block of every row it overlapped** — so on the next sync
 * pass, when the second record arrived on top of the merged row, it wiped the first record's
 * three hours along with its own stale copy, and the night read 4 h 06 instead of 6 h 08. The
 * vendor app keeps every record as its own session and never lets one displace another.
 *
 * What a complete record *is* authoritative for is the ring session it describes: the blocks its
 * own interval overlaps, and nothing else. Blocks overlapping the interval are dropped here rather
 * than trimmed; the caller's interval replace would only trim them, and a complete record has no
 * use for what it trimmed off.
 *
 * **Abutting blocks are left standing, and that is a correction.** This rule used to grow the run
 * across any block meeting it end-to-start, so a shortened re-send could retire its own stale tail.
 * But a block has no record identity — `sessionId` is the *merged* row, shared by every record of
 * the night — so "my stale tail" and "the neighbouring record" are the same shape seen from the
 * same side, and the rule could not tell them apart. Two records meeting with no gap therefore read
 * as one run and the second wiped the first: on the reporter's ring the records sit 33 seconds
 * apart, which is a coin toss on whether they round to the same minute, and losing that toss costs
 * a whole session. The shortened-re-send case is also much weaker than it was — since a record's
 * timeline is placed against its own declared header bounds, a re-send of the same record produces
 * the same end rather than one that drifted — so the trade is a stale tail surviving until the
 * record is re-sent shorter *again* against a session that could vanish outright. Carrying the
 * originating record's start on each block would allow both, and is the fix if the tail ever
 * actually bites.
 */
internal fun completeSessionSurvivors(
    existing: List<SleepStageBlockEntity>,
    replacementStart: Long,
    replacementEnd: Long,
): List<SleepStageBlockEntity> {
    fun end(block: SleepStageBlockEntity) = block.startAt + block.durationMinutes * 60_000L
    return existing.filterNot { block ->
        block.startAt < replacementEnd && end(block) > replacementStart
    }
}

internal fun replaceOverlappingSleepBlocks(
    existing: List<SleepStageBlockEntity>,
    replacements: List<SleepStageBlockEntity>,
    replacementStart: Long,
    replacementEnd: Long,
): List<SleepStageBlockEntity> {
    val byStart = LinkedHashMap<Long, SleepStageBlockEntity>()
    for (block in existing) {
        val blockEnd = block.startAt + block.durationMinutes * 60_000L
        if (blockEnd <= replacementStart || block.startAt >= replacementEnd) {
            byStart[block.startAt] = block
            continue
        }
        if (block.startAt < replacementStart) {
            byStart[block.startAt] = block.copy(
                durationMinutes = ((replacementStart - block.startAt) / 60_000L).toInt(),
            )
        }
        if (blockEnd > replacementEnd) {
            byStart[replacementEnd] = block.copy(
                id = "${block.id}:$replacementEnd",
                startAt = replacementEnd,
                durationMinutes = ((blockEnd - replacementEnd) / 60_000L).toInt(),
            )
        }
    }

    for (block in replacements) byStart[block.startAt] = block
    return byStart.values.sortedBy { it.startAt }
}

// Extension for Set<WearableCapability> CSV from WearableCapability.kt
private fun Set<WearableCapability>.toCsv(): String =
    WearableCapability.entries.filter { it in this }.joinToString(",") { it.key }
