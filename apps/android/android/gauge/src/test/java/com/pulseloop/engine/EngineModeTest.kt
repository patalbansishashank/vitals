package com.pulseloop.engine

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.GaugeEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class EngineModeTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun installGauge(pkg: String) {
        val info = android.content.pm.PackageInfo().apply {
            packageName = pkg
            applicationInfo = android.content.pm.ApplicationInfo().apply { packageName = pkg }
        }
        shadowOf(context.packageManager).installPackage(info)
    }

    private fun tookOver(value: Boolean) {
        context.getSharedPreferences("vitals_engine", Context.MODE_PRIVATE).edit().putBoolean("took_over", value).commit()
    }

    @Test fun `Gauge installed means passive, whatever the person tapped`() {
        assertEquals(EngineMode.PASSIVE, EngineMode.of(gaugeInstalled = true, tookOver = false))
        assertEquals(EngineMode.PASSIVE, EngineMode.of(gaugeInstalled = true, tookOver = true))
    }

    @Test fun `Gauge gone needs the tap, then runs`() {
        assertEquals(EngineMode.NEEDS_TAKEOVER, EngineMode.of(gaugeInstalled = false, tookOver = false))
        assertEquals(EngineMode.ACTIVE, EngineMode.of(gaugeInstalled = false, tookOver = true))
    }

    @Test fun `the wire names are the contract's`() {
        assertEquals(listOf("passive", "needsTakeover", "active"), EngineMode.entries.map { it.wire })
    }

    @Test fun `both Gauge builds are found, the release one first`() {
        assertTrue(GaugePresence.installed(context).isEmpty())
        installGauge("com.pulseloop.debug")
        assertEquals(listOf("com.pulseloop.debug"), GaugePresence.installed(context))
        installGauge("com.pulseloop")
        assertEquals(listOf("com.pulseloop", "com.pulseloop.debug"), GaugePresence.installed(context))
    }

    @Test fun `the engine is off while Gauge is installed and on once it is gone and taken over`() {
        tookOver(true)
        installGauge("com.pulseloop.debug")
        assertEquals(EngineMode.PASSIVE, GaugeEngine.mode(context))
        assertFalse(GaugeEngine.isActive(context))
    }

    @Test fun `the engine waits for the tap when Gauge is not there`() {
        tookOver(false)
        // a fresh process sees no Gauge
        assertEquals(EngineMode.NEEDS_TAKEOVER, EngineMode.of(GaugePresence.installed(context).isNotEmpty(), GaugeEngine.tookOver(context)))
    }

    @Test fun `uninstall opens the delete screen for the Gauge that is installed, release before debug`() {
        assertNull(GaugeEngine.uninstallGaugeIntent(context))
        installGauge("com.pulseloop.debug")
        assertEquals("package:com.pulseloop.debug", GaugeEngine.uninstallGaugeIntent(context)!!.data.toString())
        installGauge("com.pulseloop")
        val intent = GaugeEngine.uninstallGaugeIntent(context)!!
        assertEquals(Intent.ACTION_DELETE, intent.action)
        assertEquals("package:com.pulseloop", intent.data.toString())
    }
}
