package com.pulseloop.shortvideo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShortVideoClassifierTest {
    private val classifier = ShortVideoScreenClassifier()
    private val w = 1240
    private val h = 2772

    private fun node(id: String?, cls: String = "android.widget.FrameLayout", top: Int = 0, bottom: Int = h, label: String? = null, left: Int = 0, right: Int = w) =
        ScreenNode(id, cls, left, top, right, bottom, label = label)

    private fun snap(pkg: String, vararg nodes: ScreenNode) = ScreenSnapshot(pkg, w, h, nodes.toList())

    @Test fun `YouTube Shorts player is recognised by its recycler`() {
        val c = classifier.classify(
            snap(
                ShortVideoApp.YOUTUBE.packageName,
                node(null),
                node("reel_recycler", "androidx.recyclerview.widget.RecyclerView"),
                node("reel_channel_name", "android.widget.TextView", top = 2300, bottom = 2360, label = "@someone"),
            ),
        )!!
        assertTrue(c.inShortVideo)
        assertEquals(MatchRule.SCREEN_ID, c.rule)
        assertEquals(h, c.pageHeightPx)
        assertNotNull(c.pageKey)
    }

    @Test fun `a Shorts shelf in the home feed is not the Shorts player`() {
        val c = classifier.classify(
            snap(
                ShortVideoApp.YOUTUBE.packageName,
                node("results", "androidx.recyclerview.widget.RecyclerView"),
                node("reel_shelf_items", "androidx.recyclerview.widget.RecyclerView", top = 900, bottom = 1500),
                node("reel_item_thumbnail", top = 900, bottom = 1500, right = 400),
            ),
        )!!
        assertFalse(c.inShortVideo)
    }

    @Test fun `Instagram Stories (reel_viewer) are not Reels`() {
        val c = classifier.classify(
            snap(
                ShortVideoApp.INSTAGRAM.packageName,
                node("reel_viewer_root"),
                node("reel_viewer_media_container"),
            ),
        )!!
        assertFalse(c.inShortVideo)
    }

    @Test fun `Instagram Reels viewer by id, and by fallback when renamed`() {
        val exact = classifier.classify(snap(ShortVideoApp.INSTAGRAM.packageName, node("clips_viewer_view_pager", "androidx.viewpager.widget.ViewPager")))!!
        assertEquals(MatchRule.SCREEN_ID, exact.rule)

        val renamed = classifier.classify(snap(ShortVideoApp.INSTAGRAM.packageName, node("clips_viewer_pager_v2", "androidx.viewpager2.widget.ViewPager2")))!!
        assertTrue(renamed.inShortVideo)
        assertEquals(MatchRule.FALLBACK_PAGER_CLASS, renamed.rule)
        assertTrue(renamed.isFallback)

        val descendants = classifier.classify(
            snap(
                ShortVideoApp.INSTAGRAM.packageName,
                node("mystery_pager", "com.instagram.ui.widget.SomethingNew").copy(scrollable = true),
                node("clips_ufi_v3", top = 1800, bottom = 2600, left = 1100),
                node("clips_author_v3", top = 2400, bottom = 2500, right = 600),
            ),
        )!!
        assertTrue(descendants.inShortVideo)
        assertEquals(MatchRule.FALLBACK_DESCENDANTS, descendants.rule)
    }

    @Test fun `near misses are reported for tuning`() {
        val c = classifier.classify(
            snap(
                ShortVideoApp.INSTAGRAM.packageName,
                node("feed"),
                node("clips_preview_small", top = 100, bottom = 400),
                node("clips_label", top = 100, bottom = 150),
            ),
        )!!
        assertFalse(c.inShortVideo)
        assertEquals(listOf("clips_preview_small", "clips_label"), c.nearMissIds)
    }

    @Test fun `other packages are not classified`() {
        assertNull(classifier.classify(snap("com.android.launcher", node("reel_recycler"))))
    }

    @Test fun `the page key ignores ticking like counts but changes with the creator`() {
        fun key(user: String, likes: String) = classifier.classify(
            snap(
                ShortVideoApp.YOUTUBE.packageName,
                node("reel_recycler", "androidx.recyclerview.widget.RecyclerView"),
                node("reel_channel_name", top = 2300, bottom = 2360, label = user),
                node("like_button", top = 1500, bottom = 1600, label = likes),
            ),
        )!!.pageKey
        assertEquals(key("@cat", "1.2K likes"), key("@cat", "1.3K likes"))
        assertNotEquals(key("@cat", "1.2K"), key("@dog", "1.2K"))
    }

    @Test fun `entry names are stripped of the package prefix`() {
        assertEquals("reel_recycler", ShortVideoMatchers.entryName("com.google.android.youtube:id/reel_recycler"))
        assertNull(ShortVideoMatchers.entryName(null))
    }
}
