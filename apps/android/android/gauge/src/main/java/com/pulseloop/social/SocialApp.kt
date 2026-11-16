package com.pulseloop.social

/**
 * The apps whose foreground time "Social time" measures (SPEC social-time, 2026-11-16). [key] is the stable
 * storage/wire name (Room rows, hub `perApp.<key>`, the engine-state `enabledApps`); never rename it. A package maps to
 * at most one key; [TIKTOK] has two because TikTok ships under two package names.
 *
 * Time comes from Usage access (whole-app foreground time), not an accessibility service, so banking and payment apps no
 * longer refuse to run. Only installed, enabled apps are counted.
 */
enum class SocialApp(val key: String, val label: String, val packages: List<String>) {
    INSTAGRAM("instagram", "Instagram", listOf("com.instagram.android")),
    YOUTUBE("youtube", "YouTube", listOf("com.google.android.youtube")),
    FACEBOOK("facebook", "Facebook", listOf("com.facebook.katana")),
    SNAPCHAT("snapchat", "Snapchat", listOf("com.snapchat.android")),
    TWITTER("twitter", "X", listOf("com.twitter.android")),
    REDDIT("reddit", "Reddit", listOf("com.reddit.frontpage")),
    TIKTOK("tiktok", "TikTok", listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"));

    companion object {
        /** The stable wire order used wherever the apps are listed (the "common set", editable in-app). */
        val keys: List<String> get() = entries.map { it.key }

        private val byPackage: Map<String, SocialApp> =
            entries.flatMap { app -> app.packages.map { it to app } }.toMap()

        fun fromPackage(packageName: String?): SocialApp? = packageName?.let { byPackage[it] }

        fun fromKey(key: String?): SocialApp? = key?.let { k -> entries.firstOrNull { it.key == k } }
    }
}
