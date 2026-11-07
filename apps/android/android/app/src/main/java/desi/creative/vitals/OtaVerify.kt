package desi.creative.vitals

import java.io.File
import java.util.Base64

/** The checks a downloaded file passes before it is kept (CONTRACT.md "Web bundle format"). Pure, JVM-tested. */
object OtaVerify {
    /**
     * The web-bundle signing key's public half (ed25519, raw 32 bytes). The private half lives only on the build machine
     * (~/.config/vitals-release/web-bundle-ed25519.key); scripts/release/web-bundle.mjs signs with it.
     */
    val WEB_BUNDLE_PUBLIC_KEY: ByteArray = hex("efd832f5534689affe3d71c274712a835b2508f4cda7b9bab639faa7d6af741a")

    private val SHA256_HEX = Regex("^[0-9a-fA-F]{64}$")
    private val SIG_HEX = Regex("^[0-9a-fA-F]{128}$")

    fun isSha256(s: String?): Boolean = s != null && SHA256_HEX.matches(s)

    /** The signature is ed25519 over the zip's sha256 as a lowercase hex string; the `sig` field is base64 (or hex). */
    fun signatureOk(sha256Hex: String, sig: String?, publicKey: ByteArray = WEB_BUNDLE_PUBLIC_KEY): Boolean {
        if (!isSha256(sha256Hex) || sig == null) return false
        val bytes = decodeSignature(sig.trim()) ?: return false
        return Ed25519.verify(publicKey, sha256Hex.lowercase().toByteArray(Charsets.US_ASCII), bytes)
    }

    fun decodeSignature(sig: String): ByteArray? {
        if (SIG_HEX.matches(sig)) return hex(sig)
        val bytes = try {
            if (sig.contains('-') || sig.contains('_')) Base64.getUrlDecoder().decode(sig) else Base64.getDecoder().decode(sig)
        } catch (e: IllegalArgumentException) {
            return null
        }
        return bytes.takeIf { it.size == 64 }
    }

    /**
     * Where a zip entry may be written inside `root`, or null when its name would leave it (absolute, `..`, a
     * backslash or a drive letter: a zip-slip).
     */
    fun entryTarget(root: File, name: String): File? {
        if (name.isEmpty() || name.startsWith("/") || name.contains('\\') || name.contains(':') || name.contains('\u0000')) return null
        val parts = name.split('/')
        if (parts.any { it == ".." }) return null
        val target = File(root, name)
        val rootPath = root.canonicalPath + File.separator
        return target.takeIf { it.canonicalPath.startsWith(rootPath) }
    }

    fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    fun toHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
