package com.pulseloop.social

import android.content.Context
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.hub.HubSync
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Recomputes foreground time from Usage access, persists a daily snapshot (so history survives UsageStats' retention),
 * and hands the daily totals to the home-server outbox as `habits/social_time` (SPEC social-time). All durations, never
 * content. Pure logic lives in [SocialUsageReader]; this is the glue to Room, the settings and the hub.
 */
class SocialTimeRepository(
    private val dao: SocialTimeDao,
    private val hubDao: HubOutboxDao?,
    private val settings: () -> SocialPrefs,
    private val query: SocialUsageQuery,
    private val usageGranted: () -> Boolean,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
    private val hubInstallationId: () -> String? = { HubSync.pairedInstallationId() },
    private val requestHubUpload: () -> Unit = { HubSync.requestUpload() },
) {
    fun dayOf(atMs: Long): LocalDate = SocialUsageReader.dayOf(atMs, zone())

    /** Maps a package to an enabled app's key, dropping unknown and switched-off apps. */
    private fun keyOf(prefs: SocialPrefs): (String) -> String? = { pkg ->
        SocialApp.fromPackage(pkg)?.takeIf { prefs.appEnabled(it) }?.key
    }

    /**
     * Read today and the [days] - 1 days before it from Usage access, and persist each app's whole-day total. A day with
     * no counted time writes nothing (and leaves any older row untouched). Returns the local dates it wrote.
     */
    suspend fun recompute(nowMs: Long = System.currentTimeMillis(), days: Int = RECENT_DAYS): List<LocalDate> {
        val prefs = settings()
        if (!prefs.enabled || !usageGranted()) return emptyList()
        val z = zone()
        val window = SocialUsageReader.window(dayOf(nowMs), days)
        val begin = SocialUsageReader.startOfDay(window.first(), z).toEpochMilli()
        val events = query.events(begin, nowMs)
        val perDay = SocialUsageReader.perDay(events, window, z, nowMs, keyOf(prefs))
        val rows = perDay.flatMap { (day, byKey) ->
            byKey.map { (key, seconds) -> SocialTimeDayEntity(day.toString(), key, seconds, nowMs) }
        }
        if (rows.isNotEmpty()) dao.upsert(rows)
        return perDay.filterValues { it.isNotEmpty() }.keys.toList()
    }

    suspend fun summary(date: LocalDate): SocialDaySummary = SocialDaySummary.of(date, dao.day(date.toString()))

    suspend fun todaySummary(nowMs: Long = System.currentTimeMillis()): SocialDaySummary = summary(dayOf(nowMs))

    /**
     * Queue [date]'s totals for the home server when the phone is paired and the person allows it. An unchanged day
     * hashes to the same id and is dropped by the outbox. Returns true if a new row was queued.
     */
    suspend fun queueDay(date: LocalDate, nowMs: Long = System.currentTimeMillis()): Boolean {
        val outbox = hubDao ?: return false
        val prefs = settings()
        if (!prefs.hubUpload) return false
        val installation = hubInstallationId() ?: return false
        val day = summary(date)
        if (day.totalSeconds <= 0 || day.updatedAt == 0L) return false
        val row = SocialHubEvent.toHubOutbox(
            summary = day,
            targetMin = prefs.targetMinMinutes,
            targetMax = prefs.targetMaxMinutes,
            enabledApps = prefs.enabledKeys,
            installationId = installation,
            zone = zone(),
            receivedAt = Instant.ofEpochMilli(nowMs),
        )
        val queued = outbox.enqueue(row) != -1L
        if (queued) requestHubUpload()
        return queued
    }

    /** Queue today and the [days] - 1 days before it. Days already sent unchanged are dropped. Returns how many queued. */
    suspend fun queueRecent(nowMs: Long = System.currentTimeMillis(), days: Int = RECENT_DAYS): Int =
        SocialUsageReader.window(dayOf(nowMs), days).count { queueDay(it, nowMs) }

    /** The one call the cadence hook ([SocialTimeSource]) makes: recompute, persist, then queue what changed. */
    suspend fun collect(nowMs: Long = System.currentTimeMillis()): Int {
        recompute(nowMs)
        return queueRecent(nowMs)
    }

    companion object {
        /** Today plus two weeks back: enough for a missed upload to recover within UsageStats' retention. */
        const val RECENT_DAYS = 14

        @Volatile private var instance: SocialTimeRepository? = null

        fun get(context: Context): SocialTimeRepository = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                val db = PulseLoopDatabase.getInstance(app)
                val settings = SocialSettings.get(app)
                SocialTimeRepository(
                    dao = db.socialTimeDao(),
                    hubDao = db.hubOutboxDao(),
                    settings = { settings.prefs.value },
                    query = SocialUsageQuery.fromSystem(app),
                    usageGranted = { SocialUsageAccess.isGranted(app) },
                    requestHubUpload = { HubSync.requestUpload(app) },
                )
            }.also { instance = it }
        }
    }
}
