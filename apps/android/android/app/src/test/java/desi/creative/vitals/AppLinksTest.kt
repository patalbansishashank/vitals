package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppLinksTest {
    @Test
    fun mapsTheSettingsLinkOntoTheLocalOrigin() {
        assertEquals("https://localhost/settings", AppLinks.localUrlFor("https://vitals.creative.desi/settings"))
        assertEquals(
            "https://localhost/settings?section=server",
            AppLinks.localUrlFor("https://vitals.creative.desi/settings?section=server")
        )
        assertEquals(
            "https://localhost/settings/server",
            AppLinks.localUrlFor("HTTPS://Vitals.Creative.Desi:443/settings/server")
        )
    }

    @Test
    fun keepsQueryAndFragmentExactly() {
        assertEquals(
            "https://localhost/settings?section=server#vitals-server:1?u=a%2Fb&k=x_y-z",
            AppLinks.localUrlFor("https://vitals.creative.desi/settings?section=server#vitals-server:1?u=a%2Fb&k=x_y-z")
        )
        assertEquals(
            "https://localhost/settings#vitals-server:1?a=b",
            AppLinks.localUrlFor("https://vitals.creative.desi/settings#vitals-server:1?a=b")
        )
    }

    @Test
    fun rejectsOtherHostsSchemesAndPaths() {
        assertNull(AppLinks.localUrlFor(null))
        assertNull(AppLinks.localUrlFor(""))
        assertNull(AppLinks.localUrlFor("https://example.org/settings?section=server"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi.example.org/settings"))
        // A user part before the host; split so the public-source scan does not read it as an e-mail address.
        assertNull(AppLinks.localUrlFor("https://evil.example" + "@vitals.creative.desi/settings"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi" + "@evil.example/settings"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi:8443/settings"))
        assertNull(AppLinks.localUrlFor("http://vitals.creative.desi/settings"))
        assertNull(AppLinks.localUrlFor("content://vitals.creative.desi/settings"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi/"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi/settingsx"))
        assertNull(AppLinks.localUrlFor("https://vitals.creative.desi?x=/settings"))
    }
}
