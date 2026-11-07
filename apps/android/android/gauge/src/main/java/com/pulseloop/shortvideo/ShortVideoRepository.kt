package com.pulseloop.shortvideo

import android.content.Context
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.hub.HubSync
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persistence for the daily tallies plus the hub hand-off. All writes are keyed by the local date
 * of the moment they happen, so a session running across midnight starts a new day's row.
 */
class ShortVideoRepository(
    private val dao: ShortVideoDao,
    private val hubDao: HubOutboxDao?,
    private val settings: () -> ShortVideoPrefs,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
    private val hubInstallationId: () -> String? = { HubSync.pairedInstallationId() },
    private val requestHubUpload: () -> Unit = { HubSync.requestUpload() },
) {
    fun dayOf(atMs: Long): LocalDate = ShortVideoDayClock.dayOf(atMs, zone())

    /** Count one reel; returns today's total over both apps after counting it. */
    suspend fun recordReel(app: ShortVideoApp, atMs: Long): Int {
        val date = dayOf(atMs)
        dao.increment(date.toString(), app.key, ShortVideoDao.Field.COUNT, settings().dailyLimit, atMs)
        return summary(date).total
    }

    suspend fun recordLimitHit(app: ShortVideoApp, atMs: Long) =
        dao.increment(dayOf(atMs).toString(), app.key, ShortVideoDao.Field.LIMIT_HIT, settings().dailyLimit, atMs)

    suspend fun recordCancel(app: ShortVideoApp, atMs: Long) =
        dao.increment(dayOf(atMs).toString(), app.key, ShortVideoDao.Field.CANCEL, settings().dailyLimit, atMs)

    suspend fun summary(date: LocalDate): ShortVideoDaySummary =
        ShortVideoDaySummary.of(date, dao.day(date.toString()), settings().dailyLimit)

    suspend fun todayTotal(atMs: Long): Int = summary(dayOf(atMs)).total

    fun summariesFlow(days: List<LocalDate>): Flow<List<ShortVideoDaySummary>> =
        dao.rangeFlow(days.first().toString(), days.last().toString()).map { rows ->
            val limit = settings().dailyLimit
            days.map { ShortVideoDaySummary.of(it, rows, limit) }
        }

    suspend fun clearDay(date: LocalDate) = dao.clearDay(date.toString())

    /**
     * Queue [date]'s numbers for the home server when the phone is paired and the user allows it.
     * An unchanged day hashes to the same id and is ignored by the outbox. Returns true if queued.
     */
    suspend fun queueHub(date: LocalDate, nowMs: Long = System.currentTimeMillis()): Boolean {
        val outbox = hubDao ?: return false
        if (!settings().hubUpload) return false
        val installation = hubInstallationId() ?: return false
        val day = summary(date)
        if (day.updatedAt == 0L) return false
        val row = ShortVideoHubEvent.toHubOutbox(day, installation, zone(), java.time.Instant.ofEpochMilli(nowMs))
        val queued = outbox.enqueue(row) != -1L
        if (queued) requestHubUpload()
        return queued
    }

    /**
     * Queue today and the [days] - 1 days before it (the wall clock's local dates at [nowMs]).
     * Sent at every session end, on service start and at the day's turn, so today's count reaches
     * the server while it is still today and a day a process restart missed catches up. Days already
     * sent unchanged are ignored by the outbox. Returns how many days were queued.
     */
    suspend fun queueRecent(nowMs: Long = System.currentTimeMillis(), days: Int = RECENT_DAYS): Int =
        ShortVideoDayClock.window(dayOf(nowMs), days).count { queueHub(it, nowMs) }

    companion object {
        /** How far back [queueRecent] looks: a week of days a missed upload can still recover. */
        const val RECENT_DAYS = 7

        @Volatile private var instance: ShortVideoRepository? = null

        fun get(context: Context): ShortVideoRepository = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                val db = PulseLoopDatabase.getInstance(app)
                val settings = ShortVideoSettings.get(app)
                ShortVideoRepository(
                    dao = db.shortVideoDao(),
                    hubDao = db.hubOutboxDao(),
                    settings = { settings.prefs.value },
                    requestHubUpload = { HubSync.requestUpload(app) },
                )
            }.also { instance = it }
        }
    }
}
