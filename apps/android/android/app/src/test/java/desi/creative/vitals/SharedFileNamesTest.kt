package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedFileNamesTest {
    @Test
    fun keepsAPlainName() {
        assertEquals("sleep-2026-10.csv", SharedFileNames.sanitise("sleep-2026-10.csv"))
    }

    @Test
    fun dropsPathPartsAndBadCharacters() {
        assertEquals("export.json", SharedFileNames.sanitise("../../etc/export.json"))
        assertEquals("c.zip", SharedFileNames.sanitise("a/b\\c.zip"))
        assertEquals("tab_name.csv", SharedFileNames.sanitise("tab\tname.csv"))
        assertEquals("q_r_.pdf", SharedFileNames.sanitise("q:r*.pdf"))
    }

    @Test
    fun noHiddenFilesOrDotDot() {
        assertEquals("hidden", SharedFileNames.sanitise(".hidden"))
        assertEquals("shared", SharedFileNames.sanitise(".."))
        assertEquals("shared", SharedFileNames.sanitise("/"))
    }

    @Test
    fun fallsBackToMimeExtension() {
        assertEquals("shared.json", SharedFileNames.sanitise(null, "application/json"))
        assertEquals("shared.zip", SharedFileNames.sanitise("", "application/x-zip-compressed"))
        assertEquals("shared.csv", SharedFileNames.sanitise("  ", "text/csv; charset=utf-8"))
        assertEquals("shared", SharedFileNames.sanitise(null, "application/octet-stream"))
        assertEquals("shared", SharedFileNames.sanitise(null, null))
    }

    @Test
    fun capsLengthKeepingExtension() {
        val long = "x".repeat(300) + ".gpx"
        val out = SharedFileNames.sanitise(long)
        assertTrue(out.length <= SharedFileNames.MAX_LENGTH)
        assertTrue(out.endsWith(".gpx"))
    }

    @Test
    fun uniqueAddsACounter() {
        val taken = setOf("report.csv", "report (2).csv")
        assertEquals("other.csv", SharedFileNames.unique("other.csv", taken))
        assertEquals("report (3).csv", SharedFileNames.unique("report.csv", taken))
        assertEquals("noext (2)", SharedFileNames.unique("noext", setOf("noext")))
    }

    @Test
    fun splitsExtension() {
        assertEquals("a.b" to ".csv", SharedFileNames.split("a.b.csv"))
        assertEquals("noext" to "", SharedFileNames.split("noext"))
        assertEquals("trailing." to "", SharedFileNames.split("trailing."))
        assertEquals("not.anextensionthatislong" to "", SharedFileNames.split("not.anextensionthatislong"))
    }
}
