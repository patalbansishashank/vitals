package desi.creative.vitals

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.Bridge
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.Properties

/**
 * The web bundle a cold start serves (OtaLogic decides; this persists the state and acts on it). Capacitor's local
 * server hosts either the APK's assets (`public/`) or a folder under files/ota/web/<version>/: MainActivity hands that
 * folder to the bridge builder before the bridge exists, so the WebView's first load is already the right bundle.
 *
 * The decision is made once per process (a cold start); an activity recreated after the WebView's renderer died gets the
 * same bundle. A bundle on trial must call ready() (VitalsUpdates plugin) within 10 s or it is rolled back at once.
 */
object OtaBoot {
    private val lock = Any()
    private var booted = false
    private var state = OtaState()
    private val trialGuard = OtaTrialGuard()
    @Volatile private var bridge: Bridge? = null

    data class Embedded(val version: String, val builtAtMs: Long)

    fun root(ctx: Context): File = File(ctx.filesDir, "ota")
    fun webRoot(ctx: Context): File = File(root(ctx), "web")
    private fun stateFile(ctx: Context) = File(root(ctx), "state.properties")

    fun installedVersionCode(ctx: Context): Int =
        PackageInfoCompat.getLongVersionCode(ctx.packageManager.getPackageInfo(ctx.packageName, 0)).toInt()

    fun installedVersionName(ctx: Context): String = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""

    /** The APK's own bundle: its bundle.json (written by scripts/release/web-bundle.mjs), else the APK's install time. */
    fun embedded(ctx: Context): Embedded {
        try {
            val text = ctx.assets.open("public/bundle.json").bufferedReader().use { it.readText() }
            val info = parseInfo(text)
            if (info != null) return Embedded(info.version, info.builtAtMs)
        } catch (e: Exception) {
            // a build without bundle.json (debug): fall through
        }
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        return Embedded("apk-${pi.versionName}", pi.lastUpdateTime)
    }

    fun parseInfo(text: String): BundleInfo? = try {
        val o = JSONObject(text)
        val version = o.getString("version")
        val min = o.getInt("minNativeVersionCode")
        val builtAt = Instant.parse(o.getString("builtAt")).toEpochMilli()
        if (OtaLogic.isVersion(version) && min >= 0) BundleInfo(version, min, builtAt) else null
    } catch (e: Exception) {
        null
    }

    fun readInfo(ctx: Context, version: String): BundleInfo? {
        if (!OtaLogic.isVersion(version)) return null
        val dir = File(webRoot(ctx), version)
        val json = File(dir, "bundle.json")
        if (!File(dir, "index.html").isFile || !json.isFile) return null
        return try {
            parseInfo(json.readText())
        } catch (e: Exception) {
            null
        }
    }

    private fun load(ctx: Context): OtaState = try {
        stateFile(ctx).takeIf { it.isFile }?.inputStream()?.use { OtaState.fromProperties(Properties().apply { load(it) }) } ?: OtaState()
    } catch (e: Exception) {
        OtaState()
    }

    private fun save(ctx: Context, s: OtaState): Boolean =
        try {
            val file = stateFile(ctx)
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, "state.properties.tmp")
            FileOutputStream(tmp).use {
                s.toProperties().store(it, null)
                it.fd.sync()
            }
            if (tmp.renameTo(file)) true else {
                file.delete()
                tmp.renameTo(file)
            }
        } catch (e: Exception) {
            // the next start decides again from the last saved state
            false
        }

    /** Folders no longer referenced, and leftovers of an interrupted unpack. */
    private fun prune(ctx: Context, s: OtaState) {
        val keep = OtaLogic.keep(s)
        webRoot(ctx).listFiles()?.forEach { if (it.name !in keep) it.deleteRecursively() }
    }

    /** The folder to serve, or null for the APK's own bundle. Decides once per process. */
    fun serverBasePath(ctx: Context): String? = synchronized(lock) {
        if (!booted) {
            booted = true
            try {
                val app = ctx.applicationContext
                val boot = OtaLogic.boot(load(app), installedVersionCode(app), embedded(app).builtAtMs) { readInfo(app, it) }
                state = boot.state
                save(app, state)
                prune(app, state)
                OtaApk.pruneInstalled(app)
            } catch (e: Exception) {
                state = state.copy(current = null)
            }
        }
        state.current?.let { File(webRoot(ctx), it).absolutePath }
    }

    /** After the bridge exists: start the trial's 10 s clock (once per process). */
    fun attach(ctx: Context, b: Bridge) {
        val generation = synchronized(lock) {
            bridge = b
            if (state.current == null || state.confirmed) return
            trialGuard.attach(b)
        }
        val app = ctx.applicationContext
        Handler(Looper.getMainLooper()).postDelayed({ timeout(app, generation) }, OtaLogic.READY_TIMEOUT_MS)
    }

    fun detach(b: Bridge?) {
        synchronized(lock) {
            if (bridge === b) {
                bridge = null
                trialGuard.invalidate()
            }
        }
    }

    /** The web app rendered (VitalsUpdates.ready). */
    fun ready(ctx: Context, b: Bridge?): Boolean = synchronized(lock) {
        if (b == null || bridge !== b || !trialGuard.acceptsReady(b)) return false
        val next = OtaLogic.ready(state)
        if (next != state) {
            if (!save(ctx.applicationContext, next)) return false
            state = next
            trialGuard.invalidate()
        }
        true
    }

    private fun timeout(ctx: Context, generation: Long) {
        val serve: String?
        val b: Bridge
        synchronized(lock) {
            if (!trialGuard.acceptsTimeout(generation) || state.current == null || state.confirmed) return
            state = OtaLogic.rollBack(state)
            save(ctx, state)
            serve = state.current
            trialGuard.invalidate()
            b = bridge ?: return
        }
        if (serve == null) b.setServerAssetPath("public") else b.setServerBasePath(File(webRoot(ctx), serve).absolutePath)
    }

    fun snapshot(): OtaState = synchronized(lock) { state }

    private fun nextPending(ctx: Context): OtaState? = OtaLogic.activatePending(
        state, installedVersionCode(ctx), embedded(ctx).builtAtMs,
    ) { readInfo(ctx, it) }

    /** Persist the one-launch trial before MainActivity creates a new Bridge for the pending bundle. */
    fun applyWebNow(ctx: Context, caller: Bridge?): String = synchronized(lock) {
        if (caller == null || bridge !== caller) return "busy"
        val next = nextPending(ctx) ?: return if (state.pending == null) "none" else "busy"
        if (!save(ctx.applicationContext, next)) return "failed"
        state = next
        trialGuard.invalidate() // the old page cannot confirm the new trial before recreation
        "started"
    }

    /** A verified, unpacked bundle: serve it from the next cold start. Returns why not, or null. */
    fun stage(ctx: Context, advertised: String, info: BundleInfo): String? = synchronized(lock) {
        val why = OtaLogic.acceptable(state, advertised, info, installedVersionCode(ctx), embedded(ctx).builtAtMs)
        if (why != null) return why
        val old = state.pending
        val next = state.copy(pending = advertised)
        if (!save(ctx.applicationContext, next)) return "could not save update state"
        state = next
        if (old != null && old !in OtaLogic.keep(state)) File(webRoot(ctx), old).deleteRecursively()
        null
    }

    fun wanted(version: String): Boolean = synchronized(lock) { OtaLogic.wanted(state, version) }
}
