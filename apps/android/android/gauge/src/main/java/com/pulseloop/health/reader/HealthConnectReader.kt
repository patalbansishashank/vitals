package com.pulseloop.health.reader

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.pulseloop.data.sources.HcRecordEntity
import com.pulseloop.data.sources.HcSourceDao
import com.pulseloop.data.sources.SourcesDatabase
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Reads Health Connect into the sources database for upload as `hc/record` / `hc/deleted`
 * (energy SPEC §GB.2, RESEARCH II.3).
 *
 * - Runs from [HealthConnectReaderWorker] every 15 min, only while the hub is paired and the
 *   background-read permission is granted ([HcCapability]). Where only ordinary reads are granted,
 *   [HcForegroundReader] runs it with `foreground = true` while Gauge is open instead. It never prompts; Health Connect
 *   permissions are asked for only by Gauge's companion-screen checklist.
 * - Per type, only while that type's read permission is granted. Cursor lifecycle:
 *   [HcChangesCursor].
 * - Back-fill depth: DECISION D14 default, one year with the history permission, else 30 days.
 * - Records and the cursor that covers them commit in one Room transaction
 *   ([HcSourceDao.commit]); `hc_records` is this reader's outbox, and the hub plug-in
 *   ([com.pulseloop.hub.HubHealthConnectSource]) queues from it. So a token never advances past a
 *   record that is not durably held.
 * - Excluded: Gauge's own exports ([HcRecordMapper.isOwn]). A deletion becomes `hc/deleted` only for
 *   a record this reader holds; anything else (own exports, records never read) is ignored.
 * - A permission revoked mid-read (`SecurityException`) stops that type where it is; what was
 *   committed stays, nothing advances past the failure, and the next grant resumes.
 * - DECISION D4: Health Connect device-native steps are uploaded as the *alternate* phone lineage
 *   (`origin_is_device_native`); the direct counter is primary. Since Android 14 granting
 *   `READ_STEPS` may itself start the OS step recorder; that is expected and is the same lineage.
 */
