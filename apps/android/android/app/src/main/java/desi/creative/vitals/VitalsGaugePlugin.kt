package desi.creative.vitals

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.time.Instant
import com.pulseloop.GaugeEngine
import com.pulseloop.hub.HubSync
import com.pulseloop.vitals.VitalsLocalSnapshot
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The `VitalsGauge` plugin (web side: src/platform/gaugeLocal.ts; energy SPEC §A.4 item 10): Gauge's workout control
 * on this phone. An explicit ordered broadcast to `<package>/com.pulseloop.ui.tile.WorkoutControlReceiver` (Gauge's
 * package GB API), holding `<package>.permission.CONTROL_WORKOUT` (protection level dangerous, requested at runtime).
 * The result receiver is created in code, never declared in the manifest. Results are mapped to the same ack shape as
 * the server channel ([GaugeWorkoutAck]), so callers see the transport only as `via`.
 *
 * Methods: `info()`, `requestPermission()`, `workout({ command, type?, useGps?, sessionId?, timeoutMs })` →
 * `{ status: done | rejected | failed | noop | timeout, code?, result? }`. No answer in time, or a broadcast no Gauge
 * receiver answered, is `timeout`: the web side then asks the status once and falls back to the server.
 * `fixGps({ warning? })` (r063 FX3, S20): after a start that fell back to no GPS, opens Gauge on its location prompt
 * (explicit `com.pulseloop.action.GRANT_LOCATION` to `<package>/com.pulseloop.MainActivity`, Gauge 2.8.1), or the phone's
 * location settings when location is switched off → `{ opened }`.
 * `local({ method: snapshot | flush })` (r069 sync, web side `readGaugeLocal` / `flushGaugeLocal`): Gauge's own state on
 * this phone through its `<package>.vitals` provider (Gauge 2.8.7 `VitalsLocalProvider`) → `{ json }` or `{ error }`.
 * Only a Gauge signed with the owner's pinned certificate is asked, and only when that package owns the provider; Gauge
 * in turn answers only this app's release signature ([GaugeLocalData]).
 */
@CapacitorPlugin(
    name = "VitalsGauge",
    permissions = [
        Permission(alias = GaugeWorkoutAck.ALIAS_RELEASE, strings = ["com.pulseloop.permission.CONTROL_WORKOUT"]),
        Permission(alias = GaugeWorkoutAck.ALIAS_DEBUG, strings = ["com.pulseloop.debug.permission.CONTROL_WORKOUT"]),
    ],
)
class VitalsGaugePlugin : Plugin() {

    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun installed(): List<String> = GaugeProviderClient.installed(context)

    private fun debuggable(): Boolean = GaugeProviderClient.debuggable(context)

    /** (0.7.0) The engine inside this app answers for Gauge once it has taken over: Gauge itself is gone by then. */
    private fun embedded(): Boolean = GaugeEngine.isActive(context)

    private fun target(): String? {
        if (embedded()) return context.packageName
        val present = installed().toSet()
        // (0.6.3) the owner's Gauge ships debug-signed: a release Vitals trusts com.pulseloop.debug only with that signer
        val trustedDebug = GaugeWorkoutAck.DEBUG in present && GaugeWorkoutAck.isTrustedDebugSigner(GaugeProviderClient.signerDigests(context, GaugeWorkoutAck.DEBUG))
        return GaugeWorkoutAck.choosePackage(present, debuggable(), trustedDebug)
    }

    private fun granted(pkg: String): Boolean =
        pkg == context.packageName ||
            ContextCompat.checkSelfPermission(context, GaugeWorkoutAck.permission(pkg)) == PackageManager.PERMISSION_GRANTED

    private fun info(): JSObject {
        val pkg = target()
        return JSObject()
            .put("package", pkg)
            .put("installed", JSArray(if (embedded()) listOf(context.packageName) else installed()))
            .put("embedded", embedded())
            .put("granted", pkg != null && granted(pkg))
    }

    @PluginMethod
    fun info(call: PluginCall) {
        call.resolve(info())
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val pkg = target()
        if (pkg == null || granted(pkg)) {
            call.resolve(info())
            return
        }
        requestPermissionForAlias(GaugeWorkoutAck.aliasFor(pkg), call, "onPermission")
    }

    @PermissionCallback
    private fun onPermission(call: PluginCall) {
        val pkg = target()
        val state = pkg?.let { getPermissionState(GaugeWorkoutAck.aliasFor(it)) }
        call.resolve(info().put("granted", state == PermissionState.GRANTED || (pkg != null && granted(pkg))))
    }

