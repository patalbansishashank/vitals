package desi.creative.vitals

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * The app's WebView storage holds the health database, the sync words and the server pairing: no backup of it may
 * reach the cloud or a new phone. The app asks for nothing beyond the network, the camera (QR scanner), what app
 * updates need (network state, asking to install) and Gauge's workout control (energy SPEC §A.4 item 10: exactly the
 * release and debug `CONTROL_WORKOUT` permissions, and only those two packages are visible): no Bluetooth, location or
 * background service, and no receiver but the home-screen widgets' providers (the plugin's result receiver is created in
 * code). Reads the source manifest (unit tests run in the app module's folder).
 */
class ManifestPrivacyTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private fun parse(path: String): Element {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return factory.newDocumentBuilder().parse(File(path)).documentElement
    }

    private fun Element.children(tag: String): List<Element> {
        val nodes = getElementsByTagName(tag)
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    @Test
    fun backupIsOffEverywhere() {
        val app = parse("src/main/AndroidManifest.xml").children("application").single()
        assertEquals("false", app.getAttributeNS(android, "allowBackup"))
        assertEquals("false", app.getAttributeNS(android, "fullBackupContent"))
        assertEquals("@xml/data_extraction_rules", app.getAttributeNS(android, "dataExtractionRules"))
    }

    @Test
    fun theAppIsPortraitOnPhones() {
        // (0.6.5) the owner asked for a portrait-locked phone app; Android 16 ignores this on large screens, as it should
        val main = parse("src/main/AndroidManifest.xml").children("activity").single { it.getAttributeNS(android, "name") == ".MainActivity" }
        assertEquals("portrait", main.getAttributeNS(android, "screenOrientation"))
    }

    /**
     * (r071) The FileProvider hands out exports only. The downloaded update is private to the app: it is copied into an
     * install session (OtaInstall), never shared with the system installer through a URI.
     */
    @Test
    fun theFileProviderSharesExportsOnly() {
        val paths = parse("src/main/res/xml/file_paths.xml")
        val entries = (0 until paths.childNodes.length).map { paths.childNodes.item(it) }.filterIsInstance<Element>()
        assertEquals(listOf("cache-path" to "exports/"), entries.map { it.tagName to it.getAttribute("path") })
    }

    @Test
    fun extractionRulesExcludeEveryDomain() {
        val rules = parse("src/main/res/xml/data_extraction_rules.xml")
        for (section in listOf("cloud-backup", "device-transfer")) {
            val block = rules.children(section).single()
            assertTrue("$section must not include anything", block.children("include").isEmpty())
            val excluded = block.children("exclude").filter { it.getAttribute("path") == "." }.map { it.getAttribute("domain") }
            for (domain in listOf("root", "file", "database", "sharedpref", "external")) {
                assertTrue("$section must exclude $domain", domain in excluded)
            }
        }
    }

    @Test
    fun onlyTheNetworkTheCameraUpdatesAndGaugeControl() {
        val manifest = parse("src/main/AndroidManifest.xml")
        val perms = manifest.children("uses-permission").map { it.getAttributeNS(android, "name") }.toSet()
        assertEquals(
            setOf(
                "android.permission.INTERNET",
                "android.permission.CAMERA",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.REQUEST_INSTALL_PACKAGES",
                "com.pulseloop.permission.CONTROL_WORKOUT",
                "com.pulseloop.debug.permission.CONTROL_WORKOUT",
            ),
            perms,
        )
        val queries = manifest.children("queries").flatMap { q -> q.children("package").map { it.getAttributeNS(android, "name") } }.toSet()
        assertEquals(setOf("com.pulseloop", "com.pulseloop.debug"), queries)
        assertTrue("no intent queries", manifest.children("queries").all { it.children("intent").isEmpty() && it.children("provider").isEmpty() })
        val app = manifest.children("application").single()
        assertTrue("no services", app.children("service").isEmpty())
    }

    /**
     * (0.6.6, r071) The only receivers are the app-widget providers, one per card (the four that existed keep their class
     * names; Energy, Sleep, Steps and Weight came with r071): not exported (the system's widget host reaches them anyway),
     * listening to the widget update alone, home screen only (never the lock screen, where anyone could read them), and
     * none fetches anything (no permission was added for them). A new receiver is a deliberate privacy decision: it is
     * added to this list by hand.
     */
    @Test
    fun theOnlyReceiversAreHomeScreenWidgets() {
        val app = parse("src/main/AndroidManifest.xml").children("application").single()
        val receivers = app.children("receiver")
        assertEquals(
            setOf(
                ".widgets.TodayWidgetProvider",
                ".widgets.RingWidgetProvider",
                ".widgets.ActionsWidgetProvider",
                ".widgets.LogWidgetProvider",
                ".widgets.EnergyWidgetProvider",
                ".widgets.SleepWidgetProvider",
                ".widgets.StepsWidgetProvider",
                ".widgets.WeightWidgetProvider",
            ),
            receivers.map { it.getAttributeNS(android, "name") }.toSet(),
        )
        for (r in receivers) {
            val name = r.getAttributeNS(android, "name")
            assertEquals("$name is not exported", "false", r.getAttributeNS(android, "exported"))
            assertTrue("$name has no permission of its own", r.getAttributeNS(android, "permission").isEmpty())
            val actions = r.children("action").map { it.getAttributeNS(android, "name") }
            assertEquals("$name listens to the widget update only", listOf("android.appwidget.action.APPWIDGET_UPDATE"), actions)
            assertTrue("$name: no data or category filters", r.children("data").isEmpty() && r.children("category").isEmpty())
            val meta = r.children("meta-data").single()
            assertEquals("android.appwidget.provider", meta.getAttributeNS(android, "name"))
            val info = parse("src/main/res/xml/" + meta.getAttributeNS(android, "resource").removePrefix("@xml/") + ".xml")
            assertEquals("$name is on the home screen only", "home_screen", info.getAttributeNS(android, "widgetCategory"))
            assertTrue("$name has no configuration screen", info.getAttributeNS(android, "configure").isEmpty())
        }
    }
}
