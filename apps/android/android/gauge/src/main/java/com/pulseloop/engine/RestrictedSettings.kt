package com.pulseloop.engine

import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * (Vitals r071) Android's "restricted settings" (Enhanced Confirmation Mode, Android 13+): an app that reached the phone
 * as a file (the system installer opened on an APK from a file manager, a browser or another app) cannot have its
 * accessibility service switched on until the person allows it in that app's App info (⋮ › Allow restricted settings).
 * That menu item appears only after one denied attempt and asks for the phone's lock. It is a security control: nothing
 * here, or anywhere in Vitals, tries to get around it; the person allows it themselves.
 *
 * There is no public API to ask whether it applies (the SDK has no EnhancedConfirmationManager and no constant for the op).
 * The state is the app op `android:access_restricted_settings`: hidden on Android 13 and 14, a system API on 15+, and a
 * "restricted read": AppOpsService.verifyIncomingOp refuses any caller without MANAGE_APPOPS (from Android 15 also
 * GET_APP_OPS_STATS or MANAGE_APP_OPS_MODES), so on an ordinary phone [opMode] finds nothing. If a build does let the app
 * read it the answer is used. Otherwise the only thing an app can see is how it was installed (InstallSourceInfo, API 33):
 * a LOCAL_FILE or DOWNLOADED_FILE install is the kind Android holds back. That is a hint, not proof: the person may have
 * allowed it since, and an install by another app can be held back too on a phone whose allowlist names trusted installers.
 */
object RestrictedSettings {
    /** The app op that holds the state (`AppOpsManager.OPSTR_ACCESS_RESTRICTED_SETTINGS`, not in the public SDK). */
    const val OP = "android:access_restricted_settings"

    /**
     * Whether Android holds this app's accessibility service back: true when it does or this install is the kind it
     * holds back, false when it does not (or the phone has no such feature), null when the phone does not say.
     */
    fun isRestricted(context: Context): Boolean? = isRestricted(context, ::opMode, ::packageSource)

    /** [readOp] and [readSource] are the two things the phone can tell (tests give them by hand). */
    internal fun isRestricted(context: Context, readOp: (Context) -> Int?, readSource: (Context) -> Int?): Boolean? {
        // restricted settings came with Android 13: before it nothing holds a service back
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return verdict(readOp(context), readSource(context))
    }

    /** [opMode]: the op's raw mode (null: not readable); [packageSource]: how the last install was marked (null: unknown). */
    fun verdict(opMode: Int?, packageSource: Int?): Boolean? = when (opMode) {
        // ERRORED: held back; IGNORED: held back and the person has seen the dialog, so App info offers "Allow"
        AppOpsManager.MODE_ERRORED, AppOpsManager.MODE_IGNORED -> true
        AppOpsManager.MODE_ALLOWED -> false
        // MODE_DEFAULT (Android 16's default for the op) or unreadable: Android decides from how the app was installed
        else -> if (fromFile(packageSource)) true else null
    }

    private fun fromFile(packageSource: Int?) =
        packageSource == PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE || packageSource == PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE

    private fun opMode(context: Context): Int? = try {
        context.getSystemService(AppOpsManager::class.java)?.unsafeCheckOpRawNoThrow(OP, context.applicationInfo.uid, context.packageName)
    } catch (_: RuntimeException) {
        // the expected answer on a normal phone: a SecurityException, reading this op needs a privileged permission
        null
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun packageSource(context: Context): Int? = try {
        context.packageManager.getInstallSourceInfo(context.packageName).packageSource
    } catch (_: Exception) {
        null
    }
}
