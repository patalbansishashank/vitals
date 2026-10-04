package desi.creative.vitals

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service of type connectedDevice. It does no Bluetooth itself: the ring link runs in the WebView's JS.
 * Its job is to keep the process (and so the WebView) alive with a persistent notification on `ring_link`, and to go
 * away when the activity goes away (the link died with the WebView).
 *
 * No wake lock: the foreground service already keeps the process from being killed, and incoming GATT notifications
 * wake the CPU through the Bluetooth stack, which holds its own wake lock while it delivers them. A partial wake lock
 * held all night would cost battery, and in Doze it is ignored anyway. If R21 (screen-off run) shows the WebView
 * stalling, that is the place to revisit.
 */
class RingLinkService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stop()
                return START_NOT_STICKY
            }
            else -> {
                val text = intent?.getStringExtra(EXTRA_TEXT)?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.ring_connected)
                if (!goForeground(text)) stopSelf()
            }
        }
        // Not sticky: if the system kills the process, the WebView and the ring link are gone too; a restarted
        // service without them would only show a stale notification.
        return START_NOT_STICKY
    }

    private fun goForeground(text: String): Boolean {
        Notices.ensureChannels(this)
        val notification = Notices.ringLink(this, text).build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        return try {
            ServiceCompat.startForeground(this, Notices.ID_RING_LINK, notification, type)
            ShellState.keepAliveOn = true
            true
        } catch (e: Exception) {
            // Android 12+: ForegroundServiceStartNotAllowedException (started from the background);
            // Android 14+: SecurityException when the connectedDevice type's permission is missing.
            // The plugin checks both before starting; this is the last line, so it never crashes.
            ShellState.keepAliveOn = false
            false
        }
    }

    private fun stop() {
        ShellState.keepAliveOn = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /** The task was swiped away: the activity (and the WebView) is gone, so is the link. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        stop()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        ShellState.keepAliveOn = false
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "desi.creative.vitals.ringlink.START"
        const val ACTION_STOP = "desi.creative.vitals.ringlink.STOP"
        const val EXTRA_TEXT = "text"

        /**
         * Starts the service or updates its notification text. Throws on Android 12+ when the app is in the
         * background and may not start a foreground service; the caller turns that into a rejection.
         */
        fun start(context: Context, text: String) {
            val intent = Intent(context, RingLinkService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_TEXT, text)
            ContextCompat.startForegroundService(context, intent)
        }

        /** Stops the service and removes its notification; harmless when it is not running. */
        fun stop(context: Context) {
            val intent = Intent(context, RingLinkService::class.java)
            try {
                context.startService(intent.setAction(ACTION_STOP))
            } catch (_: Exception) {
                // Android 8+ refuses startService from the background when no foreground service runs: then there
                // is nothing to stop gracefully, stopService covers the rest.
                context.stopService(Intent(context, RingLinkService::class.java))
            }
        }
    }
}
