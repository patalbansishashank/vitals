package com.pulseloop.hub

/**
 * Coalesces exact (per-sample) hub deletions into range deletions wherever the server semantics allow
 * (0.6.3: the 2.8.0 upgrade sent 16,498 `from == to` deletions; see `vitals-research/r063/GAUGE-CONTRACT.md`).
 *
 * The server hides every event of the installation whose category (and `kind`, when given) matches
 * and whose `observed_at` lies in `[from, to]`, if it was received before the deletion. So two
 * deletions of one (category, kind) may become one range only when **no event that must stay lies
 * between them**. Gauge's local store mirrors what it uploaded, so "an event that must stay" is a
 * stored row of that upload category inside the merged span ([Survivors]): one is enough to keep the
 * two targets apart. A category Gauge cannot look up locally is never widened (only overlapping or
 * identical targets merge), and no merge bridges a gap wider than [maxGapMs], which bounds what an
 * imperfect mirror could hide.
 *
 * Interleaved duplicates (the 2.7.3 clock copies sit between the readings that stay) therefore stay
 * exact: correctness first. [HubPendingDeletions] adds the rate budget that keeps those from ever
 * arriving as a storm.
 */
object HubDeletionCoalescer {
    data class Target(val id: Long, val category: String, val kind: String?, val fromMs: Long, val toMs: Long)

    data class Range(val category: String, val kind: String?, val fromMs: Long, val toMs: Long, val ids: List<Long>)

    /** Sorted instants of stored rows uploaded under one (category, kind), or null when unknown. */
    fun interface Survivors {
        suspend fun instants(category: String, kind: String?, fromMs: Long, toMs: Long): List<Long>?
    }

    /** One hour: a merge never bridges more than this between two deleted targets. */
    const val DEFAULT_MAX_GAP_MS = 3_600_000L

    suspend fun coalesce(
        targets: List<Target>,
        survivors: Survivors,
        maxGapMs: Long = DEFAULT_MAX_GAP_MS,
    ): List<Range> {
        val out = mutableListOf<Range>()
        for ((key, group) in targets.groupBy { it.category to it.kind }) {
            val sorted = group.sortedWith(compareBy<Target>({ it.fromMs }, { it.toMs }, { it.id }))
            val known = survivors.instants(key.first, key.second, sorted.first().fromMs, sorted.maxOf { it.toMs })
            out += merge(key.first, key.second, sorted, known, maxGapMs)
        }
        return out.sortedWith(compareBy<Range>({ it.fromMs }, { it.category }, { it.kind ?: "" }))
    }

    /** [sorted] by start; [stay] sorted instants that must not be covered, or null when unknown. */
    internal fun merge(category: String, kind: String?, sorted: List<Target>, stay: List<Long>?, maxGapMs: Long): List<Range> {
        val out = mutableListOf<Range>()
        var from = sorted.first().fromMs
        var to = sorted.first().toMs
        val ids = mutableListOf(sorted.first().id)
        fun flush() { out += Range(category, kind, from, to, ids.toList()) }
        for (t in sorted.drop(1)) {
            val overlaps = t.fromMs <= to
            val mergeable = overlaps || (
                stay != null && t.fromMs - to <= maxGapMs && !anyIn(stay, to + 1, t.fromMs - 1)
            )
            if (mergeable) {
                to = maxOf(to, t.toMs)
                ids += t.id
            } else {
                flush()
                from = t.fromMs; to = t.toMs; ids.clear(); ids += t.id
            }
        }
        flush()
        return out
    }

    /** True when sorted [xs] holds a value in `[lo, hi]`. */
    internal fun anyIn(xs: List<Long>, lo: Long, hi: Long): Boolean {
        if (lo > hi) return false
        var a = 0
        var b = xs.size
        while (a < b) {
            val m = (a + b) ushr 1
            if (xs[m] < lo) a = m + 1 else b = m
        }
        return a < xs.size && xs[a] <= hi
    }
}
