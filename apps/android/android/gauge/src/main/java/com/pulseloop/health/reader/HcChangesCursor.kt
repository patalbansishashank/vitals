package com.pulseloop.health.reader

import com.pulseloop.data.sources.HcStateEntity

/**
 * Where the reader is up to for one record type (energy SPEC §GB.2). One changes token per type,
 * so a `DeletionChange` (which carries only a record id) always knows its `record_type`, and one
 * type's revoked permission or expired token never stalls the others.
 *
 * Lifecycle:
 * 1. First run: the changes token is taken **before** the back-fill, so nothing written during the
 *    back-fill is missed (an overlap is harmless: records are keyed by id and revision).
 * 2. Back-fill `[backfillFromMs, backfillToMs)` page by page; [pageToken] is persisted with each
 *    page's records, so a killed job resumes at the next page.
 * 3. Then drain changes from [token].
 * 4. An expired token: take a new one, then an id-based overlapping rescan from [lastSyncMs] minus
 *    a day (bounded by the history depth). Deletions inside the expired window cannot be known, so
 *    the scope is marked [SCOPE_STALE] from [staleSinceMs]; no tombstone is ever fabricated.
 */
data class HcChangesCursor(
    val type: HcType,
    val token: String? = null,
    val backfillFromMs: Long? = null,
    val backfillToMs: Long? = null,
    val pageToken: String? = null,
    val backfillDone: Boolean = false,
    val scope: String = SCOPE_FRESH,
    val staleSinceMs: Long? = null,
    val lastSyncMs: Long? = null,
) {
    fun toState(): List<HcStateEntity> = buildList {
        fun put(field: String, value: Any?) { if (value != null) add(HcStateEntity(key(type, field), value.toString())) }
        put(TOKEN, token)
        put(FROM, backfillFromMs)
        put(TO, backfillToMs)
        put(PAGE, pageToken)
        put(DONE, backfillDone)
        put(SCOPE, scope)
        put(STALE_SINCE, staleSinceMs)
        put(LAST_SYNC, lastSyncMs)
    }

    /** Every key this type may hold, so a commit can clear the ones now null. */
    fun allKeys(): List<String> = FIELDS.map { key(type, it) }

    companion object {
        const val SCOPE_FRESH = "fresh"
        const val SCOPE_STALE = "stale"
        private const val TOKEN = "token"
        private const val FROM = "backfillFrom"
        private const val TO = "backfillTo"
        private const val PAGE = "pageToken"
        private const val DONE = "backfillDone"
        private const val SCOPE = "scope"
        private const val STALE_SINCE = "staleSince"
        private const val LAST_SYNC = "lastSync"
        private val FIELDS = listOf(TOKEN, FROM, TO, PAGE, DONE, SCOPE, STALE_SINCE, LAST_SYNC)

        fun key(type: HcType, field: String) = "${type.recordType}.$field"

        fun decode(type: HcType, state: Map<String, String>): HcChangesCursor {
            fun get(field: String) = state[key(type, field)]
            return HcChangesCursor(
                type = type,
                token = get(TOKEN),
                backfillFromMs = get(FROM)?.toLongOrNull(),
                backfillToMs = get(TO)?.toLongOrNull(),
                pageToken = get(PAGE),
                backfillDone = get(DONE)?.toBooleanStrictOrNull() ?: false,
                scope = get(SCOPE) ?: SCOPE_FRESH,
                staleSinceMs = get(STALE_SINCE)?.toLongOrNull(),
                lastSyncMs = get(LAST_SYNC)?.toLongOrNull(),
            )
        }
    }
}