    @PluginMethod
    fun workout(call: PluginCall) {
        val command = call.getString("command")
        val timeoutMs = (call.getInt("timeoutMs") ?: 5000).toLong().coerceIn(200, 30_000)
        val pkg = target()
        if (command == null || command !in GaugeWorkoutAck.COMMANDS) {
            call.reject("unknown command", "invalid")
            return
        }
        if (pkg == null || !granted(pkg)) {
            call.resolve(GaugeWorkoutAck.TIMEOUT.toJs())
            return
        }
        val asked = call.getString("sessionId")
        if (command == "workout.status") {
            send(pkg, GaugeWorkoutAck.ACTION_STATUS, null, timeoutMs) { reply ->
                call.resolve((reply?.let { GaugeWorkoutAck.status(it) } ?: GaugeWorkoutAck.TIMEOUT).toJs())
            }
            return
        }
        if (command == "workout.start") {
            send(pkg, GaugeWorkoutAck.ACTION_START, { intent ->
                intent.putExtra(GaugeWorkoutAck.EXTRA_TYPE, call.getString("type") ?: "walk")
                intent.putExtra(GaugeWorkoutAck.EXTRA_USE_GPS, call.getBoolean("useGps", false) == true)
                // 0.6.3 S26: the catalogue activity (Gauge 2.8.1+ keeps it; an older Gauge ignores the extra)
                call.getString("activityTypeId")?.takeIf { GaugeWorkoutAck.ACTIVITY_TYPE_ID.matches(it) }?.let {
                    intent.putExtra(GaugeWorkoutAck.EXTRA_ACTIVITY_TYPE_ID, it)
                }
            }, timeoutMs) { reply ->
                call.resolve((reply?.let { GaugeWorkoutAck.map(command, it, null) } ?: GaugeWorkoutAck.TIMEOUT).toJs())
            }
            return
        }
        // pause, resume, stop: the status first (a sessionId must be the active one; a stop reports the ended id)
        send(pkg, GaugeWorkoutAck.ACTION_STATUS, null, timeoutMs) { before ->
            if (before == null) {
                call.resolve(GaugeWorkoutAck.TIMEOUT.toJs())
                return@send
            }
            if (GaugeWorkoutAck.wrongWorkout(asked, before)) {
                call.resolve(GaugeWorkoutAck.Ack("rejected", "wrong_workout", GaugeWorkoutAck.sessionResult(before)).toJs())
                return@send
            }
            send(pkg, GaugeWorkoutAck.actionOf(command), null, timeoutMs) { reply ->
                call.resolve((reply?.let { GaugeWorkoutAck.map(command, it, before.sessionId) } ?: GaugeWorkoutAck.TIMEOUT).toJs())
            }
        }
    }

