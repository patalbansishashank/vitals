package desi.creative.vitals

/** Cosmetic byte observations only: these never establish verification or installation readiness. */
data class OtaProgress(val received: Long, val total: Long, val phase: String)

/** At most five byte updates per second, plus initial/completed/verification boundaries. Listener failures are harmless. */
internal class OtaProgressReporter(
    private val total: Long,
    private val emit: (OtaProgress) -> Unit,
    private val nowMs: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private var lastAt: Long? = null
    private var lastBytes = -1L
    private var verifying = false

    fun bytes(received: Long) {
        if (total <= 0 || verifying || received < lastBytes || received < 0 || received > total) return
        val now = nowMs()
        if (received == lastBytes) return
        if (lastAt != null && received != total && now - lastAt!! < 200) return
        lastAt = now
        lastBytes = received
        send(OtaProgress(received, total, "downloading"))
    }

    fun verifying() {
        if (total <= 0 || lastBytes != total || verifying) return
        verifying = true
        send(OtaProgress(total, total, "verifying"))
    }

    private fun send(progress: OtaProgress) {
        try { emit(progress) } catch (_: Exception) { /* A detached Bridge must not abort a verified transfer. */ }
    }
}
