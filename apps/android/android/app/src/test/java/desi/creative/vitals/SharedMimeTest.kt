package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedMimeTest {
    @Test
    fun acceptsTheImportFormats() {
        for (m in listOf(
            "application/json", "application/zip", "application/x-zip-compressed", "text/csv",
            "text/comma-separated-values", "text/xml", "application/xml", "application/gpx+xml",
            "application/vnd.garmin.tcx+xml", "application/pdf",
        )) assertTrue(m, SharedMime.isAccepted(m, null))
    }

    @Test
    fun rejectsOtherTypes() {
        assertFalse(SharedMime.isAccepted("image/png", "photo.png"))
        assertFalse(SharedMime.isAccepted("text/plain", "notes.txt"))
        assertFalse(SharedMime.isAccepted("video/mp4", null))
    }

    @Test
    fun normalisesCaseAndParameters() {
        assertEquals("text/csv", SharedMime.normalise("Text/CSV; charset=utf-8"))
        assertNull(SharedMime.normalise(""))
        assertNull(SharedMime.normalise(null))
        assertTrue(SharedMime.isAccepted("APPLICATION/JSON", null))
    }

    @Test
    fun octetStreamAndWildcardsGoByExtension() {
        assertTrue(SharedMime.isAccepted("application/octet-stream", "lumen-export.zip"))
        assertTrue(SharedMime.isAccepted("*/*", "rides.gpx"))
        assertFalse(SharedMime.isAccepted("application/octet-stream", "movie.mkv"))
        assertFalse(SharedMime.isAccepted("application/octet-stream", null))
        assertFalse(SharedMime.isAccepted(null, null))
    }

    @Test
    fun resolvesTheRecordedType() {
        assertEquals("text/csv", SharedMime.resolve("text/csv; charset=utf-8", "x.json"))
        assertEquals("application/json", SharedMime.resolve("application/octet-stream", "data.JSON"))
        assertEquals("application/vnd.garmin.tcx+xml", SharedMime.resolve(null, "run.tcx"))
        assertEquals("application/octet-stream", SharedMime.resolve("*/*", "blob"))
    }
}
