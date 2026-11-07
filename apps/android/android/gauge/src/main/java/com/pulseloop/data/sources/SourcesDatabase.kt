package com.pulseloop.data.sources

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The phone's own evidence sources (energy SPEC §GB): the phone step counter and the Health
 * Connect reader. A separate Room database on purpose, so nothing here collides with the ring
 * database's migrations (`pulseloop.db`, owned by package GA).
 *
 * Each source writes its own durable rows here first; the hub upload plug-ins
 * ([com.pulseloop.hub.HubPhoneStepsSource], [com.pulseloop.hub.HubHealthConnectSource]) turn them
 * into outbox events by an autoincrement `seq` cursor, so a new server or person (cursor reset)
 * re-sends everything without re-reading a sensor or Health Connect.
 *
 * Version 2 (Gauge 2.8.1): `phone_acquisition.detector` ([MIGRATION_1_2]). Version 3 (Gauge 2.8.3): the
 * Activity Recognition Transition API's events and registration intervals ([MIGRATION_2_3]). Every schema change adds a
 * real migration; never `fallbackToDestructiveMigration`, because a dropped counter baseline loses
 * one delta and a dropped changes token forces a rescan.
 */
@Database(
    entities = [
        PhoneCounterLastEntity::class,
        PhonePendingSpanEntity::class,
        PhoneAnchorEntity::class,
        PhoneStepRecordEntity::class,
        PhoneAcquisitionEntity::class,
        HcRecordEntity::class,
        HcStateEntity::class,
        ActivityTransitionEntity::class,
        ActivityAcquisitionEntity::class,
    ],
    version = 3,
    exportSchema = false,
)
abstract class SourcesDatabase : RoomDatabase() {
    abstract fun phoneDao(): PhoneSourceDao
    abstract fun hcDao(): HcSourceDao
    abstract fun activityDao(): ActivitySourceDao

    companion object {
        const val NAME = "sources.db"
        @Volatile private var INSTANCE: SourcesDatabase? = null

        fun getInstance(context: Context): SourcesDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(context.applicationContext, SourcesDatabase::class.java, NAME)
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .build().also { INSTANCE = it }
            }

        /** v1 → v2: whether the step detector was registered for a `listening` interval (null on older rows). */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `phone_acquisition` ADD COLUMN `detector` TEXT")
            }
        }

        /** v2 → v3 (Gauge 2.8.3): `activity_transitions` and `activity_acquisition` (both new, empty). */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `activity_transitions` (`seq` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "`bootId` TEXT NOT NULL, `elapsedNs` INTEGER NOT NULL, `activity` TEXT NOT NULL, `transition` TEXT NOT NULL, " +
                        "`occurredAtMs` INTEGER NOT NULL, `anchorId` TEXT NOT NULL, `registrationEpoch` INTEGER NOT NULL, `receivedAtMs` INTEGER NOT NULL)",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_activity_transitions_bootId_elapsedNs_activity_transition` " +
                        "ON `activity_transitions` (`bootId`, `elapsedNs`, `activity`, `transition`)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `activity_acquisition` (`seq` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "`fromMs` INTEGER NOT NULL, `toMs` INTEGER, `state` TEXT NOT NULL, `lastSeenMs` INTEGER NOT NULL, `registrationEpoch` INTEGER NOT NULL)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_activity_acquisition_toMs` ON `activity_acquisition` (`toMs`)")
            }
        }
    }
}

// ── Phone step counter ──────────────────────────────────────────────────────────────────────

/**
 * The last `TYPE_STEP_COUNTER` sample `(boot_id, m_ns, C)`, one row (`slot = 0`). [listenId] is the
 * listener registration that delivered it: a span whose two ends share it was listened to
 * throughout, so step-detector timing can cover it.
 */
@Entity(tableName = "phone_counter_last")
data class PhoneCounterLastEntity(
    @PrimaryKey val slot: Int = 0,
    val bootId: String,
    val mNs: Long,
    val count: Long,
    val listenId: Long,
    val anchorId: String,
    val receivedAtMs: Long,
)

/**
 * A counter delta whose records are not written yet: it waits briefly for the step-detector
 * events of the same period (the two sensors batch independently). Written in the same
 * transaction as the new [PhoneCounterLastEntity], so a delta is never lost to a process death;
 * a span left over from an earlier process resolves as a coarse `counterSpan`.
 */
@Entity(tableName = "phone_pending_spans")
data class PhonePendingSpanEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bootId: String,
    val mStartNs: Long,
    val mEndNs: Long,
    val steps: Long,
    /** Non-null when both ends came from the same registration, i.e. it was listened to throughout. */
    val listenId: Long?,
    val anchorId: String,
    val createdAtMs: Long,
)

/** A UTC anchor: `UTC = utcMs + (m − mNs)`. Re-taken on every clock-change broadcast. */
@Entity(tableName = "phone_anchors")
data class PhoneAnchorEntity(
    @PrimaryKey val anchorId: String,
    val bootId: String,
    val utcMs: Long,
    val mNs: Long,
    val reason: String,
    val takenAtMs: Long,
)