    /** r063 FX3 (S20): the action behind "Recording without GPS". Only on the person's tap. */
    @PluginMethod
    fun fixGps(call: PluginCall) {
        val fix = GaugeWorkoutAck.gpsFixFor(call.getString("warning"))
        val pkg = installed().let { GaugeWorkoutAck.choosePackage(it.toSet(), debuggable()) }
        val intent = when {
            fix == GaugeWorkoutAck.GpsFix.LOCATION_SETTINGS -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            pkg != null -> Intent(GaugeWorkoutAck.ACTION_GRANT_LOCATION).setClassName(pkg, GaugeWorkoutAck.MAIN_ACTIVITY)
            // (0.7.0) the engine is in this app: its location grant is this app's own
            embedded() -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            else -> null
        }
        if (intent == null) {
            call.resolve(JSObject().put("opened", false))
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val opened = try {
            (activity ?: context).startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
        call.resolve(JSObject().put("opened", opened))
    }

    /**
     * (r069 sync) Gauge's data on this phone (see the class comment). Runs on Capacitor's plugin thread: the provider
     * call is a synchronous binder call into Gauge, which bounds its own work.
     */
    @PluginMethod
    fun local(call: PluginCall) {
        val method = call.getString("method")
        if (method == null || method !in GaugeLocalData.METHODS) {
            call.reject("unknown method", "invalid")
            return
        }
        if (embedded()) {
            // (0.7.0) the engine is in this process: its own snapshot, no provider call
            scope.launch {
                if (method == GaugeLocalData.METHOD_FLUSH) HubSync.flushNow(context)
                val json = runCatching { VitalsLocalSnapshot.read(context) }.getOrNull()
                call.resolve(if (json != null) JSObject().put("json", json) else JSObject().put("error", "failed"))
            }
            return
        }
        val answer = GaugeProviderClient.call(context, method)
        call.resolve(if (answer.json != null) JSObject().put("json", answer.json) else JSObject().put("error", answer.error))
    }

    /** One ordered broadcast; [done] runs once on the main thread with Gauge's reply, or null on timeout or no receiver. */
    private fun send(pkg: String, action: String, extras: ((Intent) -> Unit)?, timeoutMs: Long, done: (GaugeWorkoutAck.Reply?) -> Unit) {
        val finished = AtomicBoolean(false)
        val timeout = Runnable { if (finished.compareAndSet(false, true)) done(null) }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (!finished.compareAndSet(false, true)) return
                main.removeCallbacks(timeout)
                val ex = getResultExtras(true)
                done(
                    GaugeWorkoutAck.reply(
                        code = resultCode,
                        state = ex.getString(GaugeWorkoutAck.EXTRA_STATE),
                        sessionId = ex.getString(GaugeWorkoutAck.EXTRA_SESSION_ID),
                        type = ex.getString(GaugeWorkoutAck.EXTRA_TYPE),
                        startedAt = ex.getLong(GaugeWorkoutAck.EXTRA_STARTED_AT, 0L).takeIf { it > 0 },
                        error = ex.getString(GaugeWorkoutAck.EXTRA_ERROR),
                        // r063 FX3 (S20): a start that asked for GPS reports the outcome (Gauge 2.8.1)
                        gps = ex.getString(GaugeWorkoutAck.EXTRA_GPS),
                        warning = ex.getString(GaugeWorkoutAck.EXTRA_WARNING),
                    ),
                )
            }
        }
        val intent = Intent(action).setClassName(pkg, GaugeWorkoutAck.RECEIVER_CLASS)
        extras?.invoke(intent)
        try {
            context.sendOrderedBroadcast(intent, null, receiver, main, GaugeWorkoutAck.NO_ANSWER, null, null)
        } catch (_: SecurityException) {
            if (finished.compareAndSet(false, true)) done(null)
            return
        }
        main.postDelayed(timeout, timeoutMs)
    }
}

/**
 * Talking to the Gauge app that is installed: which packages are there, who signed them, and its `<package>.vitals`
 * provider (only a Gauge signed with the owner's pinned certificate is asked, and only when that package owns the
 * provider). Used by [VitalsGaugePlugin] and by the engine plugin's `gauge.pendingUploads`.
 */
object GaugeProviderClient {
    data class Answer(val json: String?, val error: String?)

