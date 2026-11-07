package desi.creative.vitals

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Ed25519Test {
    private fun h(s: String) = OtaVerify.hex(s)

    @Test
    fun rfc8032Vectors() {
        assertTrue(
            Ed25519.verify(
                h("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
                ByteArray(0),
                h("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
            )
        )
        assertTrue(
            Ed25519.verify(
                h("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"),
                h("72"),
                h("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"),
            )
        )
    }

    // Made by node's crypto.sign(null, Buffer.from(shaHex), key), as scripts/release/web-bundle.mjs signs.
    private val testKey = h("289ab68ec4ae2046377ba5839eeb4227212deca8d4c9a538eb4dd378c050c9b0")
    private val testSha = "074d1f572bfe30b8b30434d58bbfb8466ab54b767a989b020ebc416412be3d53"
    private val testSig = "wsZiioTOvkclZFDpJtO+SsnJCMf8vkOxHMXSBn6qb1xVi9WO+3fohSr4wKpoZ0WP5+9w1rRDPTZ2cXw/YJ7XCg=="

    @Test
    fun acceptsTheBuildScriptsSignature() {
        assertTrue(OtaVerify.signatureOk(testSha, testSig, testKey))
        // hex form and an upper-case sha are the same thing
        assertTrue(OtaVerify.signatureOk(testSha.uppercase(), OtaVerify.toHex(OtaVerify.decodeSignature(testSig)!!), testKey))
    }

    @Test
    fun rejectsTamperedInputs() {
        val otherSha = testSha.replaceRange(0, 1, "1")
        assertFalse(OtaVerify.signatureOk(otherSha, testSig, testKey))
        val sig = OtaVerify.decodeSignature(testSig)!!
        sig[10] = (sig[10].toInt() xor 1).toByte()
        assertFalse(OtaVerify.signatureOk(testSha, OtaVerify.toHex(sig), testKey))
        // the real key did not sign it
        assertFalse(OtaVerify.signatureOk(testSha, testSig))
        assertFalse(OtaVerify.signatureOk(testSha, null, testKey))
        assertFalse(OtaVerify.signatureOk(testSha, "not base64!", testKey))
        assertFalse(OtaVerify.signatureOk("abc", testSig, testKey))
    }

    @Test
    fun rejectsAnSAboveTheGroupOrder() {
        val sig = OtaVerify.decodeSignature(testSig)!!
        for (i in 32 until 64) sig[i] = 0xff.toByte()
        assertFalse(Ed25519.verify(testKey, testSha.toByteArray(), sig))
    }

    @Test
    fun embeddedKeyIsAPoint() {
        assertEquals(32, OtaVerify.WEB_BUNDLE_PUBLIC_KEY.size)
        // a valid point decodes; verification then fails cleanly rather than throwing
        assertFalse(Ed25519.verify(OtaVerify.WEB_BUNDLE_PUBLIC_KEY, ByteArray(1), ByteArray(64)))
    }

    @Test
    fun zipEntriesStayInsideTheFolder() {
        val root = Files.createTempDirectory("ota").toFile()
        try {
            assertNotNull(OtaVerify.entryTarget(root, "index.html"))
            assertNotNull(OtaVerify.entryTarget(root, "assets/app-1.js"))
            for (bad in listOf("../x", "a/../../x", "/etc/x", "a\\b", "C:x", "")) assertNull(bad, OtaVerify.entryTarget(root, bad))
        } finally {
            root.deleteRecursively()
        }
    }
}
