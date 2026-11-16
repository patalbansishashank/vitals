package com.pulseloop.social

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context

/** Reads the phone's usage events into [SocialUsageReader.Event]s. The only device-dependent part of the pipeline. */
fun interface SocialUsageQuery {
    /** Events in [beginMs, endMs); empty when Usage access is off or the system returns nothing. */
    fun events(beginMs: Long, endMs: Long): List<SocialUsageReader.Event>

    companion object {
        fun fromSystem(context: Context): SocialUsageQuery = SocialUsageQuery { beginMs, endMs ->
            val manager = context.getSystemService(UsageStatsManager::class.java) ?: return@SocialUsageQuery emptyList()
            val out = ArrayList<SocialUsageReader.Event>()
            val events = runCatching { manager.queryEvents(beginMs, endMs) }.getOrNull() ?: return@SocialUsageQuery emptyList()
            val event = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val pkg = event.packageName ?: continue
                val kind = SocialUsageReader.kindOf(event.eventType)
                if (kind != SocialUsageReader.Kind.OTHER) {
                    out.add(SocialUsageReader.Event(pkg, kind, event.timeStamp))
                }
            }
            out
        }
    }
}