    fun installed(context: Context): List<String> = GaugeWorkoutAck.PACKAGES.filter { pkg ->
        try {
            context.packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    fun debuggable(context: Context): Boolean = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /** The SHA-256 digests of a package's signing certificates (lower-case hex); empty when it can't be read. */
    @Suppress("DEPRECATION")
    fun signerDigests(context: Context, pkg: String): Set<String> = try {
        val pm = context.packageManager
        val certs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
            when {
                info == null -> emptyArray()
                info.hasMultipleSigners() -> info.apkContentsSigners
                else -> info.signingCertificateHistory
            }
        } else {
            pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures ?: emptyArray()
        }
        certs.map { GaugeWorkoutAck.sha256Hex(it.toByteArray()) }.toSet()
    } catch (_: Exception) {
        emptySet()
    }

    /** A synchronous binder call into Gauge, which bounds its own work: not for the main thread. */
    fun call(context: Context, method: String): Answer {
        val present = installed(context).toSet()
        val pkg = GaugeLocalData.choosePackage(present, debuggable(context)) { GaugeWorkoutAck.isTrustedDebugSigner(signerDigests(context, it)) }
            ?: return Answer(null, "no_gauge")
        val authority = GaugeLocalData.authority(pkg)
        // an older Gauge has no provider; any other package claiming the authority is never asked
        val owner = try {
            context.packageManager.resolveContentProvider(authority, 0)?.packageName
        } catch (_: Exception) {
            null
        }
        if (owner != pkg) return Answer(null, "no_provider")
        val answer = try {
            context.contentResolver.call(Uri.parse("content://$authority"), method, null, null)
        } catch (_: SecurityException) {
            return Answer(null, "refused")
        } catch (_: Exception) {
            return Answer(null, "failed")
        }
        val json = answer?.getString(GaugeLocalData.KEY_JSON)
        return if (json != null && json.length <= GaugeLocalData.MAX_JSON) Answer(json, null) else Answer(null, "empty")
    }
}

/**
 * Gauge's broadcast API (its `ui/tile/WorkoutControl`) and the mapping of its results to the command channel's ack
 * (energy SPEC §A.4 item 9). Pure: unit-tested without Android.
 */
object GaugeWorkoutAck {
    const val RELEASE = "com.pulseloop"
    const val DEBUG = "com.pulseloop.debug"
    val PACKAGES = listOf(RELEASE, DEBUG)
    const val ALIAS_RELEASE = "gauge"
    const val ALIAS_DEBUG = "gaugeDebug"
    const val RECEIVER_CLASS = "com.pulseloop.ui.tile.WorkoutControlReceiver"
    const val ACTION_START = "com.pulseloop.action.WORKOUT_START"
    const val ACTION_PAUSE = "com.pulseloop.action.WORKOUT_PAUSE"
    const val ACTION_RESUME = "com.pulseloop.action.WORKOUT_RESUME"
    const val ACTION_STOP = "com.pulseloop.action.WORKOUT_STOP"
    const val ACTION_STATUS = "com.pulseloop.action.WORKOUT_STATUS"
    const val EXTRA_TYPE = "type"
    const val EXTRA_USE_GPS = "use_gps"
    const val EXTRA_ACTIVITY_TYPE_ID = "activity_type_id"
    /** Gauge's catalogue id shape (`RecordingActivityType.isValidId`). */
    val ACTIVITY_TYPE_ID = Regex("^[a-z0-9][a-z0-9_]{0,47}$")
    const val EXTRA_STATE = "state"
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_STARTED_AT = "started_at"
    const val EXTRA_ERROR = "error"
    /** Gauge 2.8.1: a start with `use_gps` reports `gps` (`on` | `off`) and, when off, `warning` naming why. */
    const val EXTRA_GPS = "gps"
    const val EXTRA_WARNING = "warning"
    /** Gauge 2.8.1: opens Gauge on its GPS location prompt (explicit intent to [MAIN_ACTIVITY]). */
    const val ACTION_GRANT_LOCATION = "com.pulseloop.action.GRANT_LOCATION"
    const val MAIN_ACTIVITY = "com.pulseloop.MainActivity"
    const val RESULT_OK = -1
    const val RESULT_ERROR = 1
    /** The initial result code: still this at the end means no Gauge receiver answered. */
    const val NO_ANSWER = 0
    val COMMANDS = setOf("workout.start", "workout.pause", "workout.resume", "workout.stop", "workout.status")

    data class Reply(val code: Int, val state: String, val sessionId: String?, val type: String?, val startedAt: Long?, val error: String?, val gps: String? = null, val warning: String? = null)

    /** What fixes a start that fell back to no GPS. */
    enum class GpsFix { GAUGE_PERMISSION, LOCATION_SETTINGS }

    /** Phone location off is the phone's switch (Gauge never changes it); every other reason is Gauge's location grant. */
    fun gpsFixFor(warning: String?): GpsFix = if (warning == "gps_location_off") GpsFix.LOCATION_SETTINGS else GpsFix.GAUGE_PERMISSION

    data class Ack(val status: String, val code: String? = null, val result: Map<String, Any?> = emptyMap()) {
        fun toJs(): JSObject {
            val out = JSObject().put("status", status)
            code?.let { out.put("code", it) }
            if (result.isNotEmpty()) {
                val r = JSObject()
                for ((k, v) in result) r.put(k, v)
                out.put("result", r)
            }
            return out
        }
    }

    val TIMEOUT = Ack("timeout")

    fun permission(pkg: String) = "$pkg.permission.CONTROL_WORKOUT"
    fun aliasFor(pkg: String) = if (pkg == DEBUG) ALIAS_DEBUG else ALIAS_RELEASE

    /** The release Gauge; a Vitals debug build prefers the `.debug` Gauge when it is installed. */
    /**
     * The Gauge to talk to: the debug package from a debuggable Vitals, else the release package, else (0.6.3) the debug
     * package when its signer is the owner's pinned Gauge certificate (`trustedDebug`), never any other debug build.
     */
    fun choosePackage(installed: Set<String>, debuggable: Boolean, trustedDebug: Boolean = false): String? = when {
        debuggable && DEBUG in installed -> DEBUG
        RELEASE in installed -> RELEASE
        trustedDebug && DEBUG in installed -> DEBUG
        else -> null
    }

    /** SHA-256 of the owner's Gauge signing certificate (the debug keystore Gauge is built with; `apksigner --print-certs`). */
    const val TRUSTED_DEBUG_SIGNER = "28ec68320b488c7d9b46f56add623e03e61eb1412340d8f1f940b5ba2c40c663"

