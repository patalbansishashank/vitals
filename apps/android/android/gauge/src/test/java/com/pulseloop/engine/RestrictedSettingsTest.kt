package com.pulseloop.engine

import android.app.AppOpsManager
import android.app.Application
import android.content.pm.PackageInstaller
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * (r071) What the app can say about Android's "restricted settings" for the short-video counter: the app op when a build
 * lets it be read (it does not on a normal phone), else how the app was installed. See [RestrictedSettings].
 */
@RunWith(RobolectricTestRunner::class)
class RestrictedSettingsTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val fromFile = PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE
    private val downloaded = PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE
    private val store = PackageInstaller.PACKAGE_SOURCE_STORE
    private val other = PackageInstaller.PACKAGE_SOURCE_OTHER

    @Test fun `an app op that holds the app back, or that the owner has already seen the dialog for, is restricted`() {
        assertEquals(true, RestrictedSettings.verdict(AppOpsManager.MODE_ERRORED, null))
        assertEquals(true, RestrictedSettings.verdict(AppOpsManager.MODE_IGNORED, null))
        // the op wins over how the app was installed, either way
        assertEquals(true, RestrictedSettings.verdict(AppOpsManager.MODE_ERRORED, store))
        assertEquals(false, RestrictedSettings.verdict(AppOpsManager.MODE_ALLOWED, fromFile))
        assertEquals(false, RestrictedSettings.verdict(AppOpsManager.MODE_ALLOWED, null))
    }

    @Test fun `with no answer from the op, a file install is the kind Android holds back and anything else says nothing`() {
        for (op in listOf(null, AppOpsManager.MODE_DEFAULT)) {
            assertEquals(true, RestrictedSettings.verdict(op, fromFile))
            assertEquals(true, RestrictedSettings.verdict(op, downloaded))
            assertNull(RestrictedSettings.verdict(op, store))
            assertNull(RestrictedSettings.verdict(op, other))
            assertNull(RestrictedSettings.verdict(op, PackageInstaller.PACKAGE_SOURCE_UNSPECIFIED))
            assertNull(RestrictedSettings.verdict(op, null))
        }
    }

    @Test fun `isRestricted takes what the phone tells, the op first`() {
        fun ask(op: Int?, source: Int?) = RestrictedSettings.isRestricted(app, { op }, { source })
        // a normal phone: the op cannot be read, so the install is all there is
        assertEquals(true, ask(null, fromFile))
        assertNull(ask(null, other))
        assertEquals(false, ask(AppOpsManager.MODE_ALLOWED, fromFile))
        assertEquals(true, ask(AppOpsManager.MODE_IGNORED, other))
    }

    @Test fun `the real readers use the op the phone has, and the install it has on record`() {
        val pm = shadowOf(app.packageManager)
        val ops = shadowOf(app.getSystemService(AppOpsManager::class.java))
        val uid = app.applicationInfo.uid
        fun op(mode: Int) = ops.setMode(RestrictedSettings.OP, uid, app.packageName, mode)
        fun installedAs(source: Int) =
            pm.setInstallSourceInfo(app.packageName, "com.android.shell", null, null, "com.google.android.packageinstaller", null, source)
        installedAs(store)
        op(AppOpsManager.MODE_IGNORED)
        assertEquals(true, RestrictedSettings.isRestricted(app))
        op(AppOpsManager.MODE_ALLOWED)
        assertEquals(false, RestrictedSettings.isRestricted(app))
        // Android 16's "decide later" goes by the install on record
        op(AppOpsManager.MODE_DEFAULT)
        assertNull(RestrictedSettings.isRestricted(app))
        installedAs(fromFile)
        assertEquals(true, RestrictedSettings.isRestricted(app))
    }

    @Test @Config(sdk = [28])
    fun `before Android 13 nothing holds a service back`() {
        assertEquals(false, RestrictedSettings.isRestricted(app))
        assertEquals(false, RestrictedSettings.isRestricted(app, { null }, { fromFile }))
    }
}
