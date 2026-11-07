package com.pulseloop.hub

import android.content.Context
import androidx.room.withTransaction
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.service.MetricsProfileValues
import java.time.Instant

/**
 * One table-driven upload source: something stored locally that is not a [com.pulseloop.ring.PulseEvent]
 * and so never passes the live mapper. The uploader asks every source to queue what changed
 * before each batch ([HubSync.uploader]). A new category (for example the phone's own step
 * counter) is one more implementation added to that list.
 */
interface HubUploadSource {
    /** Queue the rows that changed since the last call; returns how many events were queued. */
    suspend fun enqueueChanged(): Int
    /** Forget the position, so the next call re-sends everything (a new server or person). */
    fun reset()
}

/** Where a [HubUploadSource] is up to. Persisted per source; in memory in tests. */
interface HubSourceCursor {
    var value: String?
}

class PrefsHubSourceCursor(context: Context, private val key: String) : HubSourceCursor {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    override var value: String?
        get() = prefs.getString(key, null)
        set(v) { prefs.edit().apply { if (v == null) remove(key) else putString(key, v) }.apply() }

    companion object { const val PREFS = "hub_upload_sources" }
}

/**
 * Recorded workouts (`activity/session`): every finished, cancelled or deleted session changed
 * since the cursor. A finished one is uploaded with its route, heart-rate zones, pauses and kcal
 * method, plus its GPS fixes as `activity/gps` chunks (SPEC GA.6); a cancelled or deleted one
 * becomes a deletion (and a GPS deletion when it had fixes). Demo data never creates sessions, so
 * there is nothing to filter.
 * The first call after pairing walks the whole table, which is the workouts' backfill.
 */
class HubWorkoutSync(
    private val db: PulseLoopDatabase,
    private val settings: HubSettingsSource,
    private val cursor: HubSourceCursor,
    private val now: () -> Instant = Instant::now,
    private val pageSize: Int = 50,
) : HubUploadSource {

    override fun reset() { cursor.value = null }

    override suspend fun enqueueChanged(): Int {
        if (settings.pairing.value == null) return 0
        var queued = 0
        var guard = 0
        while (guard++ < MAX_PAGES_PER_CALL) {
            val (afterUpdated, afterId) = decode(cursor.value)
            val page = db.activitySessionDao().settledChangedAfter(afterUpdated, afterId, pageSize)
            if (page.isEmpty()) break
            val receivedAt = now()
            val profileRow = db.userProfileDao().get()
            val age = profileRow?.age
            val profile = profileRow?.let { MetricsProfileValues(sex = it.sex, age = it.age, weightKg = it.weightKg) }
            val rows = page.flatMap { session ->
                if (session.statusRaw == "finished") {
                    val end = session.endedAt ?: return@flatMap emptyList()
                    val gps = db.activityGpsPointDao().forSession(session.id)
                    val hr = db.measurementDao()
                        .rangeReal(MeasurementKind.HEART_RATE.name, session.startedAt, end)
                        .map { HubWorkoutMapper.HrSample(it.timestamp, it.value) }
                    val events = db.activityEventDao().forSession(session.id)
                    val pauses = HubWorkoutMapper.pauses(events, session.startedAt, end)
                    val recording = com.pulseloop.service.RecordingStart.fromEvents(events)
                    val row = HubWorkoutMapper.toHubOutbox(session, gps, hr, age, settings.installationId, receivedAt, pauses, profile, recording)
                        ?: return@flatMap emptyList()
                    listOf(row) + HubWorkoutMapper.gpsChunks(session, gps, settings.installationId, receivedAt)
                } else {
                    val hadGps = session.gpsPointCount > 0 || db.activityGpsPointDao().forSession(session.id).isNotEmpty()
                    listOfNotNull(
                        HubWorkoutMapper.deletion(session, settings.installationId, receivedAt),
                        if (hadGps) HubWorkoutMapper.gpsDeletion(session, settings.installationId, receivedAt) else null,
                    )
                }
            }
            db.withTransaction { if (rows.isNotEmpty()) db.hubOutboxDao().enqueueAll(rows) }
            queued += rows.size
            val last = page.last()
            cursor.value = "${last.updatedAt}|${last.id}"
            if (page.size < pageSize) break
        }
        return queued
    }

    companion object {
        const val CURSOR_KEY = "activity_session.v1"
        private const val MAX_PAGES_PER_CALL = 20

        internal fun decode(raw: String?): Pair<Long, String> {
            if (raw.isNullOrBlank()) return Long.MIN_VALUE to ""
            val parts = raw.split('|', limit = 2)
            return (parts[0].toLongOrNull() ?: Long.MIN_VALUE) to parts.getOrElse(1) { "" }
        }
    }
}
