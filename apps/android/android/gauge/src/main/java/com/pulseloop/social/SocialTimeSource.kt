package com.pulseloop.social

import android.content.Context
import com.pulseloop.hub.HubUploadSource

/**
 * The `habits/social_time` upload, plugged into the existing hub cadence (SPEC social-time). [HubSync] calls every
 * source's [enqueueChanged] before each upload batch, so recompute-persist-upload runs on app foreground
 * (`HubSync.flushNow`), on ring-pass completion (`requestUploadAfterPass`) and on the ~15-minute periodic drain —
 * reusing the one WorkManager job, with no new wakelock. The drain itself only runs while the engine is active, so this
 * does nothing before take-over.
 */
class SocialTimeSource(private val repository: SocialTimeRepository) : HubUploadSource {
    override suspend fun enqueueChanged(): Int = repository.collect()

    /** No cursor to forget: the daily events are deterministic by value and re-send after the outbox is cleared. */
    override fun reset() = Unit

    companion object {
        fun create(context: Context): SocialTimeSource = SocialTimeSource(SocialTimeRepository.get(context))
    }
}
