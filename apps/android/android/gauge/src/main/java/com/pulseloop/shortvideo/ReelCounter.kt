package com.pulseloop.shortvideo

/**
 * What the accessibility service tells the counter, already reduced to plain data. Recorded
 * sequences of these are the test fixtures, so keep them serialisable and free of Android types.
 */
sealed interface FeedInput {
    val atMs: Long

    /**
     * A classification of the foreground window. [app] null means the foreground is neither
     * Instagram nor YouTube (home screen, another app, the screen went off).
     */
    data class Screen(
        override val atMs: Long,
        val app: ShortVideoApp?,
        val inShortVideo: Boolean,
        val pageKey: String? = null,
        val pageHeightPx: Int = 0,
    ) : FeedInput

    /**
     * A TYPE_VIEW_SCROLLED from the short-video pager itself (the service drops scrolls from
     * comment sheets and other lists). Indices are -1 when the view does not report them.
     */
    data class Scroll(
        override val atMs: Long,
        val app: ShortVideoApp,
        val fromIndex: Int = -1,
        val toIndex: Int = -1,
        val itemCount: Int = -1,
        val deltaY: Int = 0,
        val pageHeightPx: Int = 0,
    ) : FeedInput

    /** Time passing with no event (the service's handler tick). */
    data class Tick(override val atMs: Long) : FeedInput
}

sealed interface CounterEvent {
    val app: ShortVideoApp
    data class SessionStarted(override val app: ShortVideoApp, val atMs: Long) : CounterEvent
    data class SessionEnded(override val app: ShortVideoApp, val atMs: Long) : CounterEvent
    /** One new item. [signal] says what proved it: enter, index, delta or fingerprint. */
    data class NewReel(override val app: ShortVideoApp, val atMs: Long, val signal: String) : CounterEvent
}

/**
 * Turns the event stream into "one per new item":
 *
 * - **Session.** Entering a Reels/Shorts screen starts one; it ends only after the screen has been
 *   gone for [exitGraceMs], so a comment sheet or a one-frame layout blip does not restart it.
 * - **The first item** counts once the session has lasted [enterDwellMs], unless it is the same
 *   item a session of the same app ended on moments ago (switching apps and back).
 * - **Settle.** Scroll events only accumulate; a page change is judged once no scroll has arrived
 *   for [settleMs]. Jitter inside one page therefore never counts.
 * - **New, not revisited.** Within a session every position seen is remembered, so scrolling back
 *   and forward again counts nothing. The position comes from the best signal the app gives:
 *   the pager's own index (fromIndex == toIndex once settled), else the summed scroll delta in
 *   pages, else a change of the in-memory page fingerprint.
 */
