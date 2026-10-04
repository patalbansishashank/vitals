package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NoticesTest {
    @Test
    fun everyNoticeKindHasItsOwnId() {
        val ids = listOf("battery_low", "ring_disconnected", "ring_moved").map { Notices.idForKind(it) }
        assertEquals(3, ids.filterNotNull().toSet().size)
    }

    @Test
    fun unknownKindIsRefused() {
        assertNull(Notices.idForKind("something_else"))
        assertNull(Notices.idForKind(null))
    }
}
