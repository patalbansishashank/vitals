package desi.creative.vitals

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.Properties
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/** What the web layer asks to fetch: one entry of `GET /v1/apps/vitals/latest`, with the paired device's token. */
data class OtaRequest(
    val url: String,
    val sha256: String,
    val size: Long,
    val token: String,
    val version: String = "",
    val sig: String? = null,
    val versionCode: Int = 0,
    val versionName: String = "",
)

class OtaFailure(message: String) : Exception(message)

/**
 * Background downloads for both kinds of update. The token is used for the request and never stored. Every file lands
 * in app-private storage and is checked (size, sha256; a web bundle's ed25519 signature too) before anything uses it.
 */
object OtaDownloads {
    private const val MAX_BUNDLE_BYTES = 200L * 1024 * 1024
    private const val MAX_APK_BYTES = 300L * 1024 * 1024
    private const val MAX_ENTRIES = 5_000
    /** CONTRACT.md: no automatic APK download on a metered network above this size. */
    const val METERED_APK_LIMIT = 30L * 1024 * 1024

    private val executor = Executors.newSingleThreadExecutor()
    private val webBusy = AtomicBoolean(false)
    private val apkBusy = AtomicBoolean(false)

    fun run(task: () -> Unit) = executor.execute(task)

    fun isMetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        return cm.isActiveNetworkMetered
    }

    private fun tmpDir(ctx: Context) = File(OtaBoot.root(ctx), "tmp").apply { mkdirs() }

    /** GET with the bearer token into `out`; returns the sha256 (hex). Size is enforced while reading. */
    private fun fetch(req: OtaRequest, out: File, maxBytes: Long, progress: OtaProgressReporter): String {
        val url = URL(req.url)
        if (url.protocol != "https") throw OtaFailure("not https")
        if (req.size <= 0 || req.size > maxBytes) throw OtaFailure("bad size")
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer ${req.token}")
            conn.setRequestProperty("Accept", "application/octet-stream")
            if (conn.responseCode != 200) throw OtaFailure("http ${conn.responseCode}")
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            progress.bytes(0)
            DigestInputStream(conn.inputStream, digest).use { input ->
                FileOutputStream(out).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > req.size) throw OtaFailure("larger than announced")
                        output.write(buf, 0, n)
                        progress.bytes(total)
                    }
                    output.fd.sync()
                }
            }
            if (total != req.size) throw OtaFailure("size mismatch")
            progress.verifying()
            return OtaVerify.toHex(digest.digest())
        } finally {
            conn.disconnect()
        }
    }

    /** Download, verify and unpack a web bundle; it is served from the next cold start. Returns "staged" or "skipped". */
    fun web(ctx: Context, req: OtaRequest, onProgress: (OtaProgress) -> Unit = {}): String {
        if (!OtaLogic.isVersion(req.version) || !OtaVerify.isSha256(req.sha256)) throw OtaFailure("bad manifest")
        if (!OtaBoot.wanted(req.version)) return "skipped"
        if (!webBusy.compareAndSet(false, true)) return "busy"
        val zip = File(tmpDir(ctx), "bundle.zip")
        val staging = File(tmpDir(ctx), "bundle")
        try {
            val sha = fetch(req, zip, MAX_BUNDLE_BYTES, OtaProgressReporter(req.size, onProgress))
            if (!sha.equals(req.sha256, ignoreCase = true)) throw OtaFailure("sha256 mismatch")
            if (!OtaVerify.signatureOk(sha, req.sig)) throw OtaFailure("bad signature")
            staging.deleteRecursively()
            unzip(zip, staging)
            val info = File(staging, "bundle.json").takeIf { it.isFile }?.let { OtaBoot.parseInfo(it.readText()) }
                ?: throw OtaFailure("no bundle.json")
            if (!File(staging, "index.html").isFile) throw OtaFailure("no index.html")
            val target = File(OtaBoot.webRoot(ctx), req.version)
            target.deleteRecursively()
            target.parentFile?.mkdirs()
            if (!staging.renameTo(target)) throw OtaFailure("could not move the bundle")
            val why = OtaBoot.stage(ctx, req.version, info)
            if (why != null) {
                target.deleteRecursively()
                throw OtaFailure(why)
            }
            return "staged"
        } finally {
            zip.delete()
            staging.deleteRecursively()
            webBusy.set(false)
        }
    }

    private fun unzip(zip: File, dest: File) {
        dest.mkdirs()
        var entries = 0
        var total = 0L
        ZipInputStream(zip.inputStream().buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (++entries > MAX_ENTRIES) throw OtaFailure("too many files")
                val target = OtaVerify.entryTarget(dest, e.name) ?: throw OtaFailure("bad path in zip")
                // like the APK (build.gradle aaptOptions): no service worker in the WebView
                if (e.name == "sw.js") continue
                if (e.isDirectory) {
                    target.mkdirs()
                    continue
                }
                target.parentFile?.mkdirs()
                FileOutputStream(target).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = z.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BUNDLE_BYTES) throw OtaFailure("bundle too large")
                        out.write(buf, 0, n)
                    }
                }
            }
        }
    }

    /**
     * Download and verify an APK into files/ota/apk/; the owner installs it from Settings. Returns "ready", "skipped",
     * or "metered" (larger than 30 MB on a metered network and not asked for).
     */
    fun apk(ctx: Context, req: OtaRequest, userAsked: Boolean, onProgress: (OtaProgress) -> Unit = {}): String {
        if (!OtaVerify.isSha256(req.sha256) || req.versionCode <= 0) throw OtaFailure("bad manifest")
        val installed = OtaBoot.installedVersionCode(ctx)
        if (req.versionCode <= installed) return "skipped"
        if (OtaApk.ready(ctx)?.versionCode == req.versionCode) return "ready"
        if (!userAsked && req.size > METERED_APK_LIMIT && isMetered(ctx)) return "metered"
        if (!apkBusy.compareAndSet(false, true)) return "busy"
        val tmp = File(tmpDir(ctx), "update.apk")
        try {
            val sha = fetch(req, tmp, MAX_APK_BYTES, OtaProgressReporter(req.size, onProgress))
            if (!sha.equals(req.sha256, ignoreCase = true)) throw OtaFailure("sha256 mismatch")
            @Suppress("DEPRECATION")
            val info = ctx.packageManager.getPackageArchiveInfo(tmp.absolutePath, 0) ?: throw OtaFailure("not an APK")
            if (info.packageName != ctx.packageName) throw OtaFailure("another app")
            if (PackageInfoCompat.getLongVersionCode(info).toInt() != req.versionCode) throw OtaFailure("versionCode mismatch")
            OtaApk.keep(ctx, tmp, req.versionCode, info.versionName ?: req.versionName, sha)
            return "ready"
        } finally {
            tmp.delete()
            apkBusy.set(false)
        }
    }
}

