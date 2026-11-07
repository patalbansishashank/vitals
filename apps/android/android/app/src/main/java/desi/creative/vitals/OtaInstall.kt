package desi.creative.vitals

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.IntentSender
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * (r071) Installs the downloaded APK through a PackageInstaller session, the way an app store does, instead of handing
 * the file to the system installer with ACTION_VIEW.
 *
 * Why: the system installer opened on a file marks the install as coming from a local file, and on Android 13+ that keeps
 * an app's accessibility service (the short-video counter) switched off until the owner allows it in App info; on Android
 * 13 and 14 it puts that hold back on every update too. A session install makes no such claim about its source (the
 * installer says nothing, as the platform's own default). It does not lift a hold that is already there, and a phone whose
 * allowlist names trusted installers may hold back an install by any other app (see
 * [com.pulseloop.engine.RestrictedSettings]); the owner still allows restricted settings themselves.
 *
 * Nothing is silent: the session asks for user action, so the system shows its own confirmation before anything is
 * replaced, and [OtaApk.install] checks Android's "install unknown apps" permission for Vitals first.
 */
object OtaInstall {
    /** The system reports the session's progress to this action, sent to this app only. */
    const val ACTION_STATUS = "desi.creative.vitals.OTA_INSTALL_STATUS"
    private const val EXTRA_SESSION = "desi.creative.vitals.extra.OTA_SESSION"
    private const val TAG = "OtaInstall"
    private const val NAME = "base.apk"
    private val staging = AtomicBoolean(false)
    private var receiver: BroadcastReceiver? = null

    /** The session being installed; a status from any other (an earlier try that was abandoned) is not this one's. */
    @Volatile private var current = -1

    /** What a status from the session means for the app. */
    sealed interface Outcome {
        /** The system wants the owner's OK: its own confirmation screen comes next. */
        data object Confirm : Outcome

        /** Installed (this app is replaced, so the process rarely lives to hear it). */
        data object Installed : Outcome

        /** Not installed; [cancelled] means the owner said no, which needs no message. */
        data class Failed(val reason: String, val cancelled: Boolean = false) : Outcome
    }

    fun outcome(status: Int): Outcome = when (status) {
        PackageInstaller.STATUS_PENDING_USER_ACTION -> Outcome.Confirm
        PackageInstaller.STATUS_SUCCESS -> Outcome.Installed
        PackageInstaller.STATUS_FAILURE_ABORTED -> Outcome.Failed("The install was cancelled.", cancelled = true)
        PackageInstaller.STATUS_FAILURE_BLOCKED -> Outcome.Failed("Android blocked the install.")
        PackageInstaller.STATUS_FAILURE_CONFLICT -> Outcome.Failed("The update conflicts with the Vitals on the phone.")
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> Outcome.Failed("The update does not fit this phone.")
        PackageInstaller.STATUS_FAILURE_INVALID -> Outcome.Failed("The update file is not valid.")
        PackageInstaller.STATUS_FAILURE_STORAGE -> Outcome.Failed("There is not enough space on the phone.")
        PackageInstaller.STATUS_FAILURE_TIMEOUT -> Outcome.Failed("The install took too long.")
        else -> Outcome.Failed("Android could not install it.")
    }

    /**
     * Writes [apk] into a new session (its staging progress follows the copy) and commits it; the system's answer comes to
     * [onStatus]. Returns false when another try is still being staged. Whatever fails here leaves no session behind.
     */
    fun start(ctx: Context, apk: File): Boolean {
        val size = apk.length()
        if (size <= 0) throw OtaFailure("empty update")
        if (!staging.compareAndSet(false, true)) return false
        val app = ctx.applicationContext
        val installer = app.packageManager.packageInstaller
        var id = -1
        try {
            // an earlier try that was never finished (the owner walked away from the confirmation) is not kept
            installer.mySessions.forEach { runCatching { installer.abandonSession(it.sessionId) } }
            id = installer.createSession(params(app, size))
            current = id
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite(NAME, 0, size).use { out ->
                        copy(input, out, size) { share ->
                            // cosmetic: a progress that cannot be reported is never worth failing the install
                            try {
                                session.setStagingProgress(share)
                            } catch (_: Exception) {
                            }
                        }
                        session.fsync(out)
                    }
                }
                listen(app)
                session.commit(statusSender(app, id))
            }
            return true
        } catch (e: Exception) {
            if (id >= 0) runCatching { installer.abandonSession(id) }
            stopListening(app)
            throw e
        } finally {
            staging.set(false)
        }
    }

    internal fun params(app: Context, size: Long) =
        PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(app.packageName)
            setSize(size)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setInstallReason(PackageManager.INSTALL_REASON_USER)
            // always the system's own confirmation, even where Android would let an updater skip it (12+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }

    /** Copies in 64 KiB steps and reports the share done (0 to 1) about every 5 %, ending on 1. */
    internal fun copy(input: InputStream, out: OutputStream, total: Long, progress: (Float) -> Unit) {
        val buf = ByteArray(64 * 1024)
        var done = 0L
        var step = -1
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            done += n
            val now = (done * 20 / total).toInt()
            if (now != step) {
                step = now
                progress(done.toFloat() / total)
            }
        }
    }

    /** The session reports to a receiver registered in code (the manifest keeps no receiver of its own, see ManifestPrivacyTest). */
    private fun statusSender(app: Context, sessionId: Int): IntentSender {
        // Explicit (this package) and mutable: the system adds the status and the confirmation to the intent it sends.
        val intent = Intent(ACTION_STATUS).setPackage(app.packageName).putExtra(EXTRA_SESSION, sessionId)
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        return PendingIntent.getBroadcast(app, sessionId, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable).intentSender
    }

    @Synchronized
    private fun listen(app: Context) {
        if (receiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = onStatus(context, intent)
        }
        ContextCompat.registerReceiver(app, r, IntentFilter(ACTION_STATUS), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
    }

    @Synchronized
    internal fun stopListening(app: Context) {
        receiver?.let { runCatching { app.unregisterReceiver(it) } }
        receiver = null
        current = -1
    }

    /** The session's status: open the system's confirmation, or say why nothing was installed (a toast; the update stays ready to retry). */
    internal fun onStatus(context: Context, intent: Intent) {
        val app = context.applicationContext
        // an abandoned earlier try reports too, and must not end this one's listening
        if (intent.getIntExtra(EXTRA_SESSION, current) != current) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (val o = outcome(status)) {
            Outcome.Confirm -> confirm(app, intent)
            Outcome.Installed -> stopListening(app)
            is Outcome.Failed -> {
                stopListening(app)
                Log.w(TAG, "not installed: status $status ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()}")
                if (!o.cancelled) tell(app, o.reason)
            }
        }
    }

    private fun confirm(app: Context, status: Intent) {
        val next = IntentCompat.getParcelableExtra(status, Intent.EXTRA_INTENT, Intent::class.java)
        try {
            if (next == null) throw OtaFailure("no confirmation")
            app.startActivity(next.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            Log.w(TAG, "the confirmation did not open: ${e.message}")
            stopListening(app)
            tell(app, "The confirmation did not open. Tap Install again.")
        }
    }

    private fun tell(app: Context, why: String) =
        Toast.makeText(app, "Vitals was not updated. $why", Toast.LENGTH_LONG).show()
}