class HealthConnectReader(
    private val gateway: HcGateway,
    private val store: HcStore,
    private val nativeOrigins: Set<String>,
    private val now: () -> Instant = Instant::now,
    private val pageSize: Int = 500,
    private val maxPagesPerType: Int = 20,
) {
    /** The Health Connect calls the reader makes; [ClientGateway] in production, a fake in tests. */
    interface HcGateway {
        suspend fun changesToken(type: HcType): String
        suspend fun read(type: HcType, from: Instant, to: Instant, pageToken: String?, pageSize: Int): Page
        suspend fun changes(token: String): Changes
    }

    data class Page(val records: List<HcRecordView>, val nextPageToken: String?)
    data class Changes(
        val upserts: List<HcRecordView>,
        val deletedIds: List<String>,
        val nextToken: String,
        val hasMore: Boolean,
        val tokenExpired: Boolean,
    )

    interface HcStore {
        suspend fun state(): Map<String, String>
        suspend fun existing(keys: List<String>): Map<String, HcRecordEntity>
        /** Atomically: write [rows], replace this type's cursor with [cursor]. */
        suspend fun commit(rows: List<HcRecordEntity>, cursor: HcChangesCursor)
    }

    class DaoStore(private val dao: HcSourceDao) : HcStore {
        override suspend fun state(): Map<String, String> = dao.allState().associate { it.key to it.value }
        override suspend fun existing(keys: List<String>): Map<String, HcRecordEntity> =
            keys.chunked(500).flatMap { dao.records(it) }.associateBy { it.key }
        override suspend fun commit(rows: List<HcRecordEntity>, cursor: HcChangesCursor) =
            dao.commit(rows, cursor.toState(), cursor.allKeys())
    }

    enum class TypeOutcome { CURRENT, MORE_PENDING, NO_PERMISSION, FAILED }

    data class RunResult(val outcomes: Map<HcType, TypeOutcome>, val written: Int)

    /**
     * One pass over every readable type. [foreground] is true only when the caller runs while Gauge
     * is visible ([HcForegroundReader]): then ordinary read grants suffice. A background caller
     * (the worker) needs the background permission, since Health Connect refuses its reads otherwise.
     */
    suspend fun run(capability: HcCapability, foreground: Boolean = false): RunResult {
        val allowed = capability.canReadInBackground || (foreground && capability.canReadInForeground)
        if (!allowed) return RunResult(emptyMap(), 0)
        val state = store.state()
        val outcomes = linkedMapOf<HcType, TypeOutcome>()
        var written = 0
        for (type in capability.readable) {
            var cursor = HcChangesCursor.decode(type, state)
            val outcome = try {
                val result = runType(cursor, capability.historyDays)
                written += result.second
                result.first
            } catch (e: CancellationException) {
                throw e
            } catch (e: SecurityException) {
                Log.w(TAG, "${type.recordType}: permission revoked mid-read; resuming on the next grant")
                TypeOutcome.NO_PERMISSION
            } catch (e: Exception) {
                Log.w(TAG, "${type.recordType}: read failed: ${e.message}")
                TypeOutcome.FAILED
            }
            outcomes[type] = outcome
        }
        return RunResult(outcomes, written)
    }

    private suspend fun runType(start: HcChangesCursor, historyDays: Long): Pair<TypeOutcome, Int> {
        var cursor = start
        var written = 0
        val type = cursor.type
        if (cursor.token == null) {
            // The token comes first, so nothing written during the back-fill can be missed.
            val token = gateway.changesToken(type)
            val at = now()
            cursor = cursor.copy(
                token = token,
                backfillFromMs = at.minus(Duration.ofDays(historyDays)).toEpochMilli(),
                backfillToMs = at.toEpochMilli(),
                pageToken = null,
                backfillDone = false,
            )
            store.commit(emptyList(), cursor)
        }
        var pages = 0
        while (pages < maxPagesPerType) {
            if (!cursor.backfillDone) {
                val page = gateway.read(
                    type,
                    Instant.ofEpochMilli(cursor.backfillFromMs ?: 0L),
                    Instant.ofEpochMilli(cursor.backfillToMs ?: now().toEpochMilli()),
                    cursor.pageToken,
                    pageSize,
                )
                pages++
                val rows = accept(type, page.records, emptyList())
                cursor = cursor.copy(pageToken = page.nextPageToken, backfillDone = page.nextPageToken == null)
                store.commit(rows, cursor)
                written += rows.size
                continue
            }
            val changes = gateway.changes(cursor.token ?: return TypeOutcome.FAILED to written)
            pages++
            if (changes.tokenExpired) {
                val fresh = gateway.changesToken(type)
                val at = now()
                val floor = at.minus(Duration.ofDays(historyDays)).toEpochMilli()
                val from = ((cursor.lastSyncMs ?: cursor.backfillToMs ?: floor) - RESCAN_OVERLAP_MS).coerceAtLeast(floor)
                cursor = cursor.copy(
                    token = fresh,
                    backfillFromMs = from,
                    backfillToMs = at.toEpochMilli(),
                    pageToken = null,
                    backfillDone = false,
                    scope = HcChangesCursor.SCOPE_STALE,
                    staleSinceMs = cursor.staleSinceMs ?: from,
                )
                store.commit(emptyList(), cursor)
                continue
            }
            val rows = accept(type, changes.upserts, changes.deletedIds)
            cursor = cursor.copy(token = changes.nextToken, lastSyncMs = now().toEpochMilli())
            store.commit(rows, cursor)
            written += rows.size
            if (!changes.hasMore) return TypeOutcome.CURRENT to written
        }
        return TypeOutcome.MORE_PENDING to written
    }

    /** The rows to write: new or revised foreign records, and tombstones for records we hold. */
    private suspend fun accept(type: HcType, upserts: List<HcRecordView>, deletedIds: List<String>): List<HcRecordEntity> {
        val candidates = upserts.filter { it.type == type && !HcRecordMapper.isOwn(it) }
        val keys = candidates.map { it.key } + deletedIds.map { HcRecordMapper.key(type, it) }
        if (keys.isEmpty()) return emptyList()
        val existing = store.existing(keys.distinct())
        val at = now().toEpochMilli()
        val out = linkedMapOf<String, HcRecordEntity>()
        for (view in candidates) {
            val held = existing[view.key]
            if (held != null && !held.deleted && held.lastModifiedMs == view.lastModified.toEpochMilli()) continue
            out[view.key] = HcRecordEntity(
                key = view.key,
                recordType = type.recordType,
                hcId = view.id,
                deleted = false,
                lastModifiedMs = view.lastModified.toEpochMilli(),
                startMs = view.start.toEpochMilli(),
                dataJson = HcRecordMapper.data(view, nativeOrigins).toString(),
                readAtMs = at,
            )
        }
        for (id in deletedIds) {
            val key = HcRecordMapper.key(type, id)
            val held = out[key] ?: existing[key] ?: continue // Never seen (or our own export): nothing to retract.
            if (held.deleted) continue
            out[key] = HcRecordEntity(
                key = key,
                recordType = type.recordType,
                hcId = id,
                deleted = true,
                lastModifiedMs = at,
                startMs = held.startMs,
                dataJson = buildJsonObject {
                    put("schema_version", 1)
                    put("observed_at", Instant.ofEpochMilli(at).toString())
                    put("record_type", type.recordType)
                }.toString(),
                readAtMs = at,
            )
        }
        return out.values.toList()
    }

    /** The real Health Connect client. */
    class ClientGateway(private val client: HealthConnectClient) : HcGateway {
        override suspend fun changesToken(type: HcType): String =
            client.getChangesToken(ChangesTokenRequest(setOf(type.recordClass)))

        override suspend fun read(type: HcType, from: Instant, to: Instant, pageToken: String?, pageSize: Int): Page {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = type.recordClass,
                    timeRangeFilter = TimeRangeFilter.between(from, to),
                    ascendingOrder = true,
                    pageSize = pageSize,
                    pageToken = pageToken,
                ),
            )
            return Page(response.records.mapNotNull(HcRecordMapper::view), response.pageToken?.takeIf { it.isNotEmpty() })
        }

        override suspend fun changes(token: String): Changes {
            val response = client.getChanges(token)
            return Changes(
                upserts = response.changes.filterIsInstance<UpsertionChange>().mapNotNull { HcRecordMapper.view(it.record) },
                deletedIds = response.changes.filterIsInstance<DeletionChange>().map { it.recordId },
                nextToken = response.nextChangesToken,
                hasMore = response.hasMore,
                tokenExpired = response.changesTokenExpired,
            )
        }
    }

    companion object {
        private const val TAG = "HealthConnectReader"
        /** (P) The rescan after an expired token overlaps the last good sync by a day. */
        const val RESCAN_OVERLAP_MS = 86_400_000L
    }
}

/** The 15-minute Health Connect read (SPEC §GB.2). */
class HealthConnectReaderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // (Vitals 0.7.0) nothing runs while Gauge is installed or before Vitals has taken over
        if (!com.pulseloop.GaugeEngine.isActive(applicationContext)) return Result.success()
        val app = applicationContext
        // The records exist only to be uploaded; unpaired, there is nowhere for them to go, and the
        // first pass after pairing back-fills the history anyway.
        if (!com.pulseloop.hub.HubSync.isPaired(app)) return Result.success()
        val capability = HcCapability.probe(app)
        if (!capability.canReadInBackground || capability.readable.isEmpty()) return Result.success()
        val reader = HealthConnectReader(
            gateway = HealthConnectReader.ClientGateway(HealthConnectClient.getOrCreate(app)),
            store = HealthConnectReader.DaoStore(SourcesDatabase.getInstance(app).hcDao()),
            nativeOrigins = HcCapability.nativeOrigins(app),
        )
        val result = reader.run(capability)
        if (result.written > 0) com.pulseloop.hub.HubSync.requestUpload(app)
        return Result.success()
    }

    companion object {
        const val UNIQUE = "health_connect_reader"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HealthConnectReaderWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
