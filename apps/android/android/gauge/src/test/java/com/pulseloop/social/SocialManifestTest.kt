package com.pulseloop.social

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * (SPEC social-time) The whole reason for the feature: Vitals must declare NO accessibility service, so banking and
 * payment apps (GPay and others) run normally. This asserts the engine's source manifest — the only one that ever
 * declared the short-video accessibility service — contains no service bound with BIND_ACCESSIBILITY_SERVICE and no
 * accessibility-service meta-data, and that Usage access is declared instead. Unit tests run in the gauge module's own
 * folder, so the path is relative to it.
 */
class SocialManifestTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private fun parse(path: String): Element {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return factory.newDocumentBuilder().parse(File(path)).documentElement
    }

    private fun Element.children(tag: String): List<Element> {
        val nodes = getElementsByTagName(tag)
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    private val manifest = parse("src/main/AndroidManifest.xml")

    @Test fun `no service is bound as an accessibility service`() {
        val services = manifest.children("service")
        for (service in services) {
            assertTrue(
                "${service.getAttributeNS(android, "name")} must not require BIND_ACCESSIBILITY_SERVICE",
                service.getAttributeNS(android, "permission") != "android.permission.BIND_ACCESSIBILITY_SERVICE",
            )
        }
    }

    @Test fun `no accessibility-service meta-data or intent filter remains`() {
        val metaNames = manifest.children("meta-data").map { it.getAttributeNS(android, "name") }
        assertTrue("no android.accessibilityservice meta-data", metaNames.none { it == "android.accessibilityservice" })
        val actions = manifest.children("action").map { it.getAttributeNS(android, "name") }
        assertTrue(
            "no accessibility-service intent action",
            actions.none { it == "android.accessibilityservice.AccessibilityService" },
        )
    }

    @Test fun `usage access is declared in place of the accessibility service`() {
        val perms = manifest.children("uses-permission").map { it.getAttributeNS(android, "name") }
        assertTrue("PACKAGE_USAGE_STATS is declared", "android.permission.PACKAGE_USAGE_STATS" in perms)
    }
}
