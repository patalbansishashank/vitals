package desi.creative.vitals

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * Files shared to Vitals (ACTION_SEND, ACTION_SEND_MULTIPLE, ACTION_VIEW). Each stream is copied into cache/shared/
 * on a worker thread (never into memory: a Lumen export can be large), then added to the pending list and announced
 * to JS through the `sharedFiles` event. The URI grant lasts as long as the activity, which is what started this.
 */
object SharedFiles {
    private const val TAG = "VitalsShell"
    private const val DIR = "shared"
    private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun dir(context: Context): File = File(context.cacheDir, DIR)

    /** The content URIs an intent carries, in order; empty for intents that are not a share. */
    fun urisOf(intent: Intent?): List<Uri> {
        intent ?: return emptyList()
        val out = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> {
                uriExtra(intent)?.let { out += it }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val list = if (android.os.Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                }
                list?.filterNotNull()?.let { out += it }
            }
            Intent.ACTION_VIEW -> intent.data?.let { out += it }
        }
        if (out.isEmpty()) {
            // Some senders only fill ClipData.
            val clip = intent.clipData
            if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { out += it }
        }
        // Content URIs only: a file:// URI from another app could point into Vitals' own private files.
        return out.filter { it.scheme == ContentResolver.SCHEME_CONTENT }
    }

    private fun uriExtra(intent: Intent): Uri? =
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }

    /**
     * Copies the intent's files in the background; on the main thread afterwards, adds them to the pending list and
     * fires `sharedFiles` when the plugin is loaded (else the plugin announces them when it loads).
     */
    fun take(context: Context, intent: Intent) {
        val uris = urisOf(intent)
        if (uris.isEmpty()) return
        val app = context.applicationContext
        val declaredType = intent.type
        worker.execute {
            val copied = mutableListOf<ShellState.SharedFile>()
            for (uri in uris) {
                try {
                    copyOne(app, uri, declaredType)?.let { copied += it }
                } catch (e: Exception) {
                    // Missing grant, provider gone, disk full: skip that file, keep the rest.
                    Log.w(TAG, "shared file skipped: ${e.javaClass.simpleName}")
                }
            }
            if (copied.isEmpty()) return@execute
            main.post {
                ShellState.addPendingShared(copied)
                ShellState.plugin?.announceSharedFiles()
            }
        }
    }

    private fun copyOne(context: Context, uri: Uri, declaredType: String?): ShellState.SharedFile? {
        val resolver = context.contentResolver
        var displayName: String? = null
        var declaredSize: Long = -1
        if (uri.scheme == ContentResolver.SCHEME_CONTENT) {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val s = c.getColumnIndex(OpenableColumns.SIZE)
                        if (n >= 0) displayName = c.getString(n)
                        if (s >= 0 && !c.isNull(s)) declaredSize = c.getLong(s)
                    }
                }
        }
        if (displayName == null) displayName = uri.lastPathSegment
        val mime = SharedMime.resolve(resolver.getType(uri) ?: declaredType, displayName)
        if (!SharedMime.isAccepted(mime, displayName)) {
            Log.w(TAG, "shared file ignored, type not accepted")
            return null
        }
        val folder = dir(context).apply { mkdirs() }
        val taken = (folder.list()?.toSet() ?: emptySet()) + ShellState.pendingSharedNames()
        val name = SharedFileNames.unique(SharedFileNames.sanitise(displayName, mime), taken)
        val target = File(folder, name)
        val size = try {
            resolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output, 64 * 1024) }
            }
        } catch (e: Exception) {
            target.delete() // no half-copied file left behind
            throw e
        } ?: return null
        return ShellState.SharedFile(name, mime, if (size >= 0) size else declaredSize, target)
    }

    /** Drops copies older than a day (JS normally takes them right away; this covers crashes and ignored shares). */
    fun pruneOld(context: Context) {
        val app = context.applicationContext
        worker.execute {
            val cutoff = System.currentTimeMillis() - MAX_AGE_MS
            dir(app).listFiles()?.forEach { f -> if (f.isFile && f.lastModified() < cutoff) f.delete() }
        }
    }
}