    fun isTrustedDebugSigner(digests: Set<String>): Boolean = digests.isNotEmpty() && digests.all { it == TRUSTED_DEBUG_SIGNER }

    fun sha256Hex(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun actionOf(command: String): String = when (command) {
        "workout.start" -> ACTION_START
        "workout.pause" -> ACTION_PAUSE
        "workout.resume" -> ACTION_RESUME
        "workout.stop" -> ACTION_STOP
        else -> ACTION_STATUS
    }

    /** Null when no Gauge receiver set a result (the code is still [NO_ANSWER]). */
    fun reply(code: Int, state: String?, sessionId: String?, type: String?, startedAt: Long?, error: String?, gps: String? = null, warning: String? = null): Reply? {
        if (code != RESULT_OK && code != RESULT_ERROR) return null
        return Reply(code, state ?: "idle", sessionId, type, startedAt, error, gps, warning)
    }

    fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

    fun sessionResult(r: Reply): Map<String, Any?> = buildMap {
        put("state", r.state)
        r.sessionId?.let { put("sessionId", it) }
        r.type?.let { put("type", it) }
        r.startedAt?.let { put("startedAt", iso(it)) }
    }

    fun status(r: Reply): Ack = Ack("done", null, sessionResult(r))

    /** A sessionId that is not the active recording's (a late command must never touch a newer workout). */
    fun wrongWorkout(asked: String?, before: Reply): Boolean = asked != null && before.sessionId != null && before.sessionId != asked

    /** Gauge's result for [command] as the channel's ack; [endedSessionId] is the status just before a stop. */
    fun map(command: String, r: Reply, endedSessionId: String?): Ack {
        val ok = r.code == RESULT_OK
        val e = r.error
        return when (command) {
            "workout.start" -> when {
                // r063 FX3 (S20): the GPS outcome rides on the ack, as on the server channel
                ok -> Ack("done", null, sessionResult(r) + buildMap { r.gps?.let { put("gps", it) }; r.warning?.let { put("warning", it) } })
                e == "already_recording" -> Ack("rejected", e, sessionResult(r))
                e == "bad_type" -> Ack("rejected", e)
                else -> Ack("failed", e ?: "failed")
            }
            "workout.pause" -> when {
                ok -> Ack("done", null, mapOf("state" to "paused"))
                e == "not_recording" && r.state == "paused" -> Ack("noop", null, mapOf("state" to "paused"))
                e == "no_active_workout" -> Ack("rejected", e)
                else -> Ack("failed", e ?: "failed")
            }
            "workout.resume" -> when {
                ok -> Ack("done", null, mapOf("state" to "recording"))
                e == "not_paused" && r.state == "recording" -> Ack("noop", null, mapOf("state" to "recording"))
                e == "no_active_workout" -> Ack("rejected", e)
                else -> Ack("failed", e ?: "failed")
            }
            "workout.stop" -> when {
                ok -> Ack("done", null, buildMap { put("state", "idle"); endedSessionId?.let { put("sessionId", it) } })
                e == "no_active_workout" -> Ack("noop", null, mapOf("state" to "idle"))
                else -> Ack("failed", e ?: "failed")
            }
            else -> status(r)
        }
    }
}

/**
 * (r069 sync) Gauge's local data provider (Gauge 2.8.7 `VitalsLocalProvider`): its authority, its methods and which Gauge
 * may be asked. Health data only from a Gauge signed with the owner's pinned certificate, release or debug package alike.
 * Pure: unit-tested without Android.
 */
object GaugeLocalData {
    const val METHOD_SNAPSHOT = "snapshot"
    const val METHOD_FLUSH = "flush"
    val METHODS = setOf(METHOD_SNAPSHOT, METHOD_FLUSH)
    const val KEY_JSON = "json"
    /** A snapshot is a few hundred bytes; anything far larger is not one. */
    const val MAX_JSON = 16_384

    fun authority(pkg: String) = "$pkg.vitals"

    /** The debug package from a debuggable Vitals, else the release one, else the debug one; each only when [trusted]. */
    fun choosePackage(installed: Set<String>, debuggable: Boolean, trusted: (String) -> Boolean): String? {
        val order = if (debuggable) listOf(GaugeWorkoutAck.DEBUG, GaugeWorkoutAck.RELEASE) else listOf(GaugeWorkoutAck.RELEASE, GaugeWorkoutAck.DEBUG)
        return order.firstOrNull { it in installed && trusted(it) }
    }
}
