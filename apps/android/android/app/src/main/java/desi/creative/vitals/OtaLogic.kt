package desi.creative.vitals

import java.util.Properties

/**
 * Over-the-air web bundles (vitals-research/ota/CONTRACT.md "Web bundle format"): which bundle a cold start serves, the
 * one-launch trial of a new bundle, and rollback. Pure state, no Android: OtaBoot persists it and acts on the result.
 *
 * - The bundle inside the APK is the floor (`current == null`). A downloaded, verified bundle waits as `pending` and
 *   becomes `current` on the next cold start, unconfirmed.
 * - An unconfirmed bundle gets one launch: it must call `ready()` within 10 s. If it does not (the timer fires, or the
 *   process dies first and the next start finds it still unconfirmed), it is marked bad for good and the app goes back
 *   to `previous`, the last confirmed bundle (or the APK's own).
 * - A new APK resets to its own bundle unless a downloaded one is newer (built later) and still compatible.
 */
data class OtaState(
    /** The APK versionCode the state was last booted with (0: never). */
    val nativeVersionCode: Int = 0,
    /** The downloaded bundle being served; null serves the APK's own. */
    val current: String? = null,
    /** `current` called ready() at least once. */
    val confirmed: Boolean = true,
    /** `current` is unconfirmed and already had its one launch. */
    val tried: Boolean = false,
    /** The last confirmed bundle, kept to roll back to; null is the APK's own. */
    val previous: String? = null,
    /** Downloaded and verified, served from the next cold start. */
    val pending: String? = null,
    /** Versions that failed their trial: never served or downloaded again. */
    val bad: Set<String> = emptySet(),
) {
    fun toProperties(): Properties = Properties().apply {
        setProperty("nativeVersionCode", nativeVersionCode.toString())
        current?.let { setProperty("current", it) }
        setProperty("confirmed", confirmed.toString())
        setProperty("tried", tried.toString())
        previous?.let { setProperty("previous", it) }
        pending?.let { setProperty("pending", it) }
        setProperty("bad", bad.sorted().joinToString(","))
    }

    companion object {
        fun fromProperties(p: Properties): OtaState = OtaState(
            nativeVersionCode = p.getProperty("nativeVersionCode")?.toIntOrNull() ?: 0,
            current = p.getProperty("current")?.takeIf { OtaLogic.isVersion(it) },
            confirmed = p.getProperty("confirmed") != "false",
            tried = p.getProperty("tried") == "true",
            previous = p.getProperty("previous")?.takeIf { OtaLogic.isVersion(it) },
            pending = p.getProperty("pending")?.takeIf { OtaLogic.isVersion(it) },
            bad = p.getProperty("bad").orEmpty().split(',').filter { OtaLogic.isVersion(it) }.toSet(),
        )
    }
}

/** A downloaded bundle's bundle.json. */
data class BundleInfo(val version: String, val minNativeVersionCode: Int, val builtAtMs: Long)

object OtaLogic {
    const val READY_TIMEOUT_MS = 10_000L
    private val VERSION = Regex("^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$")

    /** A version string that is safe as a folder name. */
    fun isVersion(v: String?): Boolean = v != null && VERSION.matches(v)

    data class Boot(val state: OtaState, val serve: String?, val trial: Boolean)

