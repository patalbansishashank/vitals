package desi.creative.vitals

import java.util.Locale

/**
 * Which shared files Vitals takes: the same formats bio.import reads. Pure (no Android classes) so it can be unit
 * tested; the manifest intent filters list the same types.
 */
object SharedMime {
    val accepted: Set<String> = setOf(
        "application/json",
        "application/zip",
        "application/x-zip-compressed",
        "text/csv",
        "text/comma-separated-values",
        "text/xml",
        "application/xml",
        "application/octet-stream",
        "application/gpx+xml",
        "application/vnd.garmin.tcx+xml",
        "application/pdf",
    )

    private val byExtension: Map<String, String> = mapOf(
        "json" to "application/json",
        "zip" to "application/zip",
        "csv" to "text/csv",
        "xml" to "application/xml",
        "gpx" to "application/gpx+xml",
        "tcx" to "application/vnd.garmin.tcx+xml",
        "pdf" to "application/pdf",
    )

    /** Normalises a mime type: lower case, no parameters ("text/csv; charset=utf-8" -> "text/csv"). */
    fun normalise(mime: String?): String? {
        val base = mime?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
        return if (base.isNullOrEmpty()) null else base
    }

    /** Mime type guessed from a file name's extension, or null. */
    fun fromName(name: String?): String? {
        val ext = name?.substringAfterLast('.', "")?.lowercase(Locale.ROOT) ?: return null
        return byExtension[ext]
    }

    /**
     * The mime type to record for a file: the declared one when it is a real type, else the extension's, else
     * "application/octet-stream". Senders often say "application/octet-stream" or "*&#47;*" for anything.
     */
    fun resolve(declared: String?, name: String?): String {
        val base = normalise(declared)
        if (base != null && base != "application/octet-stream" && !base.contains('*')) return base
        return fromName(name) ?: "application/octet-stream"
    }

    /** True when a file with this declared type and name is one Vitals can import. */
    fun isAccepted(declared: String?, name: String?): Boolean {
        val base = normalise(declared)
        if (base != null && !base.contains('*') && base != "application/octet-stream") return base in accepted
        // A wildcard or "octet-stream" says nothing; the extension decides.
        return fromName(name) != null
    }
}
