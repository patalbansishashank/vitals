package com.pulseloop.shortvideo

import android.graphics.Rect
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Flattens an accessibility tree into [ScreenSnapshot]. Bounded in nodes and depth so a huge
 * comment list cannot stall the service. Labels are capped and stay in memory (fingerprint only).
 */
internal object NodeSnapshotter {
    private const val MAX_NODES = 600
    private const val MAX_DEPTH = 40
    private const val MAX_LABEL = 80

    fun snapshot(root: AccessibilityNodeInfo, packageName: String): ScreenSnapshot {
        val rootRect = Rect().also(root::getBoundsInScreen)
        val nodes = ArrayList<ScreenNode>(128)
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.addLast(root to 0)
        val rect = Rect()
        while (queue.isNotEmpty() && nodes.size < MAX_NODES) {
            val (node, depth) = queue.removeFirst()
            node.getBoundsInScreen(rect)
            val label = (node.text ?: node.contentDescription)?.toString()?.take(MAX_LABEL)
            nodes += ScreenNode(
                viewId = ShortVideoMatchers.entryName(node.viewIdResourceName),
                className = node.className?.toString(),
                left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom,
                visible = node.isVisibleToUser,
                scrollable = node.isScrollable,
                depth = depth,
                label = label,
            )
            if (depth < MAX_DEPTH) {
                for (i in 0 until node.childCount) {
                    val child = runCatching { node.getChild(i) }.getOrNull() ?: continue
                    queue.addLast(child to depth + 1)
                }
            }
            if (node !== root) recycle(node)
        }
        while (queue.isNotEmpty()) recycle(queue.removeFirst().first)
        return ScreenSnapshot(
            packageName = packageName,
            screenWidth = rootRect.width(),
            screenHeight = rootRect.height(),
            nodes = nodes,
        )
    }

    /** The scroll source's own view id, or its nearest ancestor's (ViewPager2 hides its RecyclerView). */
    fun idOf(node: AccessibilityNodeInfo, maxUp: Int = 3): String? {
        ShortVideoMatchers.entryName(node.viewIdResourceName)?.let { return it }
        var current: AccessibilityNodeInfo? = node.parent
        var steps = 0
        while (current != null && steps < maxUp) {
            val id = ShortVideoMatchers.entryName(current.viewIdResourceName)
            val next = if (id == null) current.parent else null
            recycle(current)
            if (id != null) return id
            current = next
            steps++
        }
        current?.let(::recycle)
        return null
    }

    @Suppress("DEPRECATION")
    fun recycle(node: AccessibilityNodeInfo) {
        if (Build.VERSION.SDK_INT < 33) runCatching { node.recycle() }
    }
}
