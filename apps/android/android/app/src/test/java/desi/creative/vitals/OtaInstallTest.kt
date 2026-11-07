package desi.creative.vitals

import android.app.Application
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import desi.creative.vitals.OtaInstall.Outcome
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/**
 * (r071) The APK update goes in through an install session, with the system's own confirmation: the status answers, the
 * confirmation that opens, the words when it does not install, and the session that is staged.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OtaInstallTest {
    private val app: Application = RuntimeEnvironment.getApplication()
    private val installer get() = app.packageManager.packageInstaller
    private val apk = File.createTempFile("vitals-update", ".apk")

    @Before
    fun bytes() {
        apk.writeBytes(ByteArray(300_000) { (it % 251).toByte() })
        ShadowToast.reset()
        // the installer is one object for the whole process: a test starts with none listening
        OtaInstall.stopListening(app)
    }

    @After
    fun clean() {
        apk.delete()
    }

    private fun status(code: Int, confirm: Intent? = null, message: String? = null) = Intent(OtaInstall.ACTION_STATUS).apply {
        putExtra(PackageInstaller.EXTRA_STATUS, code)
        confirm?.let { putExtra(Intent.EXTRA_INTENT, it) }
        message?.let { putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, it) }
    }

    @Test
    fun everyStatusHasAnOutcomeAndOnlyTheOwnersNoIsSilent() {
        assertEquals(Outcome.Confirm, OtaInstall.outcome(PackageInstaller.STATUS_PENDING_USER_ACTION))
        assertEquals(Outcome.Installed, OtaInstall.outcome(PackageInstaller.STATUS_SUCCESS))
        val failures = listOf(
            PackageInstaller.STATUS_FAILURE, PackageInstaller.STATUS_FAILURE_BLOCKED, PackageInstaller.STATUS_FAILURE_ABORTED,
            PackageInstaller.STATUS_FAILURE_INVALID, PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_STORAGE,
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, PackageInstaller.STATUS_FAILURE_TIMEOUT,
        )
        val outcomes = failures.map { OtaInstall.outcome(it) as Outcome.Failed }
        assertEquals(listOf(PackageInstaller.STATUS_FAILURE_ABORTED), failures.filterIndexed { i, _ -> outcomes[i].cancelled })
        // each failure has its own plain words, and a status nobody knows still has some
        assertEquals(failures.size, outcomes.map { it.reason }.toSet().size)
        assertEquals(Outcome.Failed("Android could not install it."), OtaInstall.outcome(999))
    }

    @Test
    fun theSystemsConfirmationOpensWhenItAsks() {
        val confirm = Intent("android.content.pm.action.CONFIRM_INSTALL").putExtra("android.content.pm.extra.SESSION_ID", 7)
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_PENDING_USER_ACTION, confirm))
        val opened = shadowOf(app).nextStartedActivity
        assertEquals("android.content.pm.action.CONFIRM_INSTALL", opened.action)
        assertEquals(7, opened.getIntExtra("android.content.pm.extra.SESSION_ID", -1))
        assertTrue(opened.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(0, ShadowToast.shownToastCount())
    }

    @Test
    fun aRequestForConfirmationWithoutOneSaysSoInsteadOfOpeningNothing() {
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_PENDING_USER_ACTION))
        assertNull(shadowOf(app).nextStartedActivity)
        assertEquals("Vitals was not updated. The confirmation did not open. Tap Install again.", ShadowToast.getTextOfLatestToast())
    }

    @Test
    fun aFailureSaysWhyAndACancelSaysNothing() {
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_FAILURE_STORAGE, message = "INSTALL_FAILED_INSUFFICIENT_STORAGE"))
        assertEquals("Vitals was not updated. There is not enough space on the phone.", ShadowToast.getTextOfLatestToast())
        ShadowToast.reset()
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_FAILURE_ABORTED))
        assertEquals(0, ShadowToast.shownToastCount())
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_SUCCESS))
        assertEquals(0, ShadowToast.shownToastCount())
    }

    private fun field(params: Any, name: String) = params.javaClass.getField(name).get(params)

    @Test
    fun theSessionIsAFullInstallOfThisAppThatAsksForUserActionAndClaimsNoSource() {
        val params = OtaInstall.params(app, 123_456L)
        assertEquals(PackageInstaller.SessionParams.MODE_FULL_INSTALL, field(params, "mode"))
        assertEquals(app.packageName, field(params, "appPackageName"))
        assertEquals(123_456L, field(params, "sizeBytes"))
        // never silent, even where Android would let an updater skip the confirmation
        assertEquals(PackageInstaller.SessionParams.USER_ACTION_REQUIRED, field(params, "requireUserAction"))
        assertEquals(PackageManager.INSTALL_REASON_USER, field(params, "installReason"))
        // the installer says nothing about where the file came from: not a store, not a file the owner picked
        assertEquals(PackageInstaller.PACKAGE_SOURCE_UNSPECIFIED, field(params, "packageSource"))
    }

    @Test
    fun theCopyKeepsEveryByteAndReportsProgressAboutEveryFivePercentEndingOnOne() {
        val out = java.io.ByteArrayOutputStream()
        val shares = mutableListOf<Float>()
        apk.inputStream().use { OtaInstall.copy(it, out, apk.length(), shares::add) }
        assertTrue(out.toByteArray().contentEquals(apk.readBytes()))
        assertEquals(1f, shares.last(), 0f)
        assertEquals(shares.sorted(), shares)
        assertTrue("about 20 reports, got ${shares.size}", shares.size in 5..21)
    }

    private fun statusReceivers() = shadowOf(app).registeredReceivers.count { it.intentFilter.hasAction(OtaInstall.ACTION_STATUS) }

    @Test
    fun theUpdateIsStagedInASessionForThisAppAndCommitted() {
        assertTrue(OtaInstall.start(app, apk))
        val session = installer.mySessions.single()
        assertEquals(app.packageName, session.appPackageName)
        // the status comes to a receiver registered in code (the manifest has none), for this app only
        assertEquals(1, statusReceivers())
        // Android says it is installed (Robolectric's own commit answers without a status, so the answer is given here):
        // the receiver is dropped, nothing opens, nothing is said
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_SUCCESS))
        assertEquals(0, statusReceivers())
        assertNull(shadowOf(app).nextStartedActivity)
        assertEquals(0, ShadowToast.shownToastCount())
    }

    @Test
    fun theReceiverIsDroppedWhenTheInstallFails() {
        assertTrue(OtaInstall.start(app, apk))
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_PENDING_USER_ACTION, Intent("android.content.pm.action.CONFIRM_INSTALL")))
        // waiting for the owner's OK: still listening
        assertEquals(1, statusReceivers())
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE))
        assertEquals(0, statusReceivers())
        assertEquals("Vitals was not updated. The update does not fit this phone.", ShadowToast.getTextOfLatestToast())
    }

    @Test
    fun aStatusFromAnAbandonedEarlierTryDoesNotEndTheNewOnesListening() {
        assertTrue(OtaInstall.start(app, apk))
        val mine = installer.mySessions.single().sessionId
        // the earlier session's "aborted" arrives late, carrying its own session
        val late = status(PackageInstaller.STATUS_FAILURE_ABORTED).putExtra("desi.creative.vitals.extra.OTA_SESSION", mine + 100)
        OtaInstall.onStatus(app, late)
        assertEquals(1, statusReceivers())
        assertEquals(0, ShadowToast.shownToastCount())
        // this try's own confirmation still opens
        val confirm = Intent("android.content.pm.action.CONFIRM_INSTALL")
        OtaInstall.onStatus(app, status(PackageInstaller.STATUS_PENDING_USER_ACTION, confirm).putExtra("desi.creative.vitals.extra.OTA_SESSION", mine))
        assertEquals("android.content.pm.action.CONFIRM_INSTALL", shadowOf(app).nextStartedActivity.action)
    }

    @Test
    fun aNewTryDoesNotKeepAnEarlierUnfinishedSession() {
        val stale = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        assertTrue(OtaInstall.start(app, apk))
        val sessions = installer.mySessions
        assertEquals(1, sessions.size)
        assertFalse(sessions.single().sessionId == stale)
        assertNotNull(installer.getSessionInfo(sessions.single().sessionId))
    }

    @Test
    fun anEmptyUpdateIsRefusedBeforeAnySessionExists() {
        apk.writeBytes(ByteArray(0))
        try {
            OtaInstall.start(app, apk)
            fail("an empty file is not an update")
        } catch (e: OtaFailure) {
            assertEquals("empty update", e.message)
        }
        assertTrue(installer.mySessions.isEmpty())
    }
}