class ReelCounter(
    private val settleMs: Long = 350,
    private val enterDwellMs: Long = 600,
    private val exitGraceMs: Long = 2_500,
    private val sameItemReentryMs: Long = 90_000,
) {
    private class Session(val app: ShortVideoApp, val startedAt: Long) {
        var initialCounted = false
        var lastScrollAt: Long? = null
        var scrollsSinceSettle = 0
        var settledIndex: Int? = null
        var lastFrom = -1
        var lastTo = -1
        var spannedSinceSettle = false
        var deltaSinceSettle = 0L
        var pageHeight = 0
        var position = 0
        val seenPositions = mutableSetOf(0)
        val seenIndices = mutableSetOf<Int>()
        var initialIndexAnchored = false
        var usesIndices = false
        var usesDelta = false
        var sawScroll = false
        var awaitingFingerprint = false
        var awaitingSince = 0L
        var currentKey: String? = null
        var keyCandidate: String? = null
        var keyCandidateSince = 0L
        val seenKeys = LinkedHashSet<String>()
        var goneSince: Long? = null
    }

    private var session: Session? = null
    private var lastEndedApp: ShortVideoApp? = null
    private var lastEndedAt = Long.MIN_VALUE / 2
    private var lastEndedKey: String? = null

    val activeApp: ShortVideoApp? get() = session?.takeIf { it.goneSince == null }?.app
    val inSession: Boolean get() = session != null

    fun accept(input: FeedInput): List<CounterEvent> {
        val out = mutableListOf<CounterEvent>()
        when (input) {
            is FeedInput.Screen -> onScreen(input, out)
            is FeedInput.Scroll -> onScroll(input, out)
            is FeedInput.Tick -> Unit
        }
        evaluate(input.atMs, out)
        return out
    }

    fun acceptAll(inputs: List<FeedInput>): List<CounterEvent> = inputs.flatMap(::accept)

    /** End the session now (service disabled, screen off). */
    fun reset(atMs: Long): List<CounterEvent> {
        val s = session ?: return emptyList()
        return listOf(endSession(s, atMs))
    }

    private fun onScreen(input: FeedInput.Screen, out: MutableList<CounterEvent>) {
        var s = session
        if (s != null && (input.app != s.app || !input.inShortVideo)) {
            if (input.app != null && input.app != s.app && input.inShortVideo) {
                out += endSession(s, input.atMs)
                s = null
            } else {
                if (s.goneSince == null) s.goneSince = input.atMs
                return
            }
        }
        if (!input.inShortVideo || input.app == null) return
        if (s == null) {
            s = Session(input.app, input.atMs)
            session = s
            out += CounterEvent.SessionStarted(input.app, input.atMs)
        }
        s.goneSince = null
        if (input.pageHeightPx > 0) s.pageHeight = input.pageHeightPx
        val key = input.pageKey
        if (key != null && key != s.keyCandidate) {
            s.keyCandidate = key
            s.keyCandidateSince = input.atMs
        }
    }

    private fun onScroll(input: FeedInput.Scroll, out: MutableList<CounterEvent>) {
        val s = session ?: return
        if (s.app != input.app) return
        s.goneSince = null
        s.sawScroll = true
        s.lastScrollAt = input.atMs
        s.scrollsSinceSettle++
        if (input.pageHeightPx > 0) s.pageHeight = input.pageHeightPx
        if (input.fromIndex >= 0 && input.toIndex >= 0) {
            s.usesIndices = true
            s.lastFrom = input.fromIndex
            s.lastTo = input.toIndex
            if (input.fromIndex == input.toIndex) s.settledIndex = input.fromIndex else s.spannedSinceSettle = true
        }
        if (input.deltaY != 0) {
            s.usesDelta = true
            s.deltaSinceSettle += input.deltaY
        }
    }

    private fun evaluate(now: Long, out: MutableList<CounterEvent>) {
        val s = session ?: return
        s.goneSince?.let { gone ->
            if (now - gone >= exitGraceMs) out += endSession(s, now)
            return
        }

        if (!s.initialCounted && now - s.startedAt >= enterDwellMs) {
            s.initialCounted = true
            // The fingerprint may already be stable; adopt it as the first item's identity.
            val firstKey = s.keyCandidate
            if (firstKey != null) { s.currentKey = firstKey; s.seenKeys.add(firstKey) }
            val reentry = lastEndedApp == s.app && s.startedAt - lastEndedAt <= sameItemReentryMs &&
                firstKey != null && firstKey == lastEndedKey
            if (!reentry) out += CounterEvent.NewReel(s.app, now, "enter")
        }

        val lastScroll = s.lastScrollAt
        if (lastScroll != null && s.scrollsSinceSettle > 0 && now - lastScroll >= settleMs) {
            settle(s, now, out)
        }

        // Fingerprint path: a settle with no index/delta waits for the next stable key, and an app
        // that sends no pager scrolls at all is followed by key changes alone.
        val candidate = s.keyCandidate
        if (candidate != null && candidate != s.currentKey && now - s.keyCandidateSince >= settleMs && s.initialCounted) {
            val fingerprintDriven = (!s.usesIndices && !s.usesDelta) && (s.awaitingFingerprint || !s.sawScroll)
            if (fingerprintDriven) {
                s.awaitingFingerprint = false
                if (s.seenKeys.add(candidate)) out += CounterEvent.NewReel(s.app, now, "fingerprint")
                trimKeys(s)
            } else {
                s.seenKeys.add(candidate)
                trimKeys(s)
            }
            s.currentKey = candidate
        }
        if (s.awaitingFingerprint && now - s.awaitingSince > FINGERPRINT_WAIT_MS) s.awaitingFingerprint = false
    }

    private fun settle(s: Session, now: Long, out: MutableList<CounterEvent>) {
        s.scrollsSinceSettle = 0
        val delta = s.deltaSinceSettle
        val moved = delta != 0L || s.spannedSinceSettle
        // A settle that ends between pages still names the page it is heading to by direction.
        val index = s.settledIndex ?: when {
            delta > 0 -> s.lastTo
            delta < 0 -> s.lastFrom
            else -> null
        }
        s.deltaSinceSettle = 0
        s.settledIndex = null
        s.spannedSinceSettle = false
        when {
            s.usesIndices && index != null && index >= 0 -> {
                if (!s.initialIndexAnchored) {
                    s.initialIndexAnchored = true
                    if (!moved) {
                        // A layout pass reporting where the pager already is: the entry item.
                        s.seenIndices += index
                        return
                    }
                    // The entry item was counted without an index; it sits one page behind the
                    // first settled move (ahead, if that move went backwards).
                    s.seenIndices += if (delta < 0) index + 1 else index - 1
                }
                if (s.seenIndices.add(index)) out += CounterEvent.NewReel(s.app, now, "index")
            }
            s.usesIndices -> Unit
            s.usesDelta && delta != 0L -> {
                val pages = pagesFor(delta, s.pageHeight)
                if (pages != 0) {
                    s.position += pages
                    if (s.seenPositions.add(s.position)) out += CounterEvent.NewReel(s.app, now, "delta")
                }
            }
            s.usesDelta -> Unit
            else -> { s.awaitingFingerprint = true; s.awaitingSince = now }
        }
    }

    /** A drag that snaps back moves less than half a page and is not a page change. */
    private fun pagesFor(delta: Long, pageHeight: Int): Int {
        if (pageHeight <= 0) return if (delta > 0) 1 else -1
        return Math.round(delta.toDouble() / pageHeight).toInt()
    }

    private fun trimKeys(s: Session) {
        while (s.seenKeys.size > MAX_KEYS) s.seenKeys.remove(s.seenKeys.first())
    }

    private fun endSession(s: Session, now: Long): CounterEvent {
        session = null
        lastEndedApp = s.app
        lastEndedAt = now
        lastEndedKey = s.currentKey ?: s.keyCandidate
        return CounterEvent.SessionEnded(s.app, now)
    }

    private companion object {
        const val MAX_KEYS = 400
        const val FINGERPRINT_WAIT_MS = 2_000L
    }
}
