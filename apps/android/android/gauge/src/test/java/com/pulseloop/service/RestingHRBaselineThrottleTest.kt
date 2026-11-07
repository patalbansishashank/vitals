package com.pulseloop.service

import androidx.room.Room
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.UserProfileEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RestingHRBaselineThrottleTest {
    @Test fun `insufficient nights still records refresh attempt and preserves learned baseline`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), PulseLoopDatabase::class.java).build()
        try {
            db.userProfileDao().upsert(UserProfileEntity(hrRestingBaseline = 61.0))
            RestingHRBaselineService.refreshIfStale(db)
            val refreshed = db.userProfileDao().get()!!
            assertEquals(61.0, refreshed.hrRestingBaseline!!, 0.0)
            assertNotNull(refreshed.hrRestingBaselineUpdatedAt)
            RestingHRBaselineService.refreshIfStale(db)
            assertEquals(refreshed, db.userProfileDao().get())
        } finally { db.close() }
    }
}
