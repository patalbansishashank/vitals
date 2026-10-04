package desi.creative.vitals

/**
 * File names for copies of shared files and for exports: safe on the file system, unique in their folder, with the
 * display name the sender gave kept as far as possible. Pure (no Android classes).
 */
object SharedFileNames {
    const val MAX_LENGTH = 120
    private const val FALLBACK = "shared"

    private val extensionByMime: Map<String, String> = mapOf(
        "application/json" to "json",
        "application/zip" to "zip",
        "application/x-zip-compressed" to "zip",
        "text/csv" to "csv",
        "text/comma-separated-values" to "csv",
        "text/xml" to "xml",
        "application/xml" to "xml",
        "application/gpx+xml" to "gpx",
        "application/vnd.garmin.tcx+xml" to "tcx",
        "application/pdf" to "pdf",
    )

    /**
     * A safe file name from what the sender called the file: path parts and control characters go, leading dots go
     * (no hidden files, no ".."), the length is capped keeping the extension. An empty or missing name becomes
     * "shared" with an extension from the mime type when one is known.
     */
    fun sanitise(displayName: String?, mime: String? = null): String {
        var name = (displayName ?: "")
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .replace(Regex("[\\p{Cntrl}\\\\/:*?\"<>|]"), "_")
            .trim()
            .trimStart('.')
            .trim()
        if (name.isEmpty()) {
            val ext = extensionByMime[SharedMime.normalise(mime) ?: ""]
            name = if (ext != null) "$FALLBACK.$ext" else FALLBACK
        }
        if (name.length > MAX_LENGTH) {
            val (stem, ext) = split(name)
            val room = (MAX_LENGTH - ext.length).coerceAtLeast(1)
            name = stem.take(room).trimEnd() + ext
        }
        return name
    }

    /** "report.csv" taken -> "report (2).csv", then "report (3).csv", ... */
    fun unique(name: String, taken: Set<String>): String {
        if (name !in taken) return name
        val (stem, ext) = split(name)
        var n = 2
        while (true) {
            val candidate = "$stem ($n)$ext"
            if (candidate !in taken) return candidate
            n++
        }
    }

    /** Splits "a.b.csv" into "a.b" and ".csv"; a name without a dot (or only a leading one) has an empty extension. */
    fun split(name: String): Pair<String, String> {
        val dot = name.lastIndexOf('.')
        if (dot <= 0 || dot == name.length - 1) return name to ""
        val ext = name.substring(dot)
        // A very long "extension" is not one.
        if (ext.length > 16) return name to ""
        return name.substring(0, dot) to ext
    }
}
