package desi.creative.vitals

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream

/**
 * The `VitalsShell` plugin: the contract between the Android layer and the web glue (src/platform/androidShell.ts):
 * files shared to Vitals in, and files saved through the share sheet out.
 */
@CapacitorPlugin(name = "VitalsShell")
class VitalsShellPlugin : Plugin() {

    override fun load() {
        ShellState.plugin = this
        if (ShellState.pendingSharedCount() > 0) announceSharedFiles()
    }

    override fun handleOnDestroy() {
        if (ShellState.plugin === this) ShellState.plugin = null
    }

    /** Called on the main thread when new shared files are pending (from SharedFiles or on load). */
    fun announceSharedFiles() {
        val count = ShellState.pendingSharedCount()
        if (count > 0) notifyListeners("sharedFiles", JSObject().put("count", count), true)
    }

    // ---- methods -------------------------------------------------------------------------------------------------

    @PluginMethod
    fun takeSharedFiles(call: PluginCall) {
        val files = JSArray()
        for (f in ShellState.takePendingShared()) {
            files.put(
                JSObject()
                    .put("name", f.name)
                    .put("mime", f.mime)
                    .put("size", f.size)
                    .put("path", f.file.absolutePath)
            )
        }
        call.resolve(JSObject().put("files", files))
    }

    @PluginMethod
    fun saveFile(call: PluginCall) {
        val name = SharedFileNames.sanitise(call.getString("name"), call.getString("mime"))
        val mime = SharedMime.normalise(call.getString("mime")) ?: "application/octet-stream"
        val data = call.getString("dataBase64")
        if (data == null) {
            call.reject("dataBase64 missing", "invalid")
            return
        }
        val ctx = context
        // Decoding and writing off the main thread; the share sheet is opened back on it.
        Thread {
            val file: File
            try {
                val folder = File(ctx.cacheDir, "exports").apply { mkdirs() }
                file = File(folder, name)
                val bytes = Base64.decode(data, Base64.DEFAULT)
                FileOutputStream(file).use { it.write(bytes) }
            } catch (e: Exception) {
                call.reject("Could not write the file", "io")
                return@Thread
            }
            activity.runOnUiThread {
                try {
                    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
                    val send = Intent(Intent.ACTION_SEND)
                        .setType(mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .putExtra(Intent.EXTRA_TITLE, name)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    activity.startActivity(Intent.createChooser(send, name))
                    call.resolve()
                } catch (e: Exception) {
                    call.reject("Could not open the share sheet", "unavailable")
                }
            }
        }.start()
    }
}