/** One `activity/phone_steps` record, ready to upload. [subject] is the event subject (unique). */
@Entity(tableName = "phone_step_records", indices = [Index(value = ["subject"], unique = true), Index("startMs")])
data class PhoneStepRecordEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val subject: String,
    val startMs: Long,
    val endMs: Long,
    val steps: Long,
    /** `minute` | `counterSpan`. */
    val support: String,
    /** `detector` | `counter`. */
    val timing: String,
    val parentSteps: Long?,
    val bootId: String,
    val mStartNs: Long,
    val mEndNs: Long,
    val anchorId: String,
    val createdAtMs: Long,
)

/**
 * One `phone/acquisition` interval. [toMs] is null while it is open; [lastSeenMs] is the latest
 * moment it is known to have held, which closes it after a process death.
 */
@Entity(tableName = "phone_acquisition", indices = [Index("toMs")])
data class PhoneAcquisitionEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val fromMs: Long,
    val toMs: Long?,
    /** `listening` | `stopped` | `noSensor` | `noPermission`. */
    val state: String,
    val lastSeenMs: Long,
    /**
     * For a `listening` interval only: whether `TYPE_STEP_DETECTOR` was actually registered beside the
     * counter — [com.pulseloop.phone.PhoneAcquisitionLog.DETECTOR_REGISTERED], [com.pulseloop.phone.PhoneAcquisitionLog.DETECTOR_ABSENT] or
     * [com.pulseloop.phone.PhoneAcquisitionLog.DETECTOR_FAILED]. Null for other states and for rows from before v2.
     */
    val detector: String? = null,
)

@Dao
abstract class PhoneSourceDao {
    @Query("SELECT * FROM phone_counter_last WHERE slot = 0")
    abstract suspend fun last(): PhoneCounterLastEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putLast(row: PhoneCounterLastEntity)

    @Insert
    abstract suspend fun insertPending(span: PhonePendingSpanEntity): Long

    @Query("SELECT * FROM phone_pending_spans ORDER BY mEndNs ASC, id ASC")
    abstract suspend fun pending(): List<PhonePendingSpanEntity>

    @Query("DELETE FROM phone_pending_spans WHERE id = :id")
    abstract suspend fun deletePending(id: Long)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertRecords(rows: List<PhoneStepRecordEntity>): List<Long>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putAnchor(anchor: PhoneAnchorEntity)

    @Query("SELECT * FROM phone_anchors WHERE anchorId = :id")
    abstract suspend fun anchor(id: String): PhoneAnchorEntity?

    @Query("SELECT * FROM phone_step_records WHERE seq > :afterSeq ORDER BY seq ASC LIMIT :limit")
    abstract suspend fun recordsAfter(afterSeq: Long, limit: Int): List<PhoneStepRecordEntity>

    @Query("SELECT * FROM phone_acquisition WHERE toMs IS NULL ORDER BY seq DESC LIMIT 1")
    abstract suspend fun openInterval(): PhoneAcquisitionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putInterval(row: PhoneAcquisitionEntity): Long

    /** Closed intervals only: an open one is still changing. */
    @Query("SELECT * FROM phone_acquisition WHERE toMs IS NOT NULL AND seq > :afterSeq ORDER BY seq ASC LIMIT :limit")
    abstract suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int): List<PhoneAcquisitionEntity>

    @Query("UPDATE phone_acquisition SET lastSeenMs = :at WHERE toMs IS NULL AND lastSeenMs < :at")
    abstract suspend fun touchOpen(at: Long)

    /** The counter sample, its pending delta (if any) and its anchor, as one durable step. */
    @Transaction
    open suspend fun commitSample(last: PhoneCounterLastEntity, span: PhonePendingSpanEntity?) {
        if (span != null) insertPending(span)
        putLast(last)
    }

    /** A resolved span: its records replace the pending row in one step. */
    @Transaction
    open suspend fun resolve(spanId: Long, records: List<PhoneStepRecordEntity>) {
        if (records.isNotEmpty()) insertRecords(records)
        deletePending(spanId)
    }

    /** Close [closing] (if any) and open [next] in one step. */
    @Transaction
    open suspend fun transition(closing: PhoneAcquisitionEntity?, next: PhoneAcquisitionEntity?) {
        if (closing != null) putInterval(closing)
        if (next != null) putInterval(next)
    }
}

// ── Activity Recognition (Transition API) ──────────────────────────────────────────────────

/**
 * One Transition API event (`phone/activity_transition`). Unique on what the event *is* — boot,
 * `elapsedRealtimeNanos`, activity, transition — so a re-delivered event is ignored, never stored twice.
 * [occurredAtMs] is the occurrence time mapped through [anchorId] (`phone_anchors`), never the callback time.
 */
