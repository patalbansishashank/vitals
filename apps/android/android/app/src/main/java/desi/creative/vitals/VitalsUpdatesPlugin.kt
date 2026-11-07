package desi.creative.vitals

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The `VitalsUpdates` plugin (web side: src/platform/androidUpdates.ts). The web layer asks the paired server what is
 * new and hands each entry here with the device token; this downloads and verifies it. `ready()` confirms the web
 * bundle on trial (OtaBoot); `install()` hands a downloaded APK to Android through an install session (OtaInstall), and
 * the system's own confirmation follows.
 */
@CapacitorPlugin(name = "VitalsUpdates")
class VitalsUpdatesPlugin : Plugin() {

    @PluginMethod
    fun ready(call: PluginCall) {
        OtaBoot.ready(context, bridge)
        call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val ctx = context
        val s = OtaBoot.snapshot()
        val apk = OtaApk.ready(ctx)
        val embedded = OtaBoot.embedded(ctx)
        val out = JSObject()
            .put("versionName", OtaBoot.installedVersionName(ctx))
            .put("versionCode", OtaBoot.installedVersionCode(ctx))
            .put("webVersion", s.current ?: embedded.version)
            .put("webEmbedded", s.current == null)
            .put("webPending", s.pending)
            .put("canApplyWeb", true)
            .put("bad", JSArray(s.bad.sorted()))
            .put("metered", OtaDownloads.isMetered(ctx))
        out.put("apk", apk?.let { JSObject().put("versionName", it.versionName).put("versionCode", it.versionCode) })
        call.resolve(out)
    }

    @PluginMethod
    fun download(call: PluginCall) {
        val kind = call.getString("kind")
        val req = OtaRequest(
            url = call.getString("url").orEmpty(),
            sha256 = call.getString("sha256").orEmpty(),
            size = call.getLong("size") ?: call.getInt("size")?.toLong() ?: 0L,
            token = call.getString("token").orEmpty(),
            version = call.getString("version").orEmpty(),
            sig = call.getString("sig"),
            versionCode = call.getInt("versionCode") ?: 0,
            versionName = call.getString("versionName").orEmpty(),
        )
        if (req.token.isEmpty() || (kind != "web" && kind != "apk")) {
            call.reject("invalid request", "invalid")
            return
        }
        val userAsked = call.getBoolean("userAsked", false) == true
        val transferId = call.getString("transferId")?.takeIf { it.length in 1..128 }
        val progress: (OtaProgress) -> Unit = { p ->
            if (transferId != null) notifyListeners("updateProgress", JSObject()
                .put("transferId", transferId).put("kind", kind)
                .put("received", p.received).put("total", p.total).put("phase", p.phase))
        }
        val ctx = context
        OtaDownloads.run {
            try {
                val result = if (kind == "web") OtaDownloads.web(ctx, req, progress) else OtaDownloads.apk(ctx, req, userAsked, progress)
                if (kind == "apk" && result == "ready") {
                    try { notifyListeners("updateReady", JSObject().put("versionCode", req.versionCode), true) } catch (_: Exception) { /* cosmetic */ }
                    notifyApkReady(ctx)
                }
                call.resolve(JSObject().put("result", result))
            } catch (e: Exception) {
                call.resolve(JSObject().put("result", "failed").put("reason", (e as? OtaFailure)?.message ?: "network"))
            }
        }
    }

    /** The owner chose Restart: a new Activity/Bridge serves the staged bundle and owns its ready acknowledgement. */
    @PluginMethod
    fun applyWebNow(call: PluginCall) {
        val host = activity
        if (host == null) {
            call.resolve(JSObject().put("result", "failed"))
            return
        }
        host.runOnUiThread {
            if (host.isFinishing || host.isDestroyed) {
                call.resolve(JSObject().put("result", "failed"))
                return@runOnUiThread
            }
            val result = try { OtaBoot.applyWebNow(context, bridge) } catch (_: Exception) { "failed" }
            call.resolve(JSObject().put("result", result))
            if (result == "started") host.recreate()
        }
    }

    /** An ordinary notice only where the owner has already allowed notifications; tapping opens Vitals. */
    private fun notifyApkReady(ctx: Context) {
        try {
            val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            if (!manager.areNotificationsEnabled()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val channel = "vitals_updates"
            manager.createNotificationChannel(NotificationChannel(channel, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
            val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val tap = PendingIntent.getActivity(ctx, 705, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notice = Notification.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat_vitals)
                .setContentTitle("Vitals update ready")
                .setContentText("Open Vitals to install the update.")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
            manager.notify(705, notice)
        } catch (_: Exception) {
            // A notification is optional; the in-app update state still carries the offer.
        }
    }

    @PluginMethod
    fun install(call: PluginCall) {
        val result = try {
            OtaApk.install(activity ?: context)
        } catch (e: Exception) {
            "failed"
        }
        call.resolve(JSObject().put("result", result))
    }
}
