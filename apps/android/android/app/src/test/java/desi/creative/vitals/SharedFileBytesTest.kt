package desi.creative.vitals

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SharedFileBytesTest {
    @Test
    fun acceptsAFileAtTheLimit() {
        val bytes = ByteArray(100_000) { (it % 251).toByte() }
        val output = ByteArrayOutputStream()
        assertEquals(bytes.size.toLong(), SharedFileBytes.copy(ByteArrayInputStream(bytes), output, bytes.size.toLong()))
        assertArrayEquals(bytes, output.toByteArray())
    }

    @Test
    fun rejectsAnUnboundedProviderBeforeWritingPastTheLimit() {
        val provider = object : java.io.InputStream() {
            var reads = 0
            override fun read(): Int = 1
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                reads++
                if (reads > 3) fail("The copy kept reading an unbounded provider")
                bytes.fill(1, offset, offset + length)
                return length
            }
        }
        val output = ByteArrayOutputStream()
        try {
            SharedFileBytes.copy(provider, output, 100_000)
            fail("An unbounded provider was accepted")
        } catch (_: IllegalStateException) {
            assertTrue(output.size() <= 100_000)
            assertTrue(provider.reads <= 2)
        }
    }
}
