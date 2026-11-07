package com.pulseloop.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** v34 -> v35 drops the removed local coach's tables and keeps every health row; the chain is linear. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class CoachRemovalMigrationTest {
    private lateinit var context: Context
    private val name = "coach-removal-migration-test.db"

    @Before fun setUp() { context = RuntimeEnvironment.getApplication(); context.deleteDatabase(name) }
    @After fun tearDown() { context.deleteDatabase(name) }

    @Test fun `34 to 35 drops the coach tables and keeps health data`() {
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val sql = initial.openHelper.writableDatabase
        sql.execSQL("CREATE TABLE coach_conversations (id TEXT NOT NULL PRIMARY KEY, title TEXT)")
        sql.execSQL("CREATE TABLE coach_messages (id TEXT NOT NULL PRIMARY KEY, conversationId TEXT NOT NULL, text TEXT, " +
            "FOREIGN KEY(conversationId) REFERENCES coach_conversations(id) ON DELETE CASCADE)")
        for (t in listOf("coach_memories", "coach_tool_calls", "coach_summaries", "coach_notification_records")) {
            sql.execSQL("CREATE TABLE $t (id TEXT NOT NULL PRIMARY KEY, body TEXT)")
            sql.execSQL("INSERT INTO $t VALUES ('x', 'private')")
        }
        sql.execSQL("INSERT INTO coach_conversations VALUES ('c1', 'Hello')")
        sql.execSQL("INSERT INTO coach_messages VALUES ('m1', 'c1', 'my sleep')")
        sql.execSQL("INSERT INTO measurements(id,kindRaw,value,unit,timestamp,sourceRaw,confidenceRaw,createdAt) VALUES('history:hr:1','HEART_RATE',70,'bpm',1,'history','known',1)")
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 34 }

        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name)
            .addMigrations(PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            val db = migrated.openHelper.writableDatabase // Room validates the full current schema here.
            assertEquals(DATABASE_VERSION, db.version)
            db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'coach%'").use {
                assertEquals(0, it.count)
            }
            db.query("SELECT COUNT(*) FROM measurements").use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
            assertTrue(PulseLoopDatabase.ALL_TABLES.none { it.startsWith("coach") })
        } finally { migrated.close() }
    }

    @Test fun `the upgrade chain is one linear run from v2 to the schema version`() {
        val chain = PulseLoopDatabase.migrations(context)
        assertEquals(2, chain.first().startVersion)
        chain.forEachIndexed { i, m ->
            assertEquals("step $i", m.startVersion + 1, m.endVersion)
            if (i > 0) assertEquals("gap before v${m.startVersion}", chain[i - 1].endVersion, m.startVersion)
        }
        assertEquals(DATABASE_VERSION, chain.last().endVersion)
        assertEquals(37, DATABASE_VERSION)
    }
}
