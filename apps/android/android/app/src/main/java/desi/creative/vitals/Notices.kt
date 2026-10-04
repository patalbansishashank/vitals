package desi.creative.vitals

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Notification channels, ids and builders shared by the service, the plugin and the boot receiver. */
object Notices {
    const val CHANNEL_RING_LINK = "ring_link"
    const val CHANNEL_RING_ALERTS = "ring_alerts"

    const val ID_RING_LINK = 1
    const val ID_TAP_TO_CONNECT = 2
    private const val ID_BATTERY_LOW = 10
    private const val ID_RING_DISCONNECTED = 11

    /** One fixed id per alert kind, so a second call replaces instead of stacking. Unknown kind -> null. */
    fun idForKind(kind: String?): Int? = when (kind) {
        "battery_low" -> ID_BATTERY_LOW
        "ring_disconnected" -> ID_RING_DISCONNECTED
        else -> null
    }

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val link = NotificationChannel(
            CHANNEL_RING_LINK, context.getString(R.string.channel_ring_link), NotificationManager.IMPORTANCE_LOW
        ).apply { setShowBadge(false) }
        val alerts = NotificationChannel(
            CHANNEL_RING_ALERTS, context.getString(R.string.channel_ring_alerts), NotificationManager.IMPORTANCE_DEFAULT
        )
        manager.createNotificationChannel(link)
        manager.createNotificationChannel(alerts)
    }

    fun notificationsAllowed(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** Opens (or brings back) MainActivity, tagged with the reason so getState().launchReason reports it. */
    fun openAppIntent(context: Context, reason: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(ShellState.EXTRA_LAUNCH_REASON, reason)
        }
        return PendingIntent.getActivity(
            context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    /** The persistent, silent notification of the foreground service. */
    fun ringLink(context: Context, text: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, CHANNEL_RING_LINK)
            .setSmallIcon(R.drawable.ic_stat_vitals)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent(context, "notification", ID_RING_LINK))

    /** New text on the running service's notification (same id, so it replaces it in place). */
    fun updateRingLink(context: Context, text: String) {
        try {
            NotificationManagerCompat.from(context).notify(ID_RING_LINK, ringLink(context, text).build())
        } catch (_: SecurityException) {
            // Notifications not allowed: the service runs on, its notification is hidden anyway.
        }
    }

    /** Quiet "Tap to connect your ring" after a restart (or Bluetooth coming back), when no JS is running. */
    fun postTapToConnect(context: Context, reason: String) {
        if (!notificationsAllowed(context)) return
        ensureChannels(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_RING_LINK)
            .setSmallIcon(R.drawable.ic_stat_vitals)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.ring_tap_to_connect))
            .setSilent(true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent(context, reason, ID_TAP_TO_CONNECT))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(ID_TAP_TO_CONNECT, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS revoked between the check and the post: nothing to do.
        }
    }

    /** An alert on `ring_alerts`; replaces the previous one of the same kind. Returns false for an unknown kind. */
    fun postAlert(context: Context, kind: String?, title: String, text: String): Boolean {
        val id = idForKind(kind) ?: return false
        ensureChannels(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_RING_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_vitals)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(openAppIntent(context, "notification", id))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            return false
        }
        return true
    }

    fun clearAlert(context: Context, kind: String?): Boolean {
        val id = idForKind(kind) ?: return false
        NotificationManagerCompat.from(context).cancel(id)
        return true
    }
}
