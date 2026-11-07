package com.pulseloop.hub

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.SystemClock
import androidx.room.withTransaction
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.pulseloop.GaugeHost
import com.pulseloop.broadcasting.BroadcastOutboxDispatcher
import com.pulseloop.data.PulseLoopDatabase
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Process owner for the home-server (OCI hub) upload: the cached pairing, the upload/backfill
 * WorkManager jobs, pairing and unpairing. Independent of MQTT, which stays an optional live feed.
 */
object HubSync {
    private val lock = Any()
    @Volatile private var store: HubSettingsStore? = null
    @Volatile private var appContext: Context? = null

    fun start(context: Context) {
        store(context)
        if (store?.pairing?.value != null) {
            schedulePeriodic(context)
            // (2.8.7, r069 sync) a process start (the app opened, a boot, an OTA update, WorkManager waking it) sends
            // what the last process left queued, instead of waiting for the 15-minute periodic job
            requestUpload(context)
        }
        watchNetwork(context.applicationContext)
    }

    fun store(context: Context): HubSettingsStore {
        store?.let { return it }
        synchronized(lock) {
            store?.let { return it }
            val app = context.applicationContext
            val broadcast = BroadcastOutboxDispatcher.settingsStore(app)
            return HubSettingsStore(app) { broadcast.installationId }.also {
                appContext = app
                store = it
            }
        }
    }

    /**
     * The installation id to stamp on new hub outbox rows, or null when this phone is not paired
     * (nothing is queued then; the first-pair backfill covers the history instead). Rows keep
     * queueing while a re-pair is pending, so nothing recorded in the meantime is lost.
     * Reads only the in-memory cache; null before [start] has run (e.g. in JVM tests).
     */
    fun pairedInstallationId(): String? {
        val current = store ?: return null
        return if (current.pairing.value != null) current.installationId else null
    }

    fun isPaired(context: Context): Boolean = store(context).pairing.value != null

    /**
     * Ask for an upload soon (debounced). Safe to call for every committed batch. (2.8.7, r069 sync) The drain runs in
     * this process ([kicker]) [DEBOUNCE_MS] later; the WorkManager job behind it ([FALLBACK_MS]) only matters when the
     * process dies first, and then finds the queue empty or sends what was left.
     */
    fun requestUpload(context: Context? = appContext) {
        val ctx = context?.applicationContext ?: return
        if (store?.pairing?.value == null) return
        kicker(ctx).request(DEBOUNCE_MS)
        enqueueUpload(ctx, UNIQUE_NOW, ExistingWorkPolicy.KEEP, FALLBACK_MS)
    }

    /** "Upload now" from settings: no debounce (a server Retry-After is still honoured). */
    fun uploadNow(context: Context) {
        if (store(context).pairing.value == null) return
        enqueueUpload(context.applicationContext, UNIQUE_NOW, ExistingWorkPolicy.REPLACE, 0)
    }

    /**
     * (2.8.7, r069 sync) Send now, in this process: Vitals on this phone came to the front (`VitalsLocalProvider`
     * `flush`), or the network came back. A failure streak starts again from the first short wait.
     */
    fun flushNow(context: Context) {
        if (store(context).pairing.value == null) return
        failures = 0
        kicker(context.applicationContext).request(0)
    }

    /** Uploads that failed in a row (this process); sets the next retry's wait ([HubRetryPolicy]). */
    @Volatile private var failures = 0
    @Volatile private var kicker: HubKicker? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun kicker(app: Context): HubKicker {
        kicker?.let { return it }
        synchronized(lock) {
            kicker?.let { return it }
            return HubKicker(
                scope = scope,
                now = SystemClock::elapsedRealtime,
                drain = { if (com.pulseloop.GaugeEngine.isActive(app)) uploader(app).drain() else HubDrainResult.Empty },
                onResult = { onDrained(app, it, fromWorker = false) },
            ).also { kicker = it }
        }
    }

    /**
     * The outcome of a drain, in this process or in [HubUploadWorker]: a failure schedules one capped retry
     * ([UNIQUE_RETRY]). A worker appends it after itself (it may be the retry job, still running); the in-process path
     * keeps a retry already waiting, so a phone offline for hours holds one retry, not a chain of them.
     */
    internal fun onDrained(context: Context, result: HubDrainResult, fromWorker: Boolean) {
        when (result) {
            is HubDrainResult.Success, HubDrainResult.Empty -> failures = 0
            is HubDrainResult.RetryAfter -> scheduleDelayed(context, result.delayMs)
            is HubDrainResult.Retry -> {
                failures += 1
                val policy = if (fromWorker) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP
                enqueueUpload(context.applicationContext, UNIQUE_RETRY, policy, HubRetryPolicy.delayMs(failures))
            }
            HubDrainResult.NotPaired, HubDrainResult.NeedsRepair -> Unit
        }
    }

