package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.WidgetSamples.fixture
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Parsing the published snapshot (org.json needs the Android runtime: Robolectric). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetSnapshotTest {
    private val published = WidgetSamples.oldV1()
    private val digit = Regex("""\d""")

    @Test
    fun readsWhatAnOlderWebBundlePublishes() {
        // version 1 as of 0.6.6: none of the r071 fields, and it must go on parsing (the web bundle updates ahead of the APK, and the reverse)
        val s = WidgetSnapshot.parse(published)!!
        assertFalse(s.quiet)
        assertEquals("2026-10-28", s.today!!.date)
        assertEquals("1 240", s.today!!.energy!!.value)
        assertEquals("1 120–1 360", s.today!!.energy!!.range)
        assertNull(s.today!!.energy!!.series)
        assertNull(s.today!!.energy!!.ratio)
        assertEquals(0.642, s.today!!.steps!!.ratio!!, 1e-9)
        assertEquals("150", s.today!!.heartPoints!!.goal)
        assertEquals("7 h 12", s.today!!.sleep!!.value)
        assertNull(s.today!!.sleep!!.stages)
        assertEquals("62", s.ring!!.hr!!.value)
        assertEquals("Fine", s.ring!!.battery!!.word)
        assertNull(s.body)
    }

    @Test
    fun readsEveryFieldOfTheCurrentSnapshot() {
        val s = WidgetSnapshot.parse(fixture("snapshot-numbers.json"))!!
        assertEquals("the day the app's 04:00 rollover ends", 1793226600000, s.today!!.until)
        val e = s.today!!.energy!!
        assertEquals(0.422, e.ratio!!, 1e-9)
        assertEquals("2 595", e.likely)
        assertEquals("On plan", e.state)
        assertEquals(23, e.series!!.now)
        assertEquals(48, e.series!!.y.size)
        assertNull(e.series!!.y[30])
        assertEquals(1.0, e.series!!.ahead!!.last()!!, 1e-9)
        val st = s.today!!.steps!!
        assertEquals("On course", st.state)
        assertEquals("12 878", st.likely)
        assertEquals(24, st.series!!.y.size)
        val sl = s.today!!.sleep!!
        assertEquals("7 h 30", sl.goal)
        assertEquals(1.058, sl.ratio!!, 1e-9)
        assertEquals(1793123040000, sl.onset)
        assertEquals(1793153220000, sl.wake)
        assertEquals(14, sl.stages!!.size)
        assertEquals(WidgetSnapshot.StageSpan(0.0, 0.06, 2), sl.stages!![0])
        val hr = s.ring!!.hr!!
        assertEquals("Normal", hr.state)
        assertEquals("50–90", hr.range)
        assertEquals(47, hr.series!!.now)
        val w = s.body!!.weight!!
        assertEquals("85.2", w.value)
        assertEquals("onTrack", w.state)
        assertEquals(14, w.series!!.y.size)
    }

    @Test
    fun theStoredFormReadsTheSame() {
        for (name in listOf("snapshot-numbers.json", "snapshot-quiet.json")) {
            val s = WidgetSnapshot.parse(fixture(name))!!
            assertEquals(name, s, WidgetSnapshot.parse(s.toJson().toString()))
        }
        val old = WidgetSnapshot.parse(published)!!
        assertEquals(old, WidgetSnapshot.parse(old.toJson().toString()))
    }

    @Test
    fun aQuietSnapshotKeepsNoFigure() {
        val o = JSONObject(published).put("quiet", true)
        o.getJSONObject("today").getJSONObject("sleep").put("word", "7 h of sleep")
        val s = WidgetSnapshot.parse(o)!!
        assertNull(s.today!!.energy)
        assertNull(s.today!!.steps!!.value)
        assertNull(s.today!!.steps!!.goal)
        assertEquals("over half of the goal", s.today!!.steps!!.word)
        assertNull(s.today!!.heartPoints!!.value)
        assertNull("a word with a digit is dropped, and nothing is left of the night", s.today!!.sleep)
        assertNull(s.ring!!.hr!!.value)
        assertNull(s.ring!!.battery!!.value)
        assertEquals("Fine", s.ring!!.battery!!.word)
        // the stored form has no digit outside the instants and the ratios
        val stored = s.toJson()
        stored.remove("at")
        stored.remove("v")
        val text = stored.toString().replace(Regex(""""(at|lastSyncAt|ratio)":[0-9.]+"""), "").replace(Regex(""""date":"[0-9-]+""""), "")
        assertFalse(text, digit.containsMatchIn(text))
    }

    @Test
    fun quietDropsLinesAndBarsAndKeepsTheNightAndTheRatios() {
        val o = JSONObject(fixture("snapshot-numbers.json")).put("quiet", true)
        val s = WidgetSnapshot.parse(o)!!
        assertNull(s.today!!.energy)
        assertNull(s.today!!.steps!!.series)
        assertNull(s.today!!.steps!!.likely)
        assertEquals("On course", s.today!!.steps!!.state)
        assertEquals(0.845, s.today!!.steps!!.ratio!!, 1e-9)
        assertNull(s.today!!.sleep!!.goal)
        assertNull(s.today!!.sleep!!.value)
        assertEquals(14, s.today!!.sleep!!.stages!!.size)
        assertNotNull(s.today!!.sleep!!.onset)
        assertNull(s.ring!!.hr!!.series)
        assertNull(s.ring!!.hr!!.range)
        assertEquals("Normal", s.ring!!.hr!!.state)
        val w = s.body!!.weight!!
        assertNull(w.value)
        assertNull(w.series)
        assertEquals("onTrack", w.state)
    }

    @Test
    fun theNativeQuietRulesMakeTheWebsQuietFixture() {
        // a numbers snapshot with quiet on, parsed here, is what the web's own quiet sanitiser sends: one pair of fixtures, two implementations
        val viaNative = WidgetSnapshot.parse(JSONObject(fixture("snapshot-numbers.json")).put("quiet", true))!!
        val viaWeb = WidgetSnapshot.parse(fixture("snapshot-quiet.json"))!!
        assertEquals(viaWeb, viaNative)
    }

    @Test
    fun aWordWithADigitIsNeverKeptInEitherMode() {
        val o = JSONObject(fixture("snapshot-numbers.json"))
        o.getJSONObject("today").getJSONObject("steps").put("state", "On course by 18:00")
        o.getJSONObject("today").getJSONObject("energy").put("state", "Over by 50")
        o.getJSONObject("ring").getJSONObject("hr").put("state", "Level 2")
        val s = WidgetSnapshot.parse(o)!!
        assertNull(s.today!!.steps!!.state)
        assertNull(s.today!!.energy!!.state)
        assertNull(s.ring!!.hr!!.state)
    }

    @Test
    fun badPicturesAreLeftOutNotDrawn() {
        val o = JSONObject(fixture("snapshot-numbers.json"))
        val steps = o.getJSONObject("today").getJSONObject("steps")
        steps.put("series", JSONObject("""{"y":[-3,0.5,9,null,"x"],"now":9}"""))
        o.getJSONObject("today").getJSONObject("energy").put("series", JSONObject("""{"y":[null,null]}"""))
        o.getJSONObject("today").getJSONObject("sleep").put("stages", org.json.JSONArray("""[[0,0.4,2],[0.4,0.2,3],[0.5,1.5,3],[0.5,0.9,7],[0.6,0.9,4],["x",1,1]]"""))
        val s = WidgetSnapshot.parse(o)!!
        // clamped into 0..1, a gap and a value that is no number both kept as gaps, a live index outside the series dropped
        assertEquals(listOf(0.0, 0.5, 1.0, null, null), s.today!!.steps!!.series!!.y)
        assertNull(s.today!!.steps!!.series!!.now)
        assertNull("nothing to draw", s.today!!.energy!!.series)
        assertEquals(listOf(WidgetSnapshot.StageSpan(0.0, 0.4, 2), WidgetSnapshot.StageSpan(0.6, 0.9, 4)), s.today!!.sleep!!.stages)
        // never more than the longest series
        val long = org.json.JSONArray().also { a -> repeat(80) { a.put(0.5) } }
        steps.put("series", JSONObject().put("y", long))
        assertEquals(WidgetSnapshot.MAX_SERIES, WidgetSnapshot.parse(o)!!.today!!.steps!!.series!!.y.size)
    }

    @Test
    fun theBodyIsThereOnlyWhenTheWebSentIt() {
        assertNull(WidgetSnapshot.parse(published)!!.body)
        val on = JSONObject(published).put("body", JSONObject())
        assertEquals(WidgetSnapshot.BodyPart(null), WidgetSnapshot.parse(on)!!.body)
        val state = JSONObject(published).put("body", JSONObject("""{"weight":{"unit":"kg","state":"weird"}}"""))
        assertEquals("a state that is not one of the three is nothing to show", WidgetSnapshot.BodyPart(null), WidgetSnapshot.parse(state)!!.body)
    }

    @Test
    fun refusesWhatIsNotASnapshot() {
        assertNull(WidgetSnapshot.parse(null as String?))
        assertNull(WidgetSnapshot.parse(""))
        assertNull(WidgetSnapshot.parse("not json"))
        assertNull(WidgetSnapshot.parse("""{"v":2,"at":1}"""))
        assertNull(WidgetSnapshot.parse("""{"v":1}"""))
        // a part with a bad date is dropped, an unknown ring state reads as empty, an over-long text is not a figure
        val s = WidgetSnapshot.parse("""{"v":1,"at":5,"today":{"date":"28/10/2026"},"ring":{"state":"weird","hr":{"value":"${"9".repeat(60)}","at":4}}}""")
        assertNotNull(s)
        assertNull(s!!.today)
        assertEquals("empty", s.ring!!.state)
        assertNull(s.ring!!.hr!!.value)
        assertTrue(WidgetSnapshot.CONTRACT >= 2)
    }
}
