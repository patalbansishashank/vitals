package desi.creative.vitals

import java.io.InputStream
import java.io.OutputStream

/** Bounds a shared provider's stream even when it reports no size or a false size. */
object SharedFileBytes {
    fun copy(input: InputStream, output: OutputStream, limit: Long): Long {
        require(limit >= 0)
        val buffer = ByteArray(64 * 1024)
        var copied = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) return copied
            if (read == 0) throw IllegalStateException("Shared file provider made no progress")
            if (read > limit - copied) throw IllegalStateException("Shared file exceeds cache limit")
            output.write(buffer, 0, read)
            copied += read
        }
    }
}
