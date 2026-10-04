package desi.creative.vitals

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * The app's WebView storage holds the health database, the sync words and the server pairing: no backup of it may
 * reach the cloud or a new phone, and Bluetooth must be able to start on Android 8–11. Reads the source manifest
 * (unit tests run in the app module's folder).
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
    fun bothLocationPermissionsDeclaredBelowAndroid12() {
        val perms = parse("src/main/AndroidManifest.xml").children("uses-permission")
            .associateBy { it.getAttributeNS(android, "name") }
        for (name in listOf("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION")) {
            val perm = perms[name] ?: error("$name missing")
            assertEquals("30", perm.getAttributeNS(android, "maxSdkVersion"))
            assertTrue("$name must not be removed", perm.getAttributeNS("http://schemas.android.com/tools", "node") != "remove")
        }
    }
}
