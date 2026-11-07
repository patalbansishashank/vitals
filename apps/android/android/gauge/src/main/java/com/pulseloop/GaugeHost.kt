package com.pulseloop

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build

/**
 * (Vitals 0.7.0) What the engine needs from the app it runs in. Gauge was its own app: its `BuildConfig` named the app,
 * its `MainActivity` was what a notification opened. Inside Vitals the engine is a library, so both come from the host
 * app's package here, read once and cached.
 */
object GaugeHost {
    @Volatile private var info: Info? = null

    data class Info(val versionName: String, val versionCode: Long, val debug: Boolean, val applicationId: String)

    fun info(context: Context): Info = info ?: run {
        val app = context.applicationContext
        val pkg = try {
            @Suppress("DEPRECATION")
            app.packageManager.getPackageInfo(app.packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }
        val code = when {
            pkg == null -> 0L
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> pkg.longVersionCode
            else -> @Suppress("DEPRECATION") pkg.versionCode.toLong()
        }
        Info(
            versionName = pkg?.versionName ?: "0",
            versionCode = code,
            debug = (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
            applicationId = app.packageName,
        ).also { info = it }
    }

    fun versionName(context: Context): String = info(context).versionName

    /** What a notification opens: the host app's launcher activity, brought to the front. */
    fun launchIntent(context: Context): Intent =
        (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent().setPackage(context.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