/** The one downloaded APK waiting for the owner's tap (files/ota/apk/, app-private: it is copied into an install session). */
object OtaApk {
    data class Ready(val versionCode: Int, val versionName: String, val file: File)

    private fun dir(ctx: Context) = File(OtaBoot.root(ctx), "apk")
    private fun meta(ctx: Context) = File(dir(ctx), "update.properties")

    fun ready(ctx: Context): Ready? = try {
        val p = Properties().apply { meta(ctx).inputStream().use { load(it) } }
        val code = p.getProperty("versionCode")?.toIntOrNull() ?: 0
        val file = File(dir(ctx), "vitals-$code.apk")
        if (code > OtaBoot.installedVersionCode(ctx) && file.isFile) Ready(code, p.getProperty("versionName").orEmpty(), file) else null
    } catch (e: Exception) {
        null
    }

    fun keep(ctx: Context, from: File, versionCode: Int, versionName: String, sha256: String) {
        val d = dir(ctx)
        d.listFiles()?.forEach { it.delete() }
        d.mkdirs()
        val file = File(d, "vitals-$versionCode.apk")
        if (!from.renameTo(file)) throw OtaFailure("could not keep the APK")
        val p = Properties().apply {
            setProperty("versionCode", versionCode.toString())
            setProperty("versionName", versionName)
            setProperty("sha256", sha256)
        }
        FileOutputStream(meta(ctx)).use { p.store(it, null) }
    }

    /** Installed already (or older): the file is no longer needed. */
    fun pruneInstalled(ctx: Context) {
        if (ready(ctx) == null) dir(ctx).listFiles()?.forEach { it.delete() }
    }

    /**
     * Installs the waiting APK through an install session (OtaInstall); the system's own confirmation shows next. Android
     * asks once to allow installs from Vitals; until that is allowed this opens that setting instead ("permission").
     * Returns "started" once the update is staged and handed to Android, "none" without one, or "permission".
     */
    fun install(ctx: Context): String {
        val r = ready(ctx) ?: return "none"
        if (!ctx.packageManager.canRequestPackageInstalls()) {
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            return "permission"
        }
        OtaInstall.start(ctx, r.file)
        return "started"
    }
}