    @Volatile private var networkWatched = false

    /**
     * (2.8.7, r069 sync) Upload when the phone's network comes back or stops being blocked for Gauge (Doze and app
     * standby block a background app's network; the server saw Gauge silent for 14–123 minutes at a time while the
     * ring kept syncing). Only a nudge: the drain itself decides whether anything is waiting.
     */
    private fun watchNetwork(app: Context) {
        if (networkWatched) return
        networkWatched = true
        val connectivity = app.getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = nudge()
            override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
                if (!blocked) nudge()
            }
            private fun nudge() {
                if (store?.pairing?.value == null) return
                failures = 0
                kicker(app).request(NETWORK_SETTLE_MS)
            }
        }
        runCatching { connectivity.registerDefaultNetworkCallback(callback) }
    }

    /**
     * A server Retry-After or a continuation: run once after [delayMs]. Appends (rather than
     * replaces) because the caller is often the worker running under this very name, and REPLACE
     * would cancel it mid-return.
     */
    internal fun scheduleDelayed(context: Context, delayMs: Long) {
        enqueueUpload(context.applicationContext, UNIQUE_LATER, ExistingWorkPolicy.APPEND_OR_REPLACE, delayMs)
    }

    sealed interface PairOutcome {
        data object Paired : PairOutcome
        data class Failed(val message: String) : PairOutcome
    }

    suspend fun pair(
        context: Context,
        rawUrl: String,
        rawCode: String,
        api: HubApi = OkHttpHubApi(),
    ): PairOutcome {
        HubUrl.validationError(rawUrl)?.let { return PairOutcome.Failed(it) }
        if (!HubPairingCode.isValid(rawCode)) return PairOutcome.Failed("The pairing code is 8 digits.")
        val settings = store(context)
        val url = HubUrl.normalize(rawUrl)
        val result = api.pair(
            serverUrl = url,
            code = HubPairingCode.normalize(rawCode),
            installationId = settings.installationId,
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            appVersion = GaugeHost.versionName(context),
        )
        return when (result) {
            is HubPairResult.Failure -> PairOutcome.Failed(pairErrorMessage(result))
            is HubPairResult.Success -> {
                completePairing(context, settings, url, result.response)
                PairOutcome.Paired
            }
        }
    }

    /**
     * (Vitals 0.7.0) The engine's own pairing: the Vitals device's server credential in, an upload token out
     * (`POST /v1/lumen/pair-device`, no code). The rest is [pair]'s: the same bookkeeping, the same jobs.
     */
    suspend fun pairDevice(
        context: Context,
        rawUrl: String,
        deviceToken: String,
        api: HubApi = OkHttpHubApi(),
    ): PairOutcome {
        HubUrl.validationError(rawUrl)?.let { return PairOutcome.Failed(it) }
        if (deviceToken.isBlank()) return PairOutcome.Failed("Vitals has no server credential yet.")
        val settings = store(context)
        val url = HubUrl.normalize(rawUrl)
        val result = api.pairDevice(
            serverUrl = url,
            deviceToken = deviceToken,
            installationId = settings.installationId,
            deviceName = pairDeviceName(),
            appVersion = GaugeHost.versionName(context),
        )
        return when (result) {
            is HubPairResult.Failure -> PairOutcome.Failed(
                when (result.status) {
                    null -> "Could not reach the server: ${result.message}"
                    401, 403 -> "The server did not accept this phone's Vitals credential."
                    404 -> "This server cannot pair the engine in Vitals yet (404)."
                    else -> "Pairing failed: HTTP ${result.status}${result.message.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()}."
                },
            )
            is HubPairResult.Success -> {
                completePairing(context, settings, url, result.response)
                PairOutcome.Paired
            }
        }
    }

    /** What the server lists this phone's engine as. */
    internal fun pairDeviceName(): String = "Vitals · ${Build.MANUFACTURER} ${Build.MODEL}".trim()

    private suspend fun completePairing(context: Context, settings: HubSettingsStore, url: String, response: HubPairResponse) {
        val previous = settings.pairing.value
        // Same server and person (typically re-pairing after a 401): keep the queue and the
        // backfill position. A different server starts over with the full history.
        val sameTarget = previous != null && previous.serverUrl == url && previous.personId == response.personId
        if (!sameTarget) {
            PulseLoopDatabase.getInstance(context).hubOutboxDao().clear()
            settings.saveBackfillCursor(null, done = false)
            sources(context).forEach(HubUploadSource::reset)
        }
        settings.savePairing(
            HubPairing(
                serverUrl = url,
                token = response.token,
                personId = response.personId,
                serverVersion = response.serverVersion,
                maxBatch = response.maxBatch,
                maxBytes = response.maxBytes,
                pairedAt = System.currentTimeMillis(),
            ),
        )
        schedulePeriodic(context)
        enqueueUpload(context.applicationContext, UNIQUE_NOW, ExistingWorkPolicy.REPLACE, 0)
    }

    /**
     * Unpair: stop every upload job, ask the server to revoke the token (`POST /v1/lumen/unpair`,
     * best effort), then forget the token and drop the queue whatever the server said. Returns
     * whether the server confirmed the revoke; false means the owner may still want to revoke this
     * phone on the server (it was offline, or the server is older).
     */
    suspend fun unpair(context: Context, api: HubApi = OkHttpHubApi()): Boolean {
        val wm = WorkManager.getInstance(context.applicationContext)
        listOf(UNIQUE_NOW, UNIQUE_LATER, UNIQUE_RETRY, UNIQUE_PERIODIC).forEach(wm::cancelUniqueWork)
        val settings = store(context)
        val revoked = revokeOnServer(settings.pairing.value, api)
        settings.clearPairing()
        PulseLoopDatabase.getInstance(context).hubOutboxDao().clear()
        return revoked
    }

    /** The server half of [unpair]; never throws. */
    internal suspend fun revokeOnServer(pairing: HubPairing?, api: HubApi): Boolean {
        if (pairing == null) return false
        return runCatching { api.unpair(pairing.serverUrl, pairing.token).isSuccess }.getOrDefault(false)
    }

    /**
     * Call after "Reset App Data" has emptied every table (the hub outbox included): queue one
     * category `*` deletion so the server hides everything this installation sent before, and mark
     * the backfill finished — there is no history left to send.
     */
    suspend fun onAppDataReset(context: Context) {
        val settings = store(context)
        if (settings.pairing.value == null) return
        val db = PulseLoopDatabase.getInstance(context)
        db.withTransaction { db.hubOutboxDao().enqueue(HubEventMapper.resetAll(settings.installationId, Instant.now())) }
        settings.saveBackfillCursor(null, done = true)
        requestUpload(context)
    }

    /**
     * Nutrition moved to the Vitals app. Once per install, while paired, queue the deletions
     * that hide the nutrition scores older builds uploaded ([HubEventMapper.retiredInsightDeletions]).
     * The stored derived rows stay on the phone; only the server's copies are hidden.
     */
    internal suspend fun retireInsightsOnce(context: Context, db: PulseLoopDatabase, settings: HubSettingsStore) {
        if (settings.pairing.value == null) return
        val prefs = context.applicationContext.getSharedPreferences(RETIRE_PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(RETIRE_NUTRITION_KEY, false)) return
        db.hubOutboxDao().enqueueAll(HubEventMapper.retiredInsightDeletions(settings.installationId, Instant.now()))
        prefs.edit().putBoolean(RETIRE_NUTRITION_KEY, true).apply()
    }

    suspend fun serverStatus(context: Context, api: HubApi = OkHttpHubApi()): Result<HubServerStatus> {
        val pairing = store(context).pairing.value ?: return Result.failure(IllegalStateException("Not paired"))
        return api.status(pairing.serverUrl, pairing.token)
    }

    /**
     * Stored records that are not ring events, each with its own cursor; the uploader asks them
     * to queue what changed before every batch. Add a new category here.
     */
    internal fun sources(context: Context): List<HubUploadSource> {
        val settings = store(context)
        val db = PulseLoopDatabase.getInstance(context)
        val sources = com.pulseloop.data.sources.SourcesDatabase.getInstance(context)
        return listOf(
            HubWorkoutSync(db, settings, PrefsHubSourceCursor(context, HubWorkoutSync.CURSOR_KEY)),
            // Package GB plug-ins: the phone's own step counter and the Health Connect reader.
            HubPhoneStepsSource(
                HubPhoneStepsSource.DaoStore(sources.phoneDao()),
                db.hubOutboxDao(),
                settings,
                PrefsHubSourceCursor(context, HubPhoneStepsSource.RECORDS_CURSOR_KEY),
                PrefsHubSourceCursor(context, HubPhoneStepsSource.ACQUISITION_CURSOR_KEY),
                checkpointCursor = PrefsHubSourceCursor(context, HubPhoneStepsSource.CHECKPOINT_CURSOR_KEY),
            ),
            // Gauge 2.8.3: Activity Recognition transitions and their registration intervals.
            HubActivityRecognitionSource(
                HubActivityRecognitionSource.DaoStore(sources.activityDao()),
                db.hubOutboxDao(),
                settings,
                PrefsHubSourceCursor(context, HubActivityRecognitionSource.TRANSITIONS_CURSOR_KEY),
                PrefsHubSourceCursor(context, HubActivityRecognitionSource.ACQUISITION_CURSOR_KEY),
            ),
            HubHealthConnectSource(
                HubHealthConnectSource.DaoStore(sources.hcDao()),
                db.hubOutboxDao(),
                settings,
                PrefsHubSourceCursor(context, HubHealthConnectSource.CURSOR_KEY),
            ),
        )
    }

    internal fun uploader(context: Context): HubUploader {
        val settings = store(context)
        val db = PulseLoopDatabase.getInstance(context)
        val backfill = HubBackfill(db, settings)
        val sources = sources(context)
        return HubUploader(
            dao = db.hubOutboxDao(),
            settings = settings,
            api = OkHttpHubApi(),
            beforeBatch = {
                retireInsightsOnce(context, db, settings)
                HubPendingDeletions.drain(db, settings.installationId)
                for (source in sources) {
                    try {
                        source.enqueueChanged()
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // One broken source must not stop the queue that is already waiting.
                        android.util.Log.w("HubSync", "Upload source failed: ${e.message}")
                    }
                }
                backfill.fillIfNeeded()
            },
        )
    }

    private fun pairErrorMessage(failure: HubPairResult.Failure): String {
        val detail = failure.message.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()
        return when (failure.status) {
            null -> "Could not reach the server: ${failure.message}"
            400 -> "The server rejected the request$detail."
            401 -> "That code is not right. Check it and try again."
            410 -> "That code has expired or was already used. Ask the server for a new one."
            404 -> "This server does not offer ring pairing yet (404)."
            else -> "Pairing failed: HTTP ${failure.status}$detail."
        }
    }

    private val networkConstraints: Constraints
        get() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    private fun enqueueUpload(context: Context, name: String, policy: ExistingWorkPolicy, delayMs: Long) {
        val request = OneTimeWorkRequestBuilder<HubUploadWorker>()
            .setConstraints(networkConstraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .setInitialDelay(delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(name, policy, request)
    }

    private fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<HubUploadWorker>(15, TimeUnit.MINUTES)
            .setConstraints(networkConstraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    const val UNIQUE_NOW = "lumen-hub-upload"
    const val UNIQUE_LATER = "lumen-hub-upload-later"
    const val UNIQUE_PERIODIC = "lumen-hub-upload-periodic"
    /** (2.8.7) A failed upload's capped retry ([HubRetryPolicy]). */
    const val UNIQUE_RETRY = "lumen-hub-upload-retry"
    private const val DEBOUNCE_MS = 15_000L
    /** The WorkManager job behind an in-process request: runs only if this process is gone by then. */
    private const val FALLBACK_MS = 2 * 60_000L
    /** A network that just came up (or a VPN like Tailscale behind it) gets a moment before the first request. */
    private const val NETWORK_SETTLE_MS = 3_000L
    private const val RETIRE_PREFS = "hub_retired_insights"
    private const val RETIRE_NUTRITION_KEY = "nutrition_score.v1"
    private const val BACKOFF_SECONDS = 30L
}

/** Network-constrained upload pass; also drives the throttled first-pair backfill. */
class HubUploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        HubSync.store(applicationContext)
        // (Vitals 0.7.0) nothing leaves the phone while Gauge is installed or before Vitals has taken over
        if (!com.pulseloop.GaugeEngine.isActive(applicationContext)) return Result.success()
        val result = HubSync.uploader(applicationContext).drain()
        if (result is HubDrainResult.Success && result.hasMore) HubSync.scheduleDelayed(applicationContext, 0)
        // (2.8.7, r069 sync) a failure is retried on HubRetryPolicy's capped wait (30 s doubling to 5 min), never on
        // WorkManager's exponential backoff, which reached hours and held every new request behind it
        HubSync.onDrained(applicationContext, result, fromWorker = true)
        return Result.success()
    }
}
