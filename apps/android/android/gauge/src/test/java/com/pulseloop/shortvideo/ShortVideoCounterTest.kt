package com.pulseloop.shortvideo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The counting/debounce rules, driven by recorded event sequences in
 * `src/test/resources/shortvideo/` (one reduced accessibility event per line).
 */
class ShortVideoCounterTest {

    private fun fixture(name: String): List<FeedInput> {
        val text = javaClass.classLoader!!.getResource("shortvideo/$name")!!.readText()
        return text.lines().map(String::trim).filter { it.isNotEmpty() && !it.startsWith("#") }.map(::parseLine)
    }

    private fun expectation(name: String, key: String): Int? {
        val text = javaClass.classLoader!!.getResource("shortvideo/$name")!!.readText()
        return Regex("$key=(\\d+)").find(text)?.groupValues?.get(1)?.toInt()
    }

    private fun parseLine(line: String): FeedInput {
        val parts = line.split(Regex("\\s+"))
        val t = parts[0].toLong()
        val args = parts.drop(2).filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
        return when (parts[1]) {
            "tick" -> FeedInput.Tick(t)
            "screen" -> FeedInput.Screen(
                atMs = t,
                app = ShortVideoApp.fromKey(parts[2]),
                inShortVideo = parts.getOrNull(3) == "in",
                pageKey = args["key"],
                pageHeightPx = args["h"]?.toInt() ?: 0,
            )
            "scroll" -> FeedInput.Scroll(
                atMs = t,
                app = ShortVideoApp.fromKey(parts[2])!!,
                fromIndex = args["from"]?.toInt() ?: -1,
                toIndex = args["to"]?.toInt() ?: -1,
                itemCount = args["n"]?.toInt() ?: -1,
                deltaY = args["dy"]?.toInt() ?: 0,
                pageHeightPx = args["h"]?.toInt() ?: 0,
            )
            else -> error("Unknown fixture line: $line")
        }
    }

    private fun run(name: String): List<CounterEvent> = ReelCounter().acceptAll(fixture(name))

    private fun List<CounterEvent>.reels() = filterIsInstance<CounterEvent.NewReel>()

    @Test fun `YouTube indexed pager counts each new item once and not revisits`() {
        val events = run("youtube_indexed.txt")
        val reels = events.reels()
        assertEquals(expectation("youtube_indexed.txt", "reels"), reels.size)
        assertEquals("enter", reels.first().signal)
        assertTrue(reels.drop(1).all { it.signal == "index" })
        assertTrue(reels.all { it.app == ShortVideoApp.YOUTUBE })
        assertEquals(1, events.count { it is CounterEvent.SessionEnded })
    }

    @Test fun `Instagram delta-only pager ignores snap-back drags and jitter`() {
        val reels = run("instagram_delta.txt").reels()
        assertEquals(expectation("instagram_delta.txt", "reels"), reels.size)
        assertEquals(listOf("enter", "delta", "delta", "delta", "delta"), reels.map { it.signal })
    }

    @Test fun `fingerprint fallback counts unseen items and ignores a brief flicker`() {
        val reels = run("fingerprint_only.txt").reels()
        assertEquals(expectation("fingerprint_only.txt", "reels"), reels.size)
        assertEquals(listOf("enter", "fingerprint", "fingerprint", "fingerprint"), reels.map { it.signal })
    }

    @Test fun `short blips keep the session, re-entry on the same item does not recount`() {
        val events = run("leave_and_return.txt")
        assertEquals(expectation("leave_and_return.txt", "reels"), events.reels().size)
        assertEquals(expectation("leave_and_return.txt", "sessions"), events.count { it is CounterEvent.SessionStarted })
    }

    @Test fun `a burst of scroll events inside one settle window is one page`() {
        val c = ReelCounter(settleMs = 350)
        c.accept(FeedInput.Screen(0, ShortVideoApp.YOUTUBE, true, pageHeightPx = 2000))
        c.accept(FeedInput.Tick(700)) // entry counted
        var t = 1_000L
        val out = mutableListOf<CounterEvent>()
        // The finger wobbles for 300 ms, then the pager lands on the next item.
        repeat(10) { out += c.accept(FeedInput.Scroll(t, ShortVideoApp.YOUTUBE, 0, 1, 20, 200, 2000)); t += 30 }
        out += c.accept(FeedInput.Scroll(t, ShortVideoApp.YOUTUBE, 1, 1, 20, 0, 2000))
        assertTrue(out.reels().isEmpty()) // nothing until it settles
        out += c.accept(FeedInput.Tick(t + 200))
        assertTrue(out.reels().isEmpty())
        out += c.accept(FeedInput.Tick(t + 400))
        assertEquals(1, out.reels().size)
        // Ticks after that add nothing.
        assertTrue(c.accept(FeedInput.Tick(t + 5_000)).reels().isEmpty())
    }

    @Test fun `the entry layout pass does not double count the first item`() {
        val c = ReelCounter()
        val out = mutableListOf<CounterEvent>()
        out += c.accept(FeedInput.Screen(0, ShortVideoApp.YOUTUBE, true, pageHeightPx = 2000))
        out += c.accept(FeedInput.Scroll(20, ShortVideoApp.YOUTUBE, 4, 4, 20, 0, 2000))
        out += c.accept(FeedInput.Tick(1_000))
        out += c.accept(FeedInput.Tick(2_000))
        assertEquals(1, out.reels().size)
        assertEquals("enter", out.reels().single().signal)
    }

    @Test fun `switching straight from one app's feed to the other's starts a new session`() {
        val c = ReelCounter()
        val out = mutableListOf<CounterEvent>()
        out += c.accept(FeedInput.Screen(0, ShortVideoApp.INSTAGRAM, true, pageKey = "fp:1"))
        out += c.accept(FeedInput.Tick(1_000))
        out += c.accept(FeedInput.Screen(1_100, ShortVideoApp.YOUTUBE, true, pageKey = "fp:1"))
        out += c.accept(FeedInput.Tick(2_000))
        assertEquals(listOf(ShortVideoApp.INSTAGRAM, ShortVideoApp.YOUTUBE), out.reels().map { it.app })
        assertEquals(1, out.count { it is CounterEvent.SessionEnded })
    }

    @Test fun `scrolls from another app or outside a session are ignored`() {
        val c = ReelCounter()
        assertTrue(c.accept(FeedInput.Scroll(0, ShortVideoApp.YOUTUBE, 0, 1, 5, 500, 2000)).isEmpty())
        c.accept(FeedInput.Screen(10, ShortVideoApp.INSTAGRAM, true))
        c.accept(FeedInput.Tick(1_000))
        c.accept(FeedInput.Scroll(1_100, ShortVideoApp.YOUTUBE, 0, 1, 5, 2000, 2000))
        assertTrue(c.accept(FeedInput.Tick(2_000)).reels().isEmpty())
    }
}
