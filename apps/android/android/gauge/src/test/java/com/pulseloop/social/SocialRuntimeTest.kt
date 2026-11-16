package com.pulseloop.social

import android.app.AppOpsManager
import android.app.Application
import android.app.usage.UsageEvents
import android.os.Process
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** The device-touching edges: the Android event-type mapping, the Usage-access grant check, the settings screen. */
@RunWith(RobolectricTestRunner::class)
class SocialRuntimeTest {
    private val app: Application = ApplicationProvider.getApplicationContext()

    @Test fun `the Android event types fold to foreground, background or other`() {
        assertEquals(SocialUsageReader.Kind.FOREGROUND, SocialUsageReader.kindOf(UsageEvents.Event.MOVE_TO_FOREGROUND))
        assertEquals(SocialUsageReader.Kind.FOREGROUND, SocialUsageReader.kindOf(UsageEvents.Event.ACTIVITY_RESUMED))
        assertEquals(SocialUsageReader.Kind.BACKGROUND, SocialUsageReader.kindOf(UsageEvents.Event.MOVE_TO_BACKGROUND))
        assertEquals(SocialUsageReader.Kind.BACKGROUND, SocialUsageReader.kindOf(UsageEvents.Event.ACTIVITY_PAUSED))
        assertEquals(SocialUsageReader.Kind.BACKGROUND, SocialUsageReader.kindOf(UsageEvents.Event.ACTIVITY_STOPPED))
        assertEquals(SocialUsageReader.Kind.OTHER, SocialUsageReader.kindOf(UsageEvents.Event.CONFIGURATION_CHANGE))
    }

    @Test fun `usage access is granted only when the op is allowed`() {
        val appOps = shadowOf(app.getSystemService(AppOpsManager::class.java))
        appOps.setMode(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), app.packageName, AppOpsManager.MODE_IGNORED)
        assertFalse(SocialUsageAccess.isGranted(app))
        appOps.setMode(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), app.packageName, AppOpsManager.MODE_ALLOWED)
        assertTrue(SocialUsageAccess.isGranted(app))
    }

    @Test fun `the settings intent targets the Usage-access screen`() {
        val intent = SocialUsageAccess.settingsIntent(app)
        assertEquals(Settings.ACTION_USAGE_ACCESS_SETTINGS, intent.action)
        assertEquals("package:${app.packageName}", intent.data.toString())
    }

    @Test fun `settings persist and the target band is kept sane`() {
        val settings = SocialSettings.get(app)
        settings.update { it.copy(enabledApps = setOf(SocialApp.YOUTUBE, SocialApp.REDDIT), targetMinMinutes = 60, targetMaxMinutes = 20) }
        val p = settings.prefs.value
        assertEquals(setOf(SocialApp.YOUTUBE, SocialApp.REDDIT), p.enabledApps)
        // min never above max: they swap
        assertEquals(20, p.targetMinMinutes)
        assertEquals(60, p.targetMaxMinutes)
        assertEquals(listOf("youtube", "reddit"), p.enabledKeys)
    }

    @Test fun `the defaults are the owner's common set and the 30 to 45 band`() {
        val p = SocialPrefs()
        assertTrue(p.enabled)
        assertEquals(7, p.enabledApps.size)
        assertEquals(30, p.targetMinMinutes)
        assertEquals(45, p.targetMaxMinutes)
        assertEquals(listOf("instagram", "youtube", "facebook", "snapchat", "twitter", "reddit", "tiktok"), SocialApp.keys)
    }
}
