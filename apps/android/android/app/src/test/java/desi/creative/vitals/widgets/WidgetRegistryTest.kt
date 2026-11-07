package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.design.WidgetRegistry
import desi.creative.vitals.widgets.design.WidgetTargets
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.w3c.dom.Element

/**
 * design/widgets.json is the registry: every card in it has its receiver in the app manifest, its provider class, its info
 * file with the cells it says, home screen only and no configuration screen, a label and a description in the strings,
 * and a tap target the links know. A provider's class name never changes: removing one deletes the widgets placed from it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetRegistryTest {
    private val android = "http://schemas.android.com/apk/res/android"
    private val registry = JSONObject(File("../../../../design/widgets.json").readText())

    private fun parse(path: String): Element = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path)).documentElement

    private fun Element.children(tag: String): List<Element> = getElementsByTagName(tag).let { n -> (0 until n.length).map { n.item(it) as Element } }

    private val widgets = registry.getJSONArray("widgets").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private val receivers = parse("src/main/AndroidManifest.xml").children("receiver").associateBy { it.getAttributeNS(android, "name") }
    private val strings = parse("src/main/res/values/widget_strings.xml").children("string").associate { it.getAttribute("name") to it.textContent.replace("\\'", "'") }

    @Test
    fun everyCardHasItsReceiverItsProviderAndItsInfo() {
        assertEquals(widgets.size, receivers.size)
        for (w in widgets) {
            val id = w.getString("id")
            val provider = w.getString("provider")
            val receiver = receivers[".widgets.$provider"]
            assertNotNull("$id: no receiver for $provider", receiver)
            assertNotNull("$id: no provider class", Class.forName("desi.creative.vitals.widgets.$provider"))
            val kind = VitalsWidgets.Kind.fromCard(id)
            assertNotNull("$id: not a widget kind", kind)
            assertEquals("$id: the kind's provider", provider, VitalsWidgets.providerOf(kind!!).simpleName)
            val meta = receiver!!.children("meta-data").single()
            val info = parse("src/main/res/xml/" + meta.getAttributeNS(android, "resource").removePrefix("@xml/") + ".xml")
            assertEquals("$id: home screen only", "home_screen", info.getAttributeNS(android, "widgetCategory"))
            assertEquals("$id: no configuration screen (pinning needs none)", "", info.getAttributeNS(android, "configure"))
            val cells = w.getJSONArray("cells")
            assertEquals("$id: cells wide", cells.getInt(0).toString(), info.getAttributeNS(android, "targetCellWidth"))
            assertEquals("$id: cells tall", cells.getInt(1).toString(), info.getAttributeNS(android, "targetCellHeight"))
        }
    }

    @Test
    fun everyCardIsNamedAndDescribedInTheStringsTheRegistrySays() {
        for (w in widgets) {
            val id = w.getString("id")
            val receiver = receivers[".widgets.${w.getString("provider")}"]!!
            val label = receiver.getAttributeNS(android, "label").removePrefix("@string/")
            assertEquals("$id: the picker's label is the registry's", w.getString("label"), strings[label])
            val info = parse("src/main/res/xml/widget_${id}_info.xml")
            val description = info.getAttributeNS(android, "description").removePrefix("@string/")
            assertTrue("$id: a description in the strings", !strings[description].isNullOrBlank())
            // a widget is described by what it shows (a fact), never by how it looks
            assertTrue("$id: '${strings[description]}'", strings[description]!!.length in 20..160)
        }
    }

    @Test
    fun everyWidgetHasItsOwnPreviewNotTheLauncherIcon() {
        for (w in widgets) {
            val id = w.getString("id")
            val info = parse("src/main/res/xml/widget_${id}_info.xml")
            assertEquals("$id: the picker's preview", "@drawable/vw_preview_$id", info.getAttributeNS(android, "previewImage"))
            val file = File("src/main/res/drawable-nodpi/vw_preview_$id.webp")
            assertTrue("$id: ${file.path} is there", file.exists())
            assertTrue("$id: the preview is a few KB, not a render of the whole screen (${file.length()} bytes)", file.length() in 1_000..60_000)
            // no `previewLayout`: it would draw the live layout with no figures in it
            assertEquals("$id: no preview layout", "", info.getAttributeNS(android, "previewLayout"))
        }
    }

    @Test
    fun theGeneratedRegistryAndTargetsAreTheJsonOnes() {
        assertEquals(widgets.map { it.getString("id") }, WidgetRegistry.cards.map { it.id })
        assertEquals(widgets.map { it.getString("provider") }, WidgetRegistry.cards.map { it.provider })
        val targets = registry.getJSONObject("targets")
        assertEquals(targets.keys().asSequence().toList(), WidgetTargets.PATHS.keys.toList())
        for (w in widgets) assertTrue("${w.getString("id")} taps a target", WidgetTargets.PATHS.containsKey(w.getString("tap")))
        for (k in VitalsWidgets.Kind.entries) assertNotNull("${k.card} is in the registry", WidgetRegistry.byId(k.card))
    }

    @Test
    fun theFourProvidersThatExistedKeepTheirClassNames() {
        // renaming or removing one deletes the owner's placed widgets (the home screen holds them by component name)
        for (p in listOf("TodayWidgetProvider", "RingWidgetProvider", "ActionsWidgetProvider", "LogWidgetProvider")) assertTrue(p, widgets.any { it.getString("provider") == p })
    }

    @Test
    fun theRestyledProvidersAreTheOnesTheNewLayoutsServe() {
        // the initial layout (what a widget just placed shows before its first draw) is one of the card layouts
        val layouts = mapOf(
            "today" to "widget_trio",
            "ring" to "widget_card_stack",
            "energy" to "widget_card_ring",
            "sleep" to "widget_card_ring",
            "steps" to "widget_card_ring",
            "weight" to "widget_card_stack",
            "actions" to "widget_keys",
            "log" to "widget_key",
        )
        for ((id, layout) in layouts) {
            val info = parse("src/main/res/xml/widget_${id}_info.xml")
            assertEquals(id, "@layout/$layout", info.getAttributeNS(android, "initialLayout"))
            assertTrue("$id: the layout exists", File("src/main/res/layout/$layout.xml").exists())
        }
    }
}
