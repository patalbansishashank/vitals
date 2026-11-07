package com.pulseloop.shortvideo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage mapping, the limit/countdown state machine and the capsule choice. */
class ShortVideoLogicTest {

    @Test fun `stage thresholds follow 25 50 75 100 and over 150 percent of the limit`() {
        val limit = 40
        val cases = mapOf(
            0 to BrainStage.HEALTHY, 9 to BrainStage.HEALTHY,
            10 to BrainStage.GREYING, 19 to BrainStage.GREYING,
            20 to BrainStage.WILTED, 29 to BrainStage.WILTED,
            30 to BrainStage.CRACKED, 39 to BrainStage.CRACKED,
            40 to BrainStage.ROTTING, 60 to BrainStage.ROTTING,
            61 to BrainStage.ROTTEN, 500 to BrainStage.ROTTEN,
        )
        cases.forEach { (count, stage) -> assertEquals("count $count", stage, BrainStage.forCount(count, limit)) }
        // A zero limit is treated as 1, never a division by zero.
        assertEquals(BrainStage.ROTTEN, BrainStage.forCount(2, 0))
        assertEquals(6, BrainStage.entries.map { it.drawableRes }.distinct().size)
    }

    @Test fun `no countdown below the limit, one at the limit and one for every new reel after`() {
        val c = LimitController(LimitConfig(enabled = true, dailyLimit = 3, countdownSeconds = 5))
        assertNull(c.onNewReel(0, 1))
        assertNull(c.onNewReel(0, 2))
        val first = c.onNewReel(1_000, 3) as LimitEffect.ShowCountdown
        assertTrue(first.firstHit)
        assertEquals(5, first.secondsLeft)
        assertEquals(LimitEffect.Cancelled, c.onCancel())
        assertFalse(c.counting)
        val next = c.onNewReel(20_000, 4) as LimitEffect.ShowCountdown
        assertFalse(next.firstHit)
    }

    @Test fun `the countdown ticks down whole seconds and then goes home`() {
        val c = LimitController(LimitConfig(dailyLimit = 1, countdownSeconds = 5))
        c.onNewReel(10_000, 1)
        assertNull(c.onTick(10_100)) // still 5
        assertEquals(LimitEffect.UpdateCountdown(4), c.onTick(11_000))
        assertNull(c.onTick(11_500))
        assertEquals(LimitEffect.UpdateCountdown(1), c.onTick(14_200))
        assertEquals(LimitEffect.GoHome, c.onTick(15_000))
        assertFalse(c.counting)
        assertNull(c.onTick(16_000))
        assertNull(c.onCancel()) // nothing to cancel any more
    }

    @Test fun `a new reel during a countdown restarts it, leaving dismisses without going home`() {
        val c = LimitController(LimitConfig(dailyLimit = 1, countdownSeconds = 5))
        c.onNewReel(0, 1)
        c.onNewReel(3_000, 2)
        // The first deadline (5 s) has passed but the restarted one (8 s) has not.
        assertEquals(LimitEffect.UpdateCountdown(3), c.onTick(5_500))
        assertEquals(LimitEffect.Dismiss, c.onLeft())
        assertNull(c.onTick(9_000))
    }

    @Test fun `switched off means no countdown at all`() {
        val c = LimitController(LimitConfig(enabled = false, dailyLimit = 1))
        assertNull(c.onNewReel(0, 10))
    }

    @Test fun `settings are clamped to sane ranges`() {
        val p = ShortVideoSettings.sanitise(ShortVideoPrefs(dailyLimit = 0, countdownSeconds = 999))
        assertEquals(1, p.dailyLimit)
        assertEquals(30, p.countdownSeconds)
        assertEquals(30, ShortVideoPrefs().dailyLimit)
        assertEquals(5, ShortVideoPrefs().countdownSeconds)
        assertFalse(ShortVideoPrefs(enabled = false).appEnabled(ShortVideoApp.YOUTUBE))
        assertFalse(ShortVideoPrefs(enabledApps = setOf(ShortVideoApp.INSTAGRAM)).appEnabled(ShortVideoApp.YOUTUBE))
    }

    @Test fun `capsule picks exactly one surface`() {
        val android16 = CapsuleEnvironment(sdkInt = 36, notificationsAllowed = true, canPostPromoted = true, promoted = null)
        val android15 = CapsuleEnvironment(sdkInt = 35, notificationsAllowed = true, canPostPromoted = false, promoted = null)

        assertEquals(CapsuleDecision(true, false), CapsulePolicy.decide(CapsuleMode.AUTO, android16))
        assertEquals(CapsuleDecision(true, false), CapsulePolicy.decide(CapsuleMode.AUTO, android16.copy(promoted = true)))
        // Posted but the system did not promote it: fall back to the overlay.
        assertEquals(CapsuleDecision(false, true), CapsulePolicy.decide(CapsuleMode.AUTO, android16.copy(promoted = false)))
        // Live Updates switched off for the app.
        assertEquals(CapsuleDecision(false, true), CapsulePolicy.decide(CapsuleMode.AUTO, android16.copy(canPostPromoted = false)))
        assertEquals(CapsuleDecision(false, true), CapsulePolicy.decide(CapsuleMode.AUTO, android15))
        assertEquals(CapsuleDecision(false, true), CapsulePolicy.decide(CapsuleMode.AUTO, android16.copy(notificationsAllowed = false)))

        assertEquals(CapsuleDecision(true, false), CapsulePolicy.decide(CapsuleMode.SYSTEM_ONLY, android15))
        assertEquals(CapsuleDecision.NONE, CapsulePolicy.decide(CapsuleMode.SYSTEM_ONLY, android15.copy(notificationsAllowed = false)))
        assertEquals(CapsuleDecision(false, true), CapsulePolicy.decide(CapsuleMode.OVERLAY_ONLY, android16))
    }

    @Test fun `island sits on the camera cutout, or top centre without one`() {
        val g = IslandGeometry.of(IslandScreen(1240, 2772, 120, IslandGeometry.Cutout(580, 30, 660, 110), 3f))
        assertEquals(620, g.centerX)
        assertEquals(70, g.centerY)
        assertEquals(80, g.holeWidth)
        val none = IslandGeometry.of(IslandScreen(1240, 2772, 120, null, 3f))
        assertEquals(620, none.centerX)
        assertEquals(0, none.holeWidth)
        // A wide notch-like cutout (more than 40 % of the width) is not a hole to wrap around.
        assertEquals(0, IslandGeometry.of(IslandScreen(1240, 2772, 120, IslandGeometry.Cutout(100, 0, 1140, 90), 3f)).holeWidth)
    }
}
