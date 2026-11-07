package com.pulseloop.shortvideo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.pulseloop.GaugeHost
import com.pulseloop.R

/**
 * The ongoing "brain + count" notification. On Android 16 it is a Live Update (a promoted ongoing
 * notification with ProgressStyle and a short critical text such as "37"), which is what OxygenOS
 * shows in its Live Alerts capsule, Samsung in the Now Bar and Pixel as a status-bar chip. On
 * Android 15 and older it is a plain silent ongoing notification with a progress bar.
 *
 * Whether the system actually promoted it is checked after each first post ([onPromotionChecked]),
 * so Auto mode can fall back to the overlay pill when the capsule does not appear.
 */
class LiveCapsuleNotification(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var posted = false

    fun environment(promoted: Boolean?): CapsuleEnvironment = CapsuleEnvironment(
        sdkInt = Build.VERSION.SDK_INT,
        notificationsAllowed = notificationsAllowed(context),
        canPostPromoted = canPostPromoted(context),
        promoted = promoted,
    )

    fun show(
        total: Int,
        counts: Map<ShortVideoApp, Int>,
        limit: Int,
        onPromotionChecked: ((Boolean) -> Unit)? = null,
    ) {
        if (!notificationsAllowed(context)) return
        ensureChannel(context)
        val stage = BrainStage.forCount(total, limit)
        val title = context.getString(R.string.short_video_live_title, total)
        val text = context.getString(
            R.string.short_video_live_text,
            counts[ShortVideoApp.INSTAGRAM] ?: 0,
            counts[ShortVideoApp.YOUTUBE] ?: 0,
            limit,
        )
        val notification = if (Build.VERSION.SDK_INT >= 36) {
            buildLiveUpdate(total, limit, stage, title, text)
        } else {
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_brain_mono)
                .setContentTitle(title)
                .setContentText(text)
                .setProgress(limit, total.coerceAtMost(limit), false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(openApp())
                .build()
        }
        val first = !posted
        runCatching { manager.notify(NOTIFICATION_ID, notification) }.onFailure { return }
        posted = true
        if (first && onPromotionChecked != null) {
            handler.postDelayed({ onPromotionChecked(isPromoted()) }, PROMOTION_CHECK_DELAY_MS)
        }
    }

    fun hide() {
        if (!posted) return
        posted = false
        handler.removeCallbacksAndMessages(null)
        runCatching { manager.cancel(NOTIFICATION_ID) }
    }

    /** True when the posted notification carries FLAG_PROMOTED_ONGOING (Android 16+). */
    fun isPromoted(): Boolean {
        if (Build.VERSION.SDK_INT < 36) return false
        val active = runCatching { manager.activeNotifications }.getOrNull() ?: return false
        val mine = active.firstOrNull { it.id == NOTIFICATION_ID } ?: return false
        return mine.notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0
    }

    private fun buildLiveUpdate(total: Int, limit: Int, stage: BrainStage, title: String, text: String): Notification {
        val style = Notification.ProgressStyle()
            .setProgressSegments(
                listOf(Notification.ProgressStyle.Segment(limit.coerceAtLeast(1)).setColor(SEGMENT_COLOR)),
            )
            .setProgress(total.coerceAtMost(limit))
            .setProgressTrackerIcon(Icon.createWithResource(context, stage.drawableRes))
            .setStyledByProgress(false)
        return Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_brain_mono)
            .setLargeIcon(Icon.createWithResource(context, stage.drawableRes))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(style)
            .setShortCriticalText(total.toString())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_STATUS)
            .setContentIntent(openApp())
            // Notification.Builder.setRequestPromotedOngoing arrives in a later SDK; this is the
            // extra it sets (Notification.EXTRA_REQUEST_PROMOTED_ONGOING).
            .addExtras(android.os.Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
            .build()
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context,
        NOTIFICATION_ID,
        GaugeHost.launchIntent(context),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    companion object {
        const val CHANNEL_ID = "short_video_live"
        const val NOTIFICATION_ID = 0x5B7A1
        const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
        private const val PROMOTION_CHECK_DELAY_MS = 400L
        private const val SEGMENT_COLOR = 0xFFE3BF78.toInt()

        fun notificationsAllowed(context: Context): Boolean =
            NotificationManagerCompat.from(context).areNotificationsEnabled()

        /** Android 16's per-app "Live Updates" switch. False on older versions. */
        fun canPostPromoted(context: Context): Boolean =
            Build.VERSION.SDK_INT >= 36 &&
                runCatching { context.getSystemService(NotificationManager::class.java).canPostPromotedNotifications() }
                    .getOrDefault(false)

        /** The system page where the user allows Live Updates for Gauge (Android 16+). */
        fun promotionSettingsIntent(context: Context): Intent {
            val action = if (Build.VERSION.SDK_INT >= 36) Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS
                else Settings.ACTION_APP_NOTIFICATION_SETTINGS
            return Intent(action)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            // Default importance (silent): Live Updates are not promoted from a low-importance
            // channel on every build, and the channel makes no sound or vibration anyway.
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.short_video_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.short_video_channel_description)
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }
    }
}
