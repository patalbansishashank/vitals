package desi.creative.vitals

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.FileOutputStream

/**
 * The `VitalsShell` plugin: the contract between the Android layer and the web glue
 * (.jobs/tmp/L-ANDROID.contract.md). The ring link itself lives in JS; this is keep-alive, the background read tick
 * (RingTick), notifications, preferences for the boot receiver, shared files in and the share sheet out.
 */
@CapacitorPlugin(
    name = "VitalsShell",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])]
)
class VitalsShellPlugin : Plugin() {

    private var resumedOnce = false

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
            when (state) {
                BluetoothAdapter.STATE_ON -> notifyListeners("bluetoothState", JSObject().put("on", true))
                BluetoothAdapter.STATE_OFF -> notifyListeners("bluetoothState", JSObject().put("on", false))
            }
        }
    }

    override fun load() {
        ShellState.plugin = this
        Notices.ensureChannels(context)
        // A protected system broadcast: only the system sends it, so an exported receiver is safe, and
        // RECEIVER_NOT_EXPORTED would block it on Android 12 and below (ContextCompat adds a signature permission there).
        ContextCompat.registerReceiver(
            context, bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED
        )
        if (ShellState.launchReason == "boot") {
            // Kept until the web layer adds its listener.
            notifyListeners("bootCompleted", JSObject(), true)
        }
        if (ShellState.pendingSharedCount() > 0) announceSharedFiles()
    }

    override fun handleOnResume() {
        if (resumedOnce) notifyListeners("resume", JSObject())
        resumedOnce = true
    }

    override fun handleOnDestroy() {
        try {
            context.unregisterReceiver(bluetoothReceiver)
        } catch (_: IllegalArgumentException) {
        }
        if (ShellState.plugin === this) ShellState.plugin = null
        // A read this bridge was doing is gone with it: do not hold the CPU for the rest of the tick.
        RingTick.done()
    }

    /** RingTick's alarm fired (wake lock held): the web layer reads the ring, then calls ringTickDone. */
    fun fireRingTick(at: Long) {
        notifyListeners("ringTick", JSObject().put("at", at))
    }

    /** The window went on or off screen (RingWebView): the web layer's page visibility follows this. */
    fun fireScreen(on: Boolean) {
        notifyListeners("screen", JSObject().put("on", on))
    }

    /** Called on the main thread when new shared files are pending (from SharedFiles or on load). */
    fun announceSharedFiles() {
        val count = ShellState.pendingSharedCount()
        if (count > 0) notifyListeners("sharedFiles", JSObject().put("count", count), true)
    }

    // ---- methods -------------------------------------------------------------------------------------------------

    @PluginMethod
    fun keepAlive(call: PluginCall) {
        val on = call.getBoolean("on", false) ?: false
        if (!on) {
            RingLinkService.stop(context)
            call.resolve()
            return
        }
        // Android 12+ needs BLUETOOTH_CONNECT for a connectedDevice service (enforced from 14; the ring needs it
        // anyway from 12), so without it there is nothing to keep alive.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            call.reject("Bluetooth permission not granted", "permission")
            return
        }
        val text = call.getString("text")?.takeIf { it.isNotBlank() } ?: context.getString(R.string.ring_connected)
        if (ShellState.keepAliveOn) {
            // Already in the foreground: only the text changes. Re-posting the notification works with the screen
            // off, where a second startForegroundService would count as a background start (refused on Android 12+).
            Notices.updateRingLink(context, text)
            call.resolve()
            return
        }
        try {
            RingLinkService.start(context, text)
        } catch (e: IllegalStateException) {
            // Android 12+: ForegroundServiceStartNotAllowedException extends IllegalStateException. Checked by name
            // through `is` inside the version guard so older devices never load the class.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                e is android.app.ForegroundServiceStartNotAllowedException
            ) {
                call.reject("Cannot start the ring service from the background", "not_allowed")
            } else {
                call.reject("Cannot start the ring service", "not_allowed")
            }
            return
        } catch (e: SecurityException) {
            call.reject("Bluetooth permission not granted", "permission")
            return
        }
        call.resolve()
    }

    /** How often the ring is read while the service runs with the screen off (ms; clamped to a minute). */
    @PluginMethod
    fun setRingTick(call: PluginCall) {
        val every = call.getDouble("everyMs")?.toLong()
        if (every == null || every <= 0) {
            call.reject("everyMs missing", "invalid")
            return
        }
        RingTick.setEvery(context, every)
        call.resolve(JSObject().put("everyMs", RingTick.everyMs))
    }

    /** The web layer finished the read a ringTick asked for: the wake lock goes. */
    @PluginMethod
    fun ringTickDone(call: PluginCall) {
        RingTick.done()
        call.resolve()
    }

    @PluginMethod
    fun notify(call: PluginCall) {
        val kind = call.getString("kind")
        val title = call.getString("title") ?: context.getString(R.string.app_name)
        val text = call.getString("text") ?: ""
        if (Notices.idForKind(kind) == null) {
            call.reject("Unknown kind", "invalid")
            return
        }
        Notices.postAlert(context, kind, title, text)
        call.resolve()
    }

    @PluginMethod
    fun clearNotice(call: PluginCall) {
        if (!Notices.clearAlert(context, call.getString("kind"))) {
            call.reject("Unknown kind", "invalid")
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun setPrefs(call: PluginCall) {
        val prefs = ShellPrefs(context)
        call.getBoolean("keepConnected")?.let { prefs.keepConnected = it }
        call.getBoolean("ringKnown")?.let { prefs.ringKnown = it }
        call.resolve()
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("bluetoothOn", bluetoothOn())
                .put("notificationsAllowed", Notices.notificationsAllowed(context))
                .put("keepAliveOn", ShellState.keepAliveOn)
                .put("launchReason", ShellState.launchReason)
                .put("onScreen", ShellState.onScreen)
                .put("ringTicks", RingTick.count)
                .put("lastRingTickAt", RingTick.lastAt)
                .put("ringTickEveryMs", RingTick.everyMs)
        )
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionDone")
    }

    @PermissionCallback
    private fun notificationPermissionDone(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

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

    @PluginMethod
    fun batteryOptimisation(call: PluginCall) {
        val power = context.getSystemService(PowerManager::class.java)
        val allowed = power?.isIgnoringBatteryOptimizations(context.packageName) ?: true
        call.resolve(JSObject().put("restricted", !allowed))
    }

    /**
     * Asks to put Vitals on the battery-optimisation allow list (the system's own yes/no dialog); where that dialog
     * is missing, the list itself. The ring link must keep running with the screen off, which is what the
     * permission is for, hence the BatteryLife suppression.
     */
    @SuppressLint("BatteryLife")
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val act = activity
        act.runOnUiThread {
            val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${act.packageName}".toUri())
            try {
                act.startActivity(ask)
                call.resolve()
            } catch (_: ActivityNotFoundException) {
                try {
                    act.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    call.resolve()
                } catch (_: ActivityNotFoundException) {
                    call.reject("Battery settings not available", "unavailable")
                }
            }
        }
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private fun bluetoothOn(): Boolean {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return false
        return try {
            adapter.isEnabled
        } catch (_: SecurityException) {
            false
        }
    }
}
