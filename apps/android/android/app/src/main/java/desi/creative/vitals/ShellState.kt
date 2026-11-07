package desi.creative.vitals

import android.content.Intent
import java.io.File

/**
 * Process-wide state shared by the activity and the plugin. Plugin methods run on Capacitor's plugin thread and the
 * copies on a worker, so the pending list is guarded and the plugin reference is volatile.
 */
object ShellState {
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

    /** Recents (or a restore) re-delivers the original intent: its share or link was handled the first time. */
    fun isFromHistory(intent: Intent): Boolean = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
}
