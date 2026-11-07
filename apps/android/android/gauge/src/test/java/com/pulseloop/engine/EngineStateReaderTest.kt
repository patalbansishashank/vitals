package com.pulseloop.engine

import android.app.AppOpsManager
import android.app.Application
import android.content.pm.PackageInstaller
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.shortvideo.ShortVideoRuntime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** (r071) The permissions the engine reports carry Android's hold on the short-video counter, only while the counter is off. */
@RunWith(RobolectricTestRunner::class)
class EngineStateReaderTest {
    private val app: Application = ApplicationProvider.getApplicationContext()

    private fun installedAs(source: Int) = shadowOf(app.packageManager)
        .setInstallSourceInfo(app.packageName, "com.android.shell", null, null, "com.google.android.packageinstaller", null, source)

    private fun counter(on: Boolean) = Settings.Secure.putString(
        app.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        if (on) ShortVideoRuntime.component(app).flattenToString() else "",
    )

    @Test fun `with the counter off, the permissions say whether Android holds it back, from the install on record`() {
        counter(false)
        installedAs(PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE)
        // the phone cannot be asked for the op itself: unreadable is how a normal phone answers
        shadowOf(app.getSystemService(AppOpsManager::class.java)).setMode(RestrictedSettings.OP, app.applicationInfo.uid, app.packageName, AppOpsManager.MODE_DEFAULT)
        val p = EngineStateReader.permissions(app, Perm.GRANTED)
        assertFalse(p.shortVideoAccessibility)
        assertEquals(true, p.shortVideoRestricted)
        installedAs(PackageInstaller.PACKAGE_SOURCE_OTHER)
        assertNull(EngineStateReader.permissions(app, Perm.GRANTED).shortVideoRestricted)
    }

    @Test fun `with the counter on, the hold is not asked about`() {
        counter(true)
        installedAs(PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE)
        shadowOf(app.getSystemService(AppOpsManager::class.java)).setMode(RestrictedSettings.OP, app.applicationInfo.uid, app.packageName, AppOpsManager.MODE_IGNORED)
        val p = EngineStateReader.permissions(app, Perm.GRANTED)
        assertTrue(p.shortVideoAccessibility)
        assertNull(p.shortVideoRestricted)
    }
}
