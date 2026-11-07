package com.pulseloop.vitals

import android.content.Context
import com.pulseloop.GaugeHost
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.hub.HubSync
import com.pulseloop.util.TimeUtil
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject

/**
 * What the engine answers the Vitals plugin's `local` call (schema 1; Vitals' `localSnapshotOf` reads it field by
 * field): the upload queue and the ring's own count of today's steps. Gauge 2.8.7 served it to Vitals through an exported,
 * caller-checked provider; inside Vitals (0.7.0) the plugin asks in-process and nothing is exported.
 */
object VitalsLocalSnapshot {
    data class Input(
        val at: Long,
        val app: String,
        val paired: Boolean,
        val pending: Int,
        val lastSentAt: Long?,
        val lastError: String?,
        val lastErrorAt: Long?,
        val retryAt: Long?,
        val needsRepair: Boolean,
        val today: LocalDate,
        val ringSteps: Int?,
        val ringStepsAt: Long?,
    )

    fun json(i: Input): String {
        fun iso(ms: Long?): Any = ms?.let { Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL
        val upload = JSONObject()
            .put("paired", i.paired)
            .put("pending", i.pending)
            .put("lastSentAt", iso(i.lastSentAt))
            .put("lastError", i.lastError?.take(200) ?: JSONObject.NULL)
            .put("lastErrorAt", iso(i.lastErrorAt))
            .put("retryAt", iso(i.retryAt))
            .put("needsRepair", i.needsRepair)
        val today = JSONObject()
            .put("date", i.today.toString())
            .put("ringSteps", i.ringSteps ?: JSONObject.NULL)
            .put("ringStepsAt", iso(i.ringStepsAt))
        return JSONObject()
            .put("schema", 1)
            .put("at", iso(i.at))
            .put("app", i.app)
            .put("upload", upload)
            .put("today", today)
            .toString()
    }

    suspend fun read(context: Context, zone: ZoneId = ZoneId.systemDefault()): String {
        val now = System.currentTimeMillis()
        val settings = HubSync.store(context)
        val pairing = settings.pairing.value
        val status = settings.status.value
        val db = PulseLoopDatabase.getInstance(context)
        val day = db.activityDailyDao().byDay(TimeUtil.startOfDayLocal(now, zone))
            // a demo row is never a real count (DemoDataPolicy)
            ?.takeIf { it.source != "demo" && it.source != "mock" }
        return json(
            Input(
                at = now,
                app = GaugeHost.versionName(context),
                paired = pairing != null,
                pending = if (pairing != null) db.hubOutboxDao().pendingCount() else 0,
                lastSentAt = status.lastUploadAt,
                lastError = status.lastError.takeIf { (status.lastErrorAt ?: 0) > (status.lastUploadAt ?: 0) },
                lastErrorAt = status.lastErrorAt.takeIf { (it ?: 0) > (status.lastUploadAt ?: 0) },
                retryAt = status.notBefore.takeIf { it > now },
                needsRepair = pairing?.needsRepair == true,
                today = LocalDate.now(zone),
                ringSteps = day?.steps,
                ringStepsAt = day?.updatedAt,
            ),
        )
    }
}
