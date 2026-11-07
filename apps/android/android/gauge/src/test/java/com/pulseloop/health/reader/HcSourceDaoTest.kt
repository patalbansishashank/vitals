package com.pulseloop.health.reader

import androidx.room.Room
import com.pulseloop.data.sources.HcRecordEntity
import com.pulseloop.data.sources.SourcesDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Records and the cursor commit together; a revision re-queues under a new seq. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class HcSourceDaoTest {
    private val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), SourcesDatabase::class.java)
        .allowMainThreadQueries().build()

    @After fun close() = db.close()

    private fun row(key: String, modified: Long) = HcRecordEntity(
        key = key, recordType = "Steps", hcId = key.substringAfter(':'), deleted = false,
        lastModifiedMs = modified, startMs = 1, dataJson = "{}", readAtMs = 1,
    )

    @Test fun `a commit writes rows and the cursor, clearing fields that became null`() = runBlocking {
        val store = HealthConnectReader.DaoStore(db.hcDao())
        val c1 = HcChangesCursor(HcType.STEPS, token = "t1", backfillFromMs = 1, backfillToMs = 2, pageToken = "p2")
        store.commit(listOf(row("Steps:a", 1), row("Steps:b", 1)), c1)
        assertEquals(c1, HcChangesCursor.decode(HcType.STEPS, store.state()))

        val c2 = c1.copy(pageToken = null, backfillDone = true)
        store.commit(listOf(row("Steps:a", 2)), c2)
        val decoded = HcChangesCursor.decode(HcType.STEPS, store.state())
        assertNull(decoded.pageToken)
        assertTrue(decoded.backfillDone)

        val all = db.hcDao().recordsAfter(0, 10)
        assertEquals(listOf("Steps:b", "Steps:a"), all.map { it.key })
        assertEquals(2L, all.last().lastModifiedMs)
        assertEquals(setOf("Steps:a", "Steps:b"), store.existing(listOf("Steps:a", "Steps:b", "Steps:x")).keys)
    }
}
