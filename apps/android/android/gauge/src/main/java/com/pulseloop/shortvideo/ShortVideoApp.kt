package com.pulseloop.shortvideo

/**
 * The two apps whose short-video feeds Gauge counts. [key] is the stable storage/wire name (Room
 * rows, hub `counts.<key>`); never rename it.
 */
enum class ShortVideoApp(val packageName: String, val label: String, val feedName: String, val key: String) {
    INSTAGRAM("com.instagram.android", "Instagram", "Reels", "instagram"),
    YOUTUBE("com.google.android.youtube", "YouTube", "Shorts", "youtube");

    companion object {
        fun fromPackage(packageName: CharSequence?): ShortVideoApp? =
            packageName?.toString()?.let { pkg -> entries.firstOrNull { it.packageName == pkg } }

        fun fromKey(key: String): ShortVideoApp? = entries.firstOrNull { it.key == key }
    }
}
