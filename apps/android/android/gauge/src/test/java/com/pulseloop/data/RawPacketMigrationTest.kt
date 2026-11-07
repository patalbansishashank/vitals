package com.pulseloop.data

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class RawPacketMigrationTest {
    @Test fun `500000 legacy packets migrate with newest 5000 and every health table preserved`() {
        val context = RuntimeEnvironment.getApplication()
        val name = "raw-migration.db"
        context.deleteDatabase(name)
        val initial = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).allowMainThreadQueries().build()
        val db = initial.openHelper.writableDatabase
        db.execSQL("DROP TABLE raw_packets")
        db.execSQL("CREATE TABLE raw_packets(id TEXT NOT NULL PRIMARY KEY,timestamp INTEGER NOT NULL,directionRaw TEXT NOT NULL,commandId INTEGER NOT NULL,hexPayload TEXT NOT NULL,decodedKind TEXT,decodedJSON TEXT,confidenceRaw TEXT NOT NULL,deviceTypeRaw TEXT,firmwareRevision TEXT,createdAt INTEGER NOT NULL)")
        db.execSQL("DROP INDEX index_derived_updates_timestamp")
        db.execSQL("DROP INDEX index_derived_updates_kind_entityId")
        db.execSQL("DROP INDEX index_sleep_sessions_startAt")
        db.execSQL("CREATE INDEX index_measurements_kindRaw ON measurements(kindRaw)")
        db.execSQL("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<500000) INSERT INTO raw_packets SELECT 'uuid-'||x,x,'INCOMING',1,'aabb','heart_rate',NULL,'unknown','CRP','v1',x FROM n")
        db.execSQL("INSERT INTO measurements(id,kindRaw,value,unit,timestamp,sourceRaw,confidenceRaw,createdAt) VALUES('history:hr:1','HEART_RATE',70,'bpm',1,'history','known',1)")
        db.execSQL("INSERT INTO sleep_sessions(id,date,startAt,endAt,totalMinutes,sourceRaw,createdAt,updatedAt) VALUES('night',0,1,1000,1,'ring',1,1)")
        db.execSQL("INSERT INTO measurement_deletions(measurementId,kindRaw,timestamp,deletedAt) VALUES('history:hr:2','HEART_RATE',2,3)")
        db.execSQL("INSERT INTO broadcast_outbox(eventId,topicSuffix,payloadJson,qos,retain,createdAt,attemptCount,publishedAt) VALUES('delivered','hr','large payload',1,0,1,1,2),('pending','hr','pending payload',1,0,1,0,NULL)")
        initial.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { it.version = 28 }
        val migrated = Room.databaseBuilder(context, PulseLoopDatabase::class.java, name).addMigrations(PulseLoopDatabase.MIGRATION_28_29, PulseLoopDatabase.MIGRATION_29_30, PulseLoopDatabase.MIGRATION_30_31, PulseLoopDatabase.MIGRATION_31_32, PulseLoopDatabase.MIGRATION_32_33, PulseLoopDatabase.MIGRATION_33_34, PulseLoopDatabase.MIGRATION_34_35, PulseLoopDatabase.MIGRATION_35_36, PulseLoopDatabase.MIGRATION_36_37).allowMainThreadQueries().build()
        try {
            val sql = migrated.openHelper.writableDatabase // Room validates the full v29 schema.
            sql.query("SELECT COUNT(*),MIN(timestamp),MAX(timestamp) FROM raw_packets").use {
                assertTrue(it.moveToFirst()); assertEquals(5000, it.getInt(0)); assertEquals(495001L, it.getLong(1)); assertEquals(500000L, it.getLong(2))
            }
            for (table in listOf("measurements", "sleep_sessions", "measurement_deletions")) sql.query("SELECT COUNT(*) FROM $table").use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
            sql.query("SELECT deviceTypeRaw,decodedKind,firmwareRevision FROM raw_packets LIMIT 1").use {
                it.moveToFirst(); assertEquals("CRP", it.getString(0)); assertEquals("heart_rate", it.getString(1)); assertEquals("v1", it.getString(2))
            }
            sql.query("SELECT payloadJson FROM broadcast_outbox ORDER BY eventId").use {
                it.moveToFirst(); assertEquals("", it.getString(0)); it.moveToNext(); assertEquals("pending payload", it.getString(0))
            }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}
