package com.pulseloop.shortvideo

/**
 * One node of an accessibility tree, flattened into plain data so the classifier and its tests
 * never touch `AccessibilityNodeInfo`. [viewId] is the bare entry name (`clips_viewer_view_pager`,
 * not `com.instagram.android:id/clips_viewer_view_pager`). [label] is the node's visible text or
 * content description; it is only ever hashed in memory for the page fingerprint and never stored,
 * logged or uploaded.
 */
data class ScreenNode(
    val viewId: String?,
    val className: String?,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val visible: Boolean = true,
    val scrollable: Boolean = false,
    val depth: Int = 0,
    val label: String? = null,
) {
    val width: Int get() = (right - left).coerceAtLeast(0)
    val height: Int get() = (bottom - top).coerceAtLeast(0)
    fun contains(other: ScreenNode): Boolean =
        other.left >= left && other.right <= right && other.top >= top && other.bottom <= bottom
}

/** A flattened window of one of the two apps. */
data class ScreenSnapshot(
    val packageName: String,
    val screenWidth: Int,
    val screenHeight: Int,
    val nodes: List<ScreenNode>,
    val windowClassName: String? = null,
)

/**
 * The layout knowledge for one app, as data. Instagram and YouTube rename views with app updates,
 * so every rule has fallbacks and anything that only matched a fallback (or nearly matched) is
 * logged to the debug screen with its view ids, which is what to paste back here to tune it.
 *
 * Names were collected from public Reels/Shorts blockers and from the apps' own layouts as of
 * 2026; treat them as a starting point, not a guarantee.
 */
data class AppMatcher(
    val app: ShortVideoApp,
    /** Any of these, visible and covering most of the screen, means the short-video player is up. */
    val screenIds: List<String>,
    /** The vertical pager whose scroll events move between items. */
    val pagerIds: List<String>,
    /** Class-name fragments of vertical pagers, for the fallback rules. */
    val pagerClassHints: List<String>,
    /** View-id fragments that belong to the short-video feature (fallback rules). */
    val idTokens: List<String>,
    /** View-id prefixes that look like [idTokens] but are something else (Instagram Stories). */
    val excludedIdPrefixes: List<String>,
    /** Nodes whose labels identify the current item (creator, caption) for the fingerprint. */
    val identityIds: List<String>,
)

object ShortVideoMatchers {
    /** A short-video player fills the screen; a Shorts shelf in the home feed does not. */
    const val MIN_SCREEN_COVERAGE = 0.6

    val INSTAGRAM = AppMatcher(
        app = ShortVideoApp.INSTAGRAM,
        screenIds = listOf(
            "clips_viewer_view_pager",
            "clips_viewer_pager",
            "clips_viewer_container",
            "clips_viewer_fragment_container",
            "clips_video_container",
            "clips_media_component",
            "clips_single_media_component",
            "root_clips_layout",
        ),
        pagerIds = listOf("clips_viewer_view_pager", "clips_viewer_pager", "clips_viewer_recycler_view"),
        pagerClassHints = listOf("ViewPager", "RecyclerView", "Pager"),
        // In Instagram "reel" historically means Stories (reel_viewer_*), so only "clips" counts.
        idTokens = listOf("clips"),
        excludedIdPrefixes = listOf("reel_viewer", "clips_tab", "clips_shelf", "clips_netego"),
        identityIds = listOf(
            "clips_author_username",
            "clips_author_info_component",
            "clips_caption_component",
            "clips_media_attribution",
            "clips_audio_attribution",
        ),
    )

    val YOUTUBE = AppMatcher(
        app = ShortVideoApp.YOUTUBE,
        screenIds = listOf(
            "reel_recycler",
            "reel_player_page_container",
            "reel_watch_fragment_root",
            "reel_watch_player",
            "shorts_player_container",
            "shorts_container",
        ),
        pagerIds = listOf("reel_recycler", "shorts_recycler"),
        pagerClassHints = listOf("RecyclerView", "ViewPager", "Pager"),
        idTokens = listOf("reel", "shorts"),
        excludedIdPrefixes = listOf("reel_shelf", "reel_item", "shorts_shelf", "reel_thumbnail"),
        identityIds = listOf(
            "reel_channel_name",
            "reel_main_title",
            "reel_multi_format_title",
            "channel_name",
            "reel_player_header_container",
        ),
    )

    val ALL: List<AppMatcher> = listOf(INSTAGRAM, YOUTUBE)

    fun forApp(app: ShortVideoApp): AppMatcher = ALL.first { it.app == app }

    /** `com.instagram.android:id/clips_viewer_view_pager` → `clips_viewer_view_pager`. */
    fun entryName(resourceName: String?): String? =
        resourceName?.substringAfter(":id/", resourceName)?.takeIf { it.isNotBlank() }
}

/** How a screen was recognised; anything other than [SCREEN_ID] or [PAGER_ID] is a fallback. */
enum class MatchRule { SCREEN_ID, PAGER_ID, FALLBACK_PAGER_CLASS, FALLBACK_DESCENDANTS, NONE }

