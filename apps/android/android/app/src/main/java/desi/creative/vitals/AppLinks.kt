package desi.creative.vitals

import java.util.Locale

/**
 * App Links (contract, round 2): an https://vitals.creative.desi/settings… link opens the app, which shows the same
 * path, query and fragment on its own origin, so the pairing-link reader in Settings › Server picks it up. Pure (no
 * Android classes) so it can be unit tested.
 */
object AppLinks {
    const val HOST = "vitals.creative.desi"
    const val LOCAL_ORIGIN = "https://localhost"
    private const val PATH = "/settings"

    /**
     * "https://vitals.creative.desi/settings?section=server#vitals-server:1?…" ->
     * "https://localhost/settings?section=server#vitals-server:1?…". Anything else (another scheme, host, port or
     * path, user info) -> null. Query and fragment are kept exactly as they came.
     */
    fun localUrlFor(link: String?): String? {
        val text = link?.trim() ?: return null
        val prefix = "https://"
        if (!text.regionMatches(0, prefix, 0, prefix.length, ignoreCase = true)) return null
        val afterScheme = text.substring(prefix.length)
        val authorityEnd = afterScheme.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) afterScheme.length else it }
        val authority = afterScheme.substring(0, authorityEnd).lowercase(Locale.ROOT)
        if (authority != HOST && authority != "$HOST:443") return null
        val rest = afterScheme.substring(authorityEnd)
        val path = rest.substring(0, rest.indexOfAny(charArrayOf('?', '#')).let { if (it < 0) rest.length else it })
        if (path != PATH && !path.startsWith("$PATH/")) return null
        return LOCAL_ORIGIN + rest
    }
}
