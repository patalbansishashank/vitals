package com.pulseloop.shortvideo

/** The part of the settings the limit logic needs. */
data class LimitConfig(
    val enabled: Boolean = true,
    val dailyLimit: Int = ShortVideoSettings.DEFAULT_LIMIT,
    val countdownSeconds: Int = ShortVideoSettings.DEFAULT_COUNTDOWN_SECONDS,
)

sealed interface LimitEffect {
    /** Show (or restart) the full-screen countdown. [firstHit] is the reel that reached the limit. */
    data class ShowCountdown(val secondsLeft: Int, val firstHit: Boolean, val count: Int, val limit: Int) : LimitEffect
    data class UpdateCountdown(val secondsLeft: Int) : LimitEffect
    /** Countdown ran out: send the user to the home screen. */
    data object GoHome : LimitEffect
    /** The user pressed Cancel: they may keep watching this one reel. */
    data object Cancelled : LimitEffect
    /** Hide the countdown without consequence (they left Reels/Shorts themselves). */
    data object Dismiss : LimitEffect
}

/**
 * The limit state machine. Every new reel at or over the daily limit starts a countdown; when it
 * runs out the user is sent home, and Cancel spares only the reel on screen (the next new one
 * starts a fresh countdown). Turning the whole thing off is only possible from Gauge's settings,
 * never from the overlay.
 *
 * `limit_hits` counts countdowns started; `cancels` counts Cancel presses.
 */
class LimitController(var config: LimitConfig = LimitConfig()) {
    private var deadline: Long? = null
    private var lastShownSeconds = -1

    val counting: Boolean get() = deadline != null

    fun onNewReel(atMs: Long, countToday: Int): LimitEffect? {
        if (!config.enabled || config.dailyLimit <= 0) return null
        if (countToday < config.dailyLimit) return null
        val seconds = config.countdownSeconds.coerceIn(1, 60)
        deadline = atMs + seconds * 1_000L
        lastShownSeconds = seconds
        return LimitEffect.ShowCountdown(seconds, countToday == config.dailyLimit, countToday, config.dailyLimit)
    }

    fun onTick(atMs: Long): LimitEffect? {
        val end = deadline ?: return null
        if (atMs >= end) {
            deadline = null
            lastShownSeconds = -1
            return LimitEffect.GoHome
        }
        val left = secondsLeft(end, atMs)
        if (left == lastShownSeconds) return null
        lastShownSeconds = left
        return LimitEffect.UpdateCountdown(left)
    }

    fun onCancel(): LimitEffect? {
        if (deadline == null) return null
        deadline = null
        lastShownSeconds = -1
        return LimitEffect.Cancelled
    }

    /** Left the short-video screen (or the feature was switched off in settings). */
    fun onLeft(): LimitEffect? {
        if (deadline == null) return null
        deadline = null
        lastShownSeconds = -1
        return LimitEffect.Dismiss
    }

    private fun secondsLeft(end: Long, now: Long): Int = ((end - now + 999) / 1_000).toInt()
}
