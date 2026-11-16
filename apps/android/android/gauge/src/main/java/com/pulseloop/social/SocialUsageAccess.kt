package com.pulseloop.social

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings

/**
 * Whether this app holds Usage access, and the system screen that grants it (SPEC social-time). The grant is checked
 * through [AppOpsManager] (`OPSTR_GET_USAGE_STATS` == `MODE_ALLOWED`); it is never requested silently. The web layer
 * shows the disclosure and asks, and the plugin opens [settingsIntent] so the person turns it on themselves.
 */
object SocialUsageAccess {

    /** True when Usage access is granted to this app. */
    fun isGranted(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
        val mode = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
            }
        } catch (_: RuntimeException) {
            return false
        }
        return when (mode) {
            AppOpsManager.MODE_ALLOWED -> true
            // Some devices leave the op at its default and gate on the permission grant instead.
            AppOpsManager.MODE_DEFAULT ->
                context.checkPermission(PERMISSION, Process.myPid(), Process.myUid()) == PackageManager.PERMISSION_GRANTED
            else -> false
        }
    }

    /**
     * The system Usage-access list, deep-linked to this app where the OS honours it (it usually opens the full list).
     * Carries [Intent.FLAG_ACTIVITY_NEW_TASK] so it can be launched from a non-activity context.
     */
    fun settingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    const val PERMISSION = "android.permission.PACKAGE_USAGE_STATS"
}