@Entity(
    tableName = "activity_transitions",
    indices = [Index(value = ["bootId", "elapsedNs", "activity", "transition"], unique = true)],
)
data class ActivityTransitionEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val bootId: String,
    val elapsedNs: Long,
    /** `IN_VEHICLE` | `ON_BICYCLE` | `RUNNING` | `WALKING` | `STILL`. */
    val activity: String,
    /** `ENTER` | `EXIT`. */
    val transition: String,
    val occurredAtMs: Long,
    val anchorId: String,
    val registrationEpoch: Int,
    val receivedAtMs: Long,
)

/**
 * One `phone/activity_recognition_acquisition` interval: `listening | noPermission | unsupported |
 * failed | stopped`, with the registration attempt it belongs to. [toMs] is null while open.
 */
@Entity(tableName = "activity_acquisition", indices = [Index("toMs")])
data class ActivityAcquisitionEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val fromMs: Long,
    val toMs: Long?,
    val state: String,
    val lastSeenMs: Long,
    val registrationEpoch: Int,
)

@Dao
abstract class ActivitySourceDao {
    /**
     * One callback's events in one transaction (Room wraps a list insert in one). Re-delivered events are
     * ignored by the unique index; returns the row ids, -1 for an ignored one.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertTransitions(rows: List<ActivityTransitionEntity>): List<Long>

    @Query("SELECT * FROM activity_transitions WHERE seq > :afterSeq ORDER BY seq ASC LIMIT :limit")
    abstract suspend fun transitionsAfter(afterSeq: Long, limit: Int): List<ActivityTransitionEntity>

    @Query("SELECT * FROM activity_acquisition WHERE toMs IS NULL ORDER BY seq DESC LIMIT 1")
    abstract suspend fun openInterval(): ActivityAcquisitionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putInterval(row: ActivityAcquisitionEntity): Long

    @Query("SELECT * FROM activity_acquisition WHERE toMs IS NOT NULL AND seq > :afterSeq ORDER BY seq ASC LIMIT :limit")
    abstract suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int): List<ActivityAcquisitionEntity>

    @Query("UPDATE activity_acquisition SET lastSeenMs = :at WHERE toMs IS NULL AND lastSeenMs < :at")
    abstract suspend fun touchOpen(at: Long)

    @Query("SELECT COALESCE(MAX(registrationEpoch), 0) FROM activity_acquisition")
    abstract suspend fun maxEpoch(): Int

    /** The newest UTC anchor of [bootId] (shared with the phone step counter). */
    @Query("SELECT * FROM phone_anchors WHERE bootId = :bootId ORDER BY takenAtMs DESC, mNs DESC LIMIT 1")
    abstract suspend fun latestAnchor(bootId: String): PhoneAnchorEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putAnchor(anchor: PhoneAnchorEntity)

    /** Close [closing] (if any) and open [next] in one step. */
    @Transaction
    open suspend fun transition(closing: ActivityAcquisitionEntity?, next: ActivityAcquisitionEntity?) {
        if (closing != null) putInterval(closing)
        if (next != null) putInterval(next)
    }
}

// ── Health Connect reader ───────────────────────────────────────────────────────────────────

/**
 * One Health Connect record as Gauge read it, or its tombstone. [key] = `<recordType>:<hcRecordId>`
 * (the event subject). A new revision REPLACEs the row, which gives it a new [seq] and so queues
 * it again. [dataJson] is the event's `data` minus `received_at`.
 */
@Entity(tableName = "hc_records", indices = [Index(value = ["key"], unique = true)])
data class HcRecordEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val key: String,
    val recordType: String,
    val hcId: String,
    val deleted: Boolean,
    val lastModifiedMs: Long,
    val startMs: Long,
    val dataJson: String,
    val readAtMs: Long,
)

/** Reader state: per-type changes tokens, back-fill progress and scope state, by key. */
@Entity(tableName = "hc_state")
data class HcStateEntity(
    @PrimaryKey val key: String,
    val value: String,
)

@Dao
abstract class HcSourceDao {
    @Query("SELECT * FROM hc_records WHERE key = :key")
    abstract suspend fun record(key: String): HcRecordEntity?

    @Query("SELECT * FROM hc_records WHERE key IN (:keys)")
    abstract suspend fun records(keys: List<String>): List<HcRecordEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putRecords(rows: List<HcRecordEntity>)

    @Query("SELECT * FROM hc_records WHERE seq > :afterSeq ORDER BY seq ASC LIMIT :limit")
    abstract suspend fun recordsAfter(afterSeq: Long, limit: Int): List<HcRecordEntity>

    @Query("SELECT * FROM hc_state")
    abstract suspend fun allState(): List<HcStateEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putState(rows: List<HcStateEntity>)

    @Query("DELETE FROM hc_state WHERE key IN (:keys)")
    abstract suspend fun deleteState(keys: List<String>)

    /**
     * Records and the reader position that covers them, atomically: the token (or page token)
     * never advances past a record that is not durably held here (SPEC GB.2).
     */
    @Transaction
    open suspend fun commit(rows: List<HcRecordEntity>, state: List<HcStateEntity>, clear: List<String>) {
        if (rows.isNotEmpty()) putRecords(rows)
        if (clear.isNotEmpty()) deleteState(clear)
        if (state.isNotEmpty()) putState(state)
    }
}
