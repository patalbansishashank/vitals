package desi.creative.vitals.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetLinksTest {
    @Test
    fun eachTargetOpensItsScreen() {
        val a = WidgetLinks.ACTION_OPEN
        assertEquals("/today", WidgetLinks.pathFor(a, "today"))
        assertEquals("/ring", WidgetLinks.pathFor(a, "ring"))
        assertEquals("/train?log=1", WidgetLinks.pathFor(a, "log"))
        assertEquals("/today?record=1", WidgetLinks.pathFor(a, "record"))
        // (r071) a card's own screen
        assertEquals("/energy", WidgetLinks.pathFor(a, WidgetLinks.ENERGY))
        assertEquals("/sleep", WidgetLinks.pathFor(a, WidgetLinks.SLEEP))
        assertEquals("/ring/activity", WidgetLinks.pathFor(a, WidgetLinks.STEPS))
        assertEquals("/ring/signals/hr", WidgetLinks.pathFor(a, WidgetLinks.HR))
        assertEquals("/progress#trend", WidgetLinks.pathFor(a, WidgetLinks.WEIGHT))
    }

    @Test
    fun theTargetsAreTheRegistrysAndEveryOneIsAPathInTheApp() {
        assertEquals(listOf("today", "ring", "log", "record", "energy", "sleep", "steps", "hr", "weight"), WidgetLinks.targets)
        for (t in WidgetLinks.targets) {
            val path = WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, t)!!
            assertTrue("$t: $path", path.startsWith("/") && !path.startsWith("//"))
        }
    }

    @Test
    fun anythingElseOpensNothing() {
        // MainActivity is exported: another app may send this action, and only the registry's screens can come of it
        assertNull(WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, null))
        assertNull(WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, "/settings/data"))
        assertNull(WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, "https://example.org"))
        assertNull(WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, "TODAY"))
        assertNull(WidgetLinks.pathFor(WidgetLinks.ACTION_OPEN, "settings"))
        assertNull(WidgetLinks.pathFor("android.intent.action.VIEW", "today"))
        assertNull(WidgetLinks.pathFor(null, "today"))
    }

    @Test
    fun requestCodesAreDistinct() {
        val codes = WidgetLinks.targets.map(WidgetLinks::requestCode)
        assertEquals(codes.size, codes.toSet().size)
    }
}
