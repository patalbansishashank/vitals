package com.pulseloop.ring

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNotNull
import org.junit.Test

/** A path-only failure: the firmware passcode may occur in the canonical holder and nowhere else. */
class JStylePasscodeLeakTest {
    @Test fun firmwarePasscodeAppearsOnlyInItsCanonicalSourceFile() {
        val repo = generateSequence(File(System.getProperty("user.dir") ?: ".")) { it.parentFile }
            .firstOrNull { File(it, ".git").exists() }
        assumeNotNull(repo)
        val root = repo!!
        val listing = ProcessBuilder("git", "ls-files", "--cached", "-z")
            .directory(root).start()
        val paths = listing.inputStream.readBytes().toString(Charsets.UTF_8).split('\u0000').filter(String::isNotEmpty)
        assertTrue("Could not list repository files for passcode scan", listing.waitFor() == 0)

        val bytes = JStyle2301Passcode.bytes()
        val plain = bytes.toString(Charsets.US_ASCII)
        val compactHex = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        val spacedHex = bytes.joinToString(" ") { "%02x".format(it.toInt() and 0xFF) }
        val canonical = "apps/android/android/gauge/src/main/java/com/pulseloop/ring/JStyle2301Passcode.kt"
        val leaks = paths.filter { path ->
            if (path == canonical) return@filter false
            val file = File(root, path)
            if (!file.isFile) return@filter false
            val content = file.readBytes()
            // Binary assets cannot contain a source-level copy; avoid decoding them.
            if (content.take(4096).any { it == 0.toByte() }) return@filter false
            val text = content.toString(Charsets.UTF_8)
            text.contains(plain) || text.lowercase().let { it.contains(compactHex) || it.contains(spacedHex) }
        }
        assertTrue("Firmware passcode outside canonical source: ${leaks.joinToString()}", leaks.isEmpty())
    }
}