    /**
     * The cold-start decision. `info` reads a downloaded bundle's bundle.json (null: missing or unreadable);
     * `embeddedBuiltAtMs` is when the APK's own bundle was built.
     */
    fun boot(state: OtaState, installedVersionCode: Int, embeddedBuiltAtMs: Long, info: (String) -> BundleInfo?): Boot {
        var s = state
        fun usable(v: String?): Boolean {
            if (v == null || v in s.bad) return false
            val i = info(v) ?: return false
            return i.version == v && i.minNativeVersionCode <= installedVersionCode
        }
        fun newerThanApk(v: String?): Boolean = usable(v) && info(v!!)!!.builtAtMs > embeddedBuiltAtMs

        if (s.nativeVersionCode != installedVersionCode) {
            // A new APK (or the first start): its own bundle unless a downloaded one is newer.
            val keepCurrent = s.current != null && newerThanApk(s.current)
            s = s.copy(
                nativeVersionCode = installedVersionCode,
                current = if (keepCurrent) s.current else null,
                confirmed = if (keepCurrent) s.confirmed else true,
                tried = if (keepCurrent) s.tried else false,
                previous = if (newerThanApk(s.previous)) s.previous else null,
                pending = if (newerThanApk(s.pending)) s.pending else null,
            )
        }
        if (s.previous != null && !usable(s.previous)) s = s.copy(previous = null)
        if (s.current != null && !usable(s.current)) {
            // The folder went missing or broke: back to the last good one.
            s = s.copy(current = s.previous, confirmed = true, tried = false)
        }
        if (s.current != null && !s.confirmed && s.tried) {
            // Its one launch ended without ready(): it crashed or hung.
            s = rollBack(s)
        }
        val pending = s.pending
        if (pending != null) {
            s = if (usable(pending) && pending != s.current) {
                s.copy(previous = if (s.confirmed) s.current else s.previous, current = pending, confirmed = false, tried = false, pending = null)
            } else {
                s.copy(pending = null)
            }
        }
        val trial = s.current != null && !s.confirmed
        if (trial) s = s.copy(tried = true)
        return Boot(s, s.current, trial)
    }

    /** The served bundle called ready(). */
    fun ready(s: OtaState): OtaState = if (s.current != null && !s.confirmed) s.copy(confirmed = true, tried = false) else s

    /** Start a verified pending bundle in a new activity, without waiting for a process restart. */
    fun activatePending(s: OtaState, installedVersionCode: Int, embeddedBuiltAtMs: Long, info: (String) -> BundleInfo?): OtaState? {
        val pending = s.pending ?: return null
        if (!s.confirmed || pending == s.current || pending in s.bad) return null
        val bundle = info(pending) ?: return null
        if (bundle.version != pending || bundle.minNativeVersionCode > installedVersionCode || bundle.builtAtMs <= embeddedBuiltAtMs) return null
        return s.copy(previous = s.current, current = pending, confirmed = false, tried = true, pending = null)
    }

    /** No ready() within 10 s: mark the bundle bad and serve the last confirmed one. */
    fun rollBack(s: OtaState): OtaState {
        val failed = s.current ?: return s
        if (s.confirmed) return s
        return s.copy(bad = s.bad + failed, current = s.previous, confirmed = true, tried = false, previous = null)
    }

    /** A verified download of `v` is worth installing: not bad, not already served or waiting. */
    fun wanted(s: OtaState, v: String): Boolean = isVersion(v) && v !in s.bad && v != s.current && v != s.pending

    /** Whether a just-unpacked bundle may become `pending`. */
    fun acceptable(s: OtaState, advertised: String, i: BundleInfo, installedVersionCode: Int, embeddedBuiltAtMs: Long): String? = when {
        i.version != advertised -> "bundle.json names another version"
        i.minNativeVersionCode > installedVersionCode -> "needs a newer app"
        i.builtAtMs <= embeddedBuiltAtMs -> "older than the app's own bundle"
        !wanted(s, advertised) -> "not wanted"
        else -> null
    }

    /** Bundle folders still referenced; every other one may be deleted. */
    fun keep(s: OtaState): Set<String> = setOfNotNull(s.current, s.previous, s.pending)
}

/** A ready call or watchdog belongs to one attached Bridge, never a page from an earlier activity. */
class OtaTrialGuard {
    private var generation = 0L
    private var owner: Any? = null

    fun attach(bridge: Any): Long {
        owner = bridge
        return ++generation
    }

    fun invalidate() {
        owner = null
        generation++
    }

    fun acceptsReady(bridge: Any): Boolean = owner === bridge
    fun acceptsTimeout(expectedGeneration: Long): Boolean = owner != null && generation == expectedGeneration
}
