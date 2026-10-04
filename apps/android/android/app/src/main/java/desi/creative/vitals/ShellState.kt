package desi.creative.vitals

import android.content.ContentResolver
import android.content.Intent
import java.io.File

/**
 * Process-wide state shared by the activity, the plugin, the service and the receivers. Plugin methods run on
 * Capacitor's plugin thread and the copies on a worker, so the pending list is guarded and the flags are volatile.
 */
object ShellState {
    const val EXTRA_LAUNCH_REASON = "desi.creative.vitals.launchReason"

    /** How the activity was last launched or brought to the front (contract: getState().launchReason). */
    @Volatile var launchReason: String = "launcher"

    /** The MainActivity exists (between onCreate and onDestroy). Receivers use it as "the app is running". */
    @Volatile var activityAlive: Boolean = false

    /** The foreground service is in the foreground (set by the service itself). */
    @Volatile var keepAliveOn: Boolean = false

    /** The plugin instance while the bridge is loaded, so native code can fire events. */
    @Volatile var plugin: VitalsShellPlugin? = null

    /** Files copied into cache/shared/ that JS has not taken yet. */
    private val pendingSharedFiles: MutableList<SharedFile> = mutableListOf()

    data class SharedFile(val name: String, val mime: String, val size: Long, val file: File)

    fun addPendingShared(files: List<SharedFile>) = synchronized(pendingSharedFiles) { pendingSharedFiles += files }

    fun pendingSharedCount(): Int = synchronized(pendingSharedFiles) { pendingSharedFiles.size }

    fun pendingSharedNames(): Set<String> = synchronized(pendingSharedFiles) { pendingSharedFiles.mapTo(HashSet()) { it.name } }

    /** Returns the pending files and clears the list. */
    fun takePendingShared(): List<SharedFile> = synchronized(pendingSharedFiles) {
        pendingSharedFiles.toList().also { pendingSharedFiles.clear() }
    }

    /**
     * The launch reason an intent carries: a notification extra, a share, else the launcher. A launch from Recents
     * replays the first intent, so it counts as the launcher.
     */
    fun reasonFor(intent: Intent?): String {
        if (intent == null || isFromHistory(intent)) return "launcher"
        val extra = intent.getStringExtra(EXTRA_LAUNCH_REASON)
        if (extra != null) return extra
        return when (intent.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> "share"
            Intent.ACTION_VIEW -> if (intent.data?.scheme == ContentResolver.SCHEME_CONTENT) "share" else "launcher"
            else -> "launcher"
        }
    }

    /** Recents (or a restore) re-delivers the original intent: its share or link was handled the first time. */
    fun isFromHistory(intent: Intent): Boolean = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
}