data class Classification(
    val app: ShortVideoApp,
    val inShortVideo: Boolean,
    val rule: MatchRule,
    /** The view id that decided it, for the debug screen. */
    val matchedId: String?,
    /** Height of the pager or player in px, used to turn scroll deltas into pages. */
    val pageHeightPx: Int,
    /** In-memory hash of the current item's identity labels; null when nothing identifies it. */
    val pageKey: String?,
    /** Ids near the short-video vocabulary that matched nothing exactly (layout tuning). */
    val nearMissIds: List<String> = emptyList(),
) {
    val isFallback: Boolean get() = rule == MatchRule.FALLBACK_PAGER_CLASS || rule == MatchRule.FALLBACK_DESCENDANTS
}

/** Pure classifier: snapshot in, verdict out. */
class ShortVideoScreenClassifier(private val matchers: List<AppMatcher> = ShortVideoMatchers.ALL) {

    fun classify(snapshot: ScreenSnapshot): Classification? {
        val app = ShortVideoApp.fromPackage(snapshot.packageName) ?: return null
        val matcher = matchers.firstOrNull { it.app == app } ?: return null
        val screenArea = snapshot.screenWidth.toLong() * snapshot.screenHeight
        fun large(node: ScreenNode): Boolean =
            node.visible && screenArea > 0 &&
                node.width.toLong() * node.height >= ShortVideoMatchers.MIN_SCREEN_COVERAGE * screenArea
        fun excluded(id: String) = matcher.excludedIdPrefixes.any { id.startsWith(it) }

        val nodes = snapshot.nodes
        var rule = MatchRule.NONE
        var decider: ScreenNode? = null

        nodes.firstOrNull { n -> n.viewId != null && n.viewId in matcher.screenIds && large(n) }?.let {
            rule = MatchRule.SCREEN_ID; decider = it
        }
        if (decider == null) {
            nodes.firstOrNull { n -> n.viewId != null && n.viewId in matcher.pagerIds && large(n) }?.let {
                rule = MatchRule.PAGER_ID; decider = it
            }
        }
        if (decider == null) {
            nodes.firstOrNull { n ->
                val id = n.viewId ?: return@firstOrNull false
                !excluded(id) && matcher.idTokens.any { id.contains(it) } &&
                    matcher.pagerClassHints.any { n.className?.contains(it) == true } && large(n)
            }?.let { rule = MatchRule.FALLBACK_PAGER_CLASS; decider = it }
        }
        if (decider == null) {
            // A large vertical pager with at least two short-video ids inside it.
            nodes.firstOrNull { pager ->
                large(pager) && (pager.scrollable || matcher.pagerClassHints.any { pager.className?.contains(it) == true }) &&
                    nodes.count { child ->
                        val id = child.viewId
                        child !== pager && id != null && !excluded(id) && pager.contains(child) &&
                            matcher.idTokens.any { id.contains(it) }
                    } >= 2
            }?.let { rule = MatchRule.FALLBACK_DESCENDANTS; decider = it }
        }

        val found = decider
        if (found == null) {
            val near = nodes.mapNotNull { it.viewId }
                .filter { id -> !excluded(id) && matcher.idTokens.any { id.contains(it) } }
                .distinct()
                .take(MAX_NEAR_MISS)
            return Classification(app, false, MatchRule.NONE, null, 0, null, near)
        }

        val pager = nodes.firstOrNull { it.viewId != null && it.viewId in matcher.pagerIds && it.visible } ?: found
        return Classification(
            app = app,
            inShortVideo = true,
            rule = rule,
            matchedId = found.viewId,
            pageHeightPx = pager.height.takeIf { it > 0 } ?: snapshot.screenHeight,
            pageKey = pageKey(matcher, nodes, snapshot),
        )
    }

    /**
     * A hash of the labels that identify the item on screen now: the identity ids first, and when
     * the app exposes none of them, the visible labels inside the screen's middle band. Digits are
     * dropped (like and view counts tick while a reel plays) and so are a few volatile words.
     */
    internal fun pageKey(matcher: AppMatcher, nodes: List<ScreenNode>, snapshot: ScreenSnapshot): String? {
        val visible = nodes.filter { it.visible && !it.label.isNullOrBlank() }
        val identity = visible.filter { it.viewId != null && it.viewId in matcher.identityIds }
        val chosen = identity.ifEmpty {
            visible.filter { n ->
                n.top >= 0 && n.bottom <= snapshot.screenHeight && n.top > snapshot.screenHeight / 2
            }.take(MAX_FALLBACK_LABELS)
        }
        val parts = chosen.mapNotNull { node -> normaliseLabel(node.label)?.let { "${node.viewId.orEmpty()}=$it" } }
        if (parts.isEmpty()) return null
        return "fp:" + parts.joinToString("|").hashCode().toUInt().toString(16)
    }

    private fun normaliseLabel(raw: String?): String? {
        val text = raw?.lowercase()?.replace(DIGITS, "")?.replace(VOLATILE, "")?.replace(SPACES, " ")?.trim()
        return text?.takeIf { it.length >= 2 }
    }

    private companion object {
        const val MAX_NEAR_MISS = 24
        const val MAX_FALLBACK_LABELS = 6
        val DIGITS = Regex("\\d[\\d.,]*[kmb]?")
        val VOLATILE = Regex("\\b(following|follow|liked|like|subscribed|subscribe|more|less|playing|paused)\\b")
        val SPACES = Regex("\\s+")
    }
}
