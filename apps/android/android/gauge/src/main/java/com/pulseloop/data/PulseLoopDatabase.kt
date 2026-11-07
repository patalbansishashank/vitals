package com.pulseloop.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
import com.pulseloop.data.dao.*
import com.pulseloop.data.entity.*

/**
 * Ported from the SwiftData ModelContainer in PulseLoop.
 * Room database holding all PulseLoop entities.
 */
/** Schema version; [PulseLoopDatabase.migrations] must reach it. */
internal const val DATABASE_VERSION = 37

@Database(
    entities = [
        DeviceEntity::class,
        MeasurementEntity::class,
        ActivityDailyEntity::class,
        ActivityBucketEntity::class,
        DeviceMeasurementConfigEntity::class,
        ActivitySessionEntity::class,
        ActivityGpsPointEntity::class,
        ActivityEventEntity::class,
        ActivitySampleEntity::class,
        ActivitySensorPollEntity::class,
        SleepSessionEntity::class,
        SleepStageBlockEntity::class,
        UserProfileEntity::class,
        UserGoalEntity::class,
        RawPacketEntity::class,
        DerivedUpdateEntity::class,
        WearableLogEntity::class,
        BatterySampleEntity::class,
        MealEntryEntity::class,
        CachedFoodProductEntity::class,
        MeasurementDeletionEntity::class,
        BroadcastOutboxEntity::class,
        HubOutboxEntity::class,
        com.pulseloop.shortvideo.ShortVideoDayEntity::class,
        HubPendingDeletionEntity::class,
        RingSportFrameEntity::class,
    ],
    version = DATABASE_VERSION,
    exportSchema = false,
)
abstract class PulseLoopDatabase : RoomDatabase() {
    abstract fun deviceDao(): DeviceDao
    abstract fun measurementDao(): MeasurementDao
    /** Issue #60: the tombstones that keep a deleted reading deleted across re-syncs. */
    abstract fun measurementDeletionDao(): MeasurementDeletionDao
    abstract fun activityDailyDao(): ActivityDailyDao
    abstract fun activityBucketDao(): ActivityBucketDao
    abstract fun deviceMeasurementConfigDao(): DeviceMeasurementConfigDao
    abstract fun activitySessionDao(): ActivitySessionDao
    abstract fun activitySensorPollDao(): ActivitySensorPollDao
    abstract fun activityGpsPointDao(): ActivityGpsPointDao
    // ActivityEventEntity is already in the @Database entities above (and "activity_events" is
    // in ALL_TABLES), so exposing its DAO adds no schema — no version bump, no migration.
    abstract fun activityEventDao(): ActivityEventDao
    abstract fun sleepSessionDao(): SleepSessionDao
    abstract fun sleepStageBlockDao(): SleepStageBlockDao
    abstract fun userProfileDao(): UserProfileDao
    abstract fun userGoalDao(): UserGoalDao
    abstract fun wearableLogDao(): WearableLogDao
    abstract fun rawPacketDao(): RawPacketDao
    abstract fun measurementBatchDeletionDao(): MeasurementBatchDeletionDao
    abstract fun batterySampleDao(): BatterySampleDao
    // iOS #96: Nutrition. The feature is gone (it lives in the Vitals app); the tables
    // `meal_entries` and `food_products` stay, with their rows, until the owner decides
    // whether to move past meals into Vitals. See NutritionEntities.kt.
    abstract fun mealEntryDao(): MealEntryDao
    abstract fun foodProductDao(): FoodProductDao
    abstract fun broadcastOutboxDao(): BroadcastOutboxDao
    /** The HTTPS home-server (OCI hub) outbox — its own queue and cursor, never MQTT's. */
    abstract fun hubOutboxDao(): HubOutboxDao
    /** v33: hub deletions queued where no installation id was at hand (the v33 migration). */
    abstract fun hubPendingDeletionDao(): HubPendingDeletionDao
    /** Daily Reels/Shorts tallies (v32); counts only. */
    abstract fun shortVideoDao(): com.pulseloop.shortvideo.ShortVideoDao
    /** Read-only keyset paging over the health tables for the hub's first-pair backfill. */
    abstract fun hubBackfillDao(): HubBackfillDao
    /** `derived_updates` has existed since v1; exposing its DAO is not a schema change. */
    abstract fun derivedUpdateDao(): DerivedUpdateDao

    /**
     * Empty every table, atomically. Goes through Room's [withTransaction] rather than a raw
     * `openHelper.writableDatabase.beginTransaction()`: only the Room path runs
     * `RoomDatabase.endTransaction()`, which is what kicks the invalidation tracker — without it
     * every observing Flow keeps serving the rows we just deleted until something else writes.
     *
     * Not [clearAllTables]: that also drops the sqlite_sequence rows and checkpoints the WAL, and
     * it throws if called while a transaction is open.
     */
    suspend fun nukeAllTables() = withTransaction {
        for (table in ALL_TABLES) {
            openHelper.writableDatabase.execSQL("DELETE FROM $table")
        }
    }

    companion object {
        /**
         * Every table in the schema, in parent-before-child order so the CASCADE foreign keys
         * (sleep_stage_blocks → sleep_sessions) resolve on
         * their own. Used by [nukeAllTables].
         */
        val ALL_TABLES = listOf(
            "devices", "measurements", "activity_daily", "activity_buckets",
            "battery_samples", "device_measurement_configs", "activity_sessions",
            "activity_gps_points", "activity_events", "activity_samples",
            "activity_sensor_polls", "sleep_sessions", "sleep_stage_blocks",
            "user_profiles", "user_goals",
            "raw_packets", "derived_updates",
            "wearable_logs",
            "meal_entries", "food_products", "measurement_deletions",
            "broadcast_outbox", "hub_outbox", "short_video_days", "hub_pending_deletions",
            "ring_sport_frames",
        )

        @Volatile private var INSTANCE: PulseLoopDatabase? = null

        /** v2 → v3: adds the activity_buckets table (idempotent re-sync of activity history). */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `activity_buckets` (
                        `startEpoch` INTEGER NOT NULL,
                        `date` INTEGER NOT NULL,
                        `steps` INTEGER NOT NULL,
                        `distanceMeters` REAL NOT NULL,
                        `source` TEXT NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`startEpoch`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_activity_buckets_date` ON `activity_buckets` (`date`)")
            }
        }

        /** v3 → v4: per-device measurement config (iOS #19) + coach message attachments (iOS #31). */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `device_measurement_configs` (
                        `deviceId` TEXT NOT NULL,
                        `hrIntervalMinutes` INTEGER NOT NULL,
                        `hrEnabled` INTEGER NOT NULL,
                        `spo2Enabled` INTEGER NOT NULL,
                        `stressEnabled` INTEGER NOT NULL,
                        `hrvEnabled` INTEGER NOT NULL,
                        `temperatureEnabled` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`deviceId`)
                    )
                    """.trimIndent()
                )
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `attachmentsJson` TEXT")
            }
        }

        /** v4 → v5: distance + calorie goal columns on user_goals (iOS #48 GoalDraft). */
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `distanceMeters` REAL NOT NULL DEFAULT 8000.0")
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `calories` INTEGER NOT NULL DEFAULT 500")
            }
        }

        /** v5 → v6: exact wearable model id on devices (iOS #49 exact-model identification). */
        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `devices` ADD COLUMN `wearableModelID` TEXT")
            }
        }

        /** v6 → v7: sleep session provenance, so demo seeding/clearing can't touch ring sessions. */
        private val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `sleep_sessions` ADD COLUMN `sourceRaw` TEXT NOT NULL DEFAULT 'ring'")
            }
        }

        /** v7 → v8: battery-level history for the Wearable-settings drainage chart (iOS #61b). */
        private val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `battery_samples` (
                        `id` TEXT NOT NULL,
                        `percent` INTEGER NOT NULL,
                        `timestamp` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_battery_samples_timestamp` ON `battery_samples` (`timestamp`)")
            }
        }

        /** v8 → v9: a device-level "sync actually completed" stamp, separate from [DeviceEntity.lastSyncAt]
         *  (re-stamped on every bare CONNECT) — the coach-notification freshness gate (iOS #61c). */
        private val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `devices` ADD COLUMN `lastFullSyncAt` INTEGER")
            }
        }

        /** v9 → v10: token/cost usage accounting on coach conversations + messages
         *  (iOS #65b). Running totals on the conversation; per-turn tokens/cost/
         *  model/provider on the message. */
        private val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `coach_conversations` ADD COLUMN `totalInputTokens` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `coach_conversations` ADD COLUMN `totalOutputTokens` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `coach_conversations` ADD COLUMN `totalCostUSD` REAL NOT NULL DEFAULT 0.0")
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `inputTokens` INTEGER")
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `outputTokens` INTEGER")
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `costUSD` REAL")
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `modelUsed` TEXT")
                db.execSQL("ALTER TABLE `coach_messages` ADD COLUMN `providerUsed` TEXT")
            }
        }

        /** v10 → v11: tool-call trace metadata (iOS #65c). Friendly label,
         *  success/error status, and turn-order sequence per tool call, plus an
         *  index on messageId for the trace-disclosure UI query. */
        private val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `coach_tool_calls` ADD COLUMN `label` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `coach_tool_calls` ADD COLUMN `statusRaw` TEXT NOT NULL DEFAULT 'success'")
                db.execSQL("ALTER TABLE `coach_tool_calls` ADD COLUMN `sequence` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_coach_tool_calls_messageId` ON `coach_tool_calls` (`messageId`)")
            }
        }

        /** v11 → v12: persisted delivered check-ins, so the notification generator can
         *  avoid repeating its own recent phrasing/openings (iOS #65 anti-repeat hint). */
        private val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `coach_notification_records` (
                        `id` TEXT NOT NULL,
                        `title` TEXT NOT NULL,
                        `body` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_coach_notification_records_createdAt` ON `coach_notification_records` (`createdAt`)")
            }
        }

        /** v12 → v13: index replayed sensor-history identity without deleting valid collisions. */
        private val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Feature APKs briefly used version 8 for this index before main assigned v8 to
                // battery history. Keep the migration valid for both upgrade lineages.
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `battery_samples` (
                        `id` TEXT NOT NULL,
                        `percent` INTEGER NOT NULL,
                        `timestamp` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_battery_samples_timestamp` ON `battery_samples` (`timestamp`)")
                adoptStableMeasurementIdentities(db)
            }
        }

        /** v13 → v14: replace the pre-review unique identity index without dropping rows. */
        private val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                adoptStableMeasurementIdentities(db)
            }
        }

        /** v14 → v15: re-run identity adoption now that it also covers HRV rows stored as 'live'.
         *  Same reasoning as v13 → v14: a test APK that already reached v14 ran the pre-fix version
         *  of [adoptStableMeasurementIdentities] and would otherwise keep its un-keyed HRV rows,
         *  which double the HRV series on the next re-sync. The function is idempotent, so re-running
         *  it is free for anyone whose rows are already adopted. */
        private val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                adoptStableMeasurementIdentities(db)
            }
        }

        /**
         * v15 → v16: delete the duplicate rows the pre-identity code accumulated.
         *
         * Before measurements had stable ids, a ring's history *replay* was persisted with a fresh
         * random id every time, so each re-sync appended another row at a slot already stored — on
         * a real Colmi that meant HRV, stress and temperature growing by one row per slot per sync,
         * forever (nothing prunes this table). [adoptStableMeasurementIdentities] stops the growth
         * by giving one row per slot the canonical `history:<key>:<timestamp>` id that later syncs
         * upsert onto, but it deliberately leaves the already-accumulated copies in place. They are
         * not harmless: `dailyAggregates`/`hourlyAggregates` compute `AVG(value)` over raw rows with
         * no `sourceRaw` filter, so a slot replayed more often than its neighbours drags the average
         * toward its value.
         *
         * Deleting is restricted to rows that are **provably redundant**: a non-canonical row is
         * removed only when a canonical row exists for the same `(kindRaw, timestamp)` *and* holds
         * the same `value`. A row whose value differs is a distinct reading and is always kept, so
         * this can never destroy information — every deleted row's (kind, timestamp, value) is still
         * represented by the canonical row that survives.
         *
         * **Interruption safety.** This is deliberately one statement. SQLite applies a single
         * `DELETE` atomically via its journal, so a process kill mid-migration can only leave the
         * table fully cleaned or wholly untouched — never half-deleted. Room additionally runs
         * migrations inside the transaction `SQLiteOpenHelper` opens around `onUpgrade`, so the
         * schema-version bump and this delete commit together: an interrupted upgrade rolls back to
         * v15 and simply re-runs on the next launch. The statement is also idempotent — once the
         * redundant rows are gone it matches nothing — so re-running after a rollback is a no-op.
         */
        private val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    DELETE FROM `measurements`
                    WHERE `id` NOT LIKE 'history:%'
                      AND EXISTS (
                          SELECT 1 FROM `measurements` AS `canonical`
                          WHERE `canonical`.`id` LIKE 'history:%'
                            AND `canonical`.`kindRaw` = `measurements`.`kindRaw`
                            AND `canonical`.`timestamp` = `measurements`.`timestamp`
                            AND `canonical`.`value` = `measurements`.`value`
                      )
                    """.trimIndent()
                )
            }
        }

        private val MIGRATION_16_17 = object : Migration(16, 17) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `activity_daily` ADD COLUMN `estimatedActiveCalories` REAL")
            }
        }

        private val MIGRATION_17_18 = object : Migration(17, 18) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrZoneModeRaw` TEXT NOT NULL DEFAULT 'auto'")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrRestingBaseline` REAL")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrRestingBaselineUpdatedAt` INTEGER")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrCustomLowUpper` REAL")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrCustomAthleticUpper` REAL")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrCustomElevatedStart` REAL")
                db.execSQL("ALTER TABLE `user_profiles` ADD COLUMN `hrCustomHighStart` REAL")
            }
        }

        private val MIGRATION_18_19 = object : Migration(18, 19) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `activity_sessions` ADD COLUMN `stravaActivityId` INTEGER")
            }
        }

        private val MIGRATION_19_20 = object : Migration(19, 20) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `intakeCalories` REAL")
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `intakeProteinG` REAL")
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `intakeCarbsG` REAL")
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `intakeFatG` REAL")
                db.execSQL("ALTER TABLE `user_goals` ADD COLUMN `nutritionEnabled` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `meal_entries` (
                        `id` TEXT NOT NULL, `date` INTEGER NOT NULL, `timestamp` INTEGER NOT NULL,
                        `name` TEXT NOT NULL, `mealTypeRaw` TEXT NOT NULL DEFAULT 'snack',
                        `calories` REAL NOT NULL, `proteinG` REAL NOT NULL DEFAULT 0,
                        `carbsG` REAL NOT NULL DEFAULT 0, `fatG` REAL NOT NULL DEFAULT 0,
                        `fiberG` REAL, `sugarG` REAL, `sodiumMg` REAL,
                        `sourceRaw` TEXT NOT NULL DEFAULT 'manual', `offProductCode` TEXT,
                        `servingDescription` TEXT, `servingGrams` REAL, `quantity` REAL NOT NULL DEFAULT 1,
                        `confidenceRaw` TEXT NOT NULL DEFAULT 'medium', `userEdited` INTEGER NOT NULL DEFAULT 0,
                        `notes` TEXT, `loggedByCoach` INTEGER NOT NULL DEFAULT 0,
                        `createdAt` INTEGER NOT NULL, PRIMARY KEY(`id`)
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_meal_entries_date` ON `meal_entries` (`date`)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `food_products` (
                        `code` TEXT NOT NULL, `name` TEXT NOT NULL, `brand` TEXT,
                        `energyKcal100g` REAL NOT NULL, `protein100g` REAL NOT NULL DEFAULT 0,
                        `carbs100g` REAL NOT NULL DEFAULT 0, `fat100g` REAL NOT NULL DEFAULT 0,
                        `fiber100g` REAL, `sugars100g` REAL, `saturatedFat100g` REAL,
                        `sodiumMg100g` REAL, `servingSizeText` TEXT, `servingQuantityG` REAL,
                        `lastUsedAt` INTEGER NOT NULL, `useCount` INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY(`code`)
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_food_products_lastUsedAt` ON `food_products` (`lastUsedAt`)")
            }
        }

        /**
         * v20 -> v21: `meal_entries.updatedAt` (Phase 6). The Health Connect nutrition export
         * watermarks on and versions by [com.pulseloop.data.entity.MealEntryEntity.updatedAt] so
         * a future in-place meal edit re-exports under the same `pl-meal-<id>` clientRecordId.
         * Rows are insert-once today, so backfilling `updatedAt = createdAt` is exactly
         * lossless — every existing row's two stamps are already equal. Added with a temporary
         * `DEFAULT 0` (SQLite requires one for a NOT NULL ADD COLUMN) then backfilled in a
         * single statement; both run inside Room's onUpgrade transaction, so an interrupted
         * upgrade rolls back to v20 and re-runs.
         */
        private val MIGRATION_20_21 = object : Migration(20, 21) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `meal_entries` ADD COLUMN `updatedAt` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE `meal_entries` SET `updatedAt` = `createdAt`")
            }
        }

        /**
         * v21 -> v22: per-day/slot dedupe on delivered check-ins (iOS #94
         * CoachNotificationDataTrigger). The data trigger re-runs the due slot when a
         * full sync completes, so both the periodic worker and the trigger need a shared
         * "did this slot already fire today?" lookup — dateKey (local epoch day) + slotRaw
         * (lowercase slot name) is that key. Both columns are NOT NULL with defaults so
         * pre-#94 rows (and archive restores, which don't carry the fields) get 0/"" and
         * can never match a real dedupe query. The composite index backs the EXISTS check.
         */
        private val MIGRATION_21_22 = object : Migration(21, 22) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `coach_notification_records` ADD COLUMN `dateKey` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `coach_notification_records` ADD COLUMN `slotRaw` TEXT NOT NULL DEFAULT ''")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_coach_notification_records_dateKey_slotRaw` ON `coach_notification_records` (`dateKey`, `slotRaw`)")
            }
        }

        /**
         * Normalizes `meal_entries.confidenceRaw`. The column defaulted to "medium", which is
         * not a value in the known/partial/unknown vocabulary the rest of the app (and iOS)
         * uses — every deliberate writer maps onto those three, so any stored "medium" is the
         * old default leaking through, never a user's or the coach's intent. iOS's own reader
         * falls back to `.known` for an unrecognized raw (NutritionModels.swift:147), so this
         * just makes the stored bytes agree with how both platforms already read them.
         */
        private val MIGRATION_22_23 = object : Migration(22, 23) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("UPDATE `meal_entries` SET `confidenceRaw` = 'known' WHERE `confidenceRaw` = 'medium'")
            }
        }

        /**
         * v23 → v24: the deleted-reading tombstones (issue #60). Deleting a history-sourced
         * measurement only sticks if the deletion outlives the row — see
         * [com.pulseloop.data.entity.MeasurementDeletionEntity].
         */
        private val MIGRATION_23_24 = object : Migration(23, 24) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `measurement_deletions` (
                        `measurementId` TEXT NOT NULL,
                        `kindRaw` TEXT NOT NULL,
                        `timestamp` INTEGER NOT NULL,
                        `deletedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`measurementId`)
                    )
                    """.trimIndent()
                )
            }
        }

        /**
         * v24 -> v25: `raw_packets.deviceTypeRaw`, so the diagnostics report masks each captured
         * frame against the family that sent it rather than against whichever ring is connected
         * when the report is exported (a Colmi frame masked with CRP's six-byte header exports five
         * bytes of samples). Nullable with no backfill on purpose — the family of an already
         * captured packet is not recoverable, and the redactor masks a row with no family from
         * byte 1, which is the conservative reading. `raw_packets` is a 1000-row debug ring buffer,
         * so existing rows age out within a session or two of use.
         */
        private val MIGRATION_24_25 = object : Migration(24, 25) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `raw_packets` ADD COLUMN `deviceTypeRaw` TEXT")
            }
        }

        /** v25 -> v26: durable, at-least-once external-event outbox. */
        private val MIGRATION_25_26 = object : Migration(25, 26) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `broadcast_outbox` (
                        `eventId` TEXT NOT NULL,
                        `topicSuffix` TEXT NOT NULL,
                        `payloadJson` TEXT NOT NULL,
                        `qos` INTEGER NOT NULL,
                        `retain` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `attemptCount` INTEGER NOT NULL,
                        `lastAttemptAt` INTEGER,
                        `lastError` TEXT,
                        `publishedAt` INTEGER,
                        PRIMARY KEY(`eventId`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_broadcast_outbox_publishedAt` " +
                        "ON `broadcast_outbox` (`publishedAt`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_broadcast_outbox_createdAt` " +
                        "ON `broadcast_outbox` (`createdAt`)",
                )
            }
        }

        /**
         * v26 -> v27: firmware provenance on debug raw packets. Existing rows stay null because
         * the revision active when they were captured cannot be recovered safely after the fact.
         */
        private val MIGRATION_26_27 = object : Migration(26, 27) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `raw_packets` ADD COLUMN `firmwareRevision` TEXT")
            }
        }

        /**
         * v27 -> v28: retain the original validated AI meal estimate separately from the final
         * user-reviewed meal columns, plus non-secret provider/model provenance. Existing and
         * non-AI meals remain null.
         */
        internal val MIGRATION_27_28 = object : Migration(27, 28) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `meal_entries` ADD COLUMN `aiEstimateJson` TEXT")
                db.execSQL("ALTER TABLE `meal_entries` ADD COLUMN `aiProviderRaw` TEXT")
                db.execSQL("ALTER TABLE `meal_entries` ADD COLUMN `aiModel` TEXT")
            }
        }

        internal val MIGRATION_28_29 = object : Migration(28, 29) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE raw_packets_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, timestamp INTEGER NOT NULL,
                    directionRaw TEXT NOT NULL, commandId INTEGER NOT NULL, hexPayload TEXT NOT NULL,
                    decodedKind TEXT, decodedJSON TEXT, confidenceRaw TEXT NOT NULL,
                    deviceTypeRaw TEXT, firmwareRevision TEXT, createdAt INTEGER NOT NULL)""")
                db.execSQL("""INSERT INTO raw_packets_new
                    (timestamp,directionRaw,commandId,hexPayload,decodedKind,decodedJSON,confidenceRaw,deviceTypeRaw,firmwareRevision,createdAt)
                    SELECT timestamp,directionRaw,commandId,hexPayload,decodedKind,decodedJSON,confidenceRaw,deviceTypeRaw,firmwareRevision,createdAt
                    FROM (SELECT *, rowid AS legacyRowId FROM raw_packets ORDER BY timestamp DESC, rowid DESC LIMIT 5000)
                    ORDER BY timestamp ASC, legacyRowId ASC""")
                db.execSQL("DROP TABLE raw_packets")
                db.execSQL("ALTER TABLE raw_packets_new RENAME TO raw_packets")
                db.execSQL("CREATE INDEX index_raw_packets_timestamp ON raw_packets(timestamp)")
                db.execSQL("CREATE INDEX index_raw_packets_firmwareRevision_decodedKind ON raw_packets(firmwareRevision,decodedKind)")
                db.execSQL("CREATE INDEX index_derived_updates_timestamp ON derived_updates(timestamp)")
                db.execSQL("CREATE INDEX index_derived_updates_kind_entityId ON derived_updates(kind,entityId)")
                db.execSQL("CREATE INDEX index_sleep_sessions_startAt ON sleep_sessions(startAt)")
                db.execSQL("DROP INDEX IF EXISTS index_measurements_kindRaw")
            }
        }

        internal val MIGRATION_29_30 = object : Migration(29, 30) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Existing deliveries need the same compact receipt as newly acknowledged ones.
                db.execSQL("UPDATE broadcast_outbox SET payloadJson = '' WHERE publishedAt IS NOT NULL")
            }
        }

        /**
         * v30 -> v31: the HTTPS home-server outbox. A new table only; no existing row changes.
         * Kept separate from `broadcast_outbox` because MQTT blanks a payload on publish.
         */
        internal val MIGRATION_30_31 = object : Migration(30, 31) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `hub_outbox` (
                        `eventId` TEXT NOT NULL,
                        `category` TEXT NOT NULL,
                        `payloadJson` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `attemptCount` INTEGER NOT NULL,
                        `lastAttemptAt` INTEGER,
                        `lastError` TEXT,
                        `uploadedAt` INTEGER,
                        `rejected` INTEGER NOT NULL,
                        PRIMARY KEY(`eventId`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_hub_outbox_uploadedAt` ON `hub_outbox` (`uploadedAt`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_hub_outbox_createdAt` ON `hub_outbox` (`createdAt`)",
                )
            }
        }

        /** v31 -> v32: daily short-video tallies. A new table only; no existing row changes. */
        /**
         * v32 → v33: removes every duplicate 2.7.3's ring-clock correction stored (buckets,
         * ring-history measurements, sleep tails) and re-derives their days ([ClockDuplicateMigration]).
         * This instance has no clock segments (near copies only); [getInstance] builds one that
         * reads the ring's.
         */
        internal val MIGRATION_32_33 = ClockDuplicateMigration({ emptyList() })

        internal val MIGRATION_31_32 = object : Migration(31, 32) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `short_video_days` (
                        `date` TEXT NOT NULL,
                        `app` TEXT NOT NULL,
                        `count` INTEGER NOT NULL,
                        `limitHits` INTEGER NOT NULL,
                        `cancels` INTEGER NOT NULL,
                        `dailyLimit` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`date`, `app`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_short_video_days_date` ON `short_video_days` (`date`)")
            }
        }

        /**
         * v33 -> v34: drop the iOS #96 intake goals (`intakeCalories`, `intakeProteinG`,
         * `intakeCarbsG`, `intakeFatG`, `nutritionEnabled`) from `user_goals`. Nutrition moved to
         * the Vitals app. SQLite before 3.35 has no DROP COLUMN, so the table is rebuilt and
         * every goal row is copied across with its other columns unchanged. The meal tables
         * (`meal_entries`, `food_products`) are not touched.
         */
        internal val MIGRATION_33_34 = object : Migration(33, 34) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Defensive: a build that never had the intake columns has nothing to rebuild.
                if (!hasColumn(db, "user_goals", "intakeCalories")) return
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `user_goals_new` (
                        `id` TEXT NOT NULL,
                        `steps` INTEGER NOT NULL,
                        `distanceMeters` REAL NOT NULL DEFAULT 8000.0,
                        `calories` INTEGER NOT NULL DEFAULT 500,
                        `sleepMinutes` INTEGER NOT NULL,
                        `activeMinutes` INTEGER NOT NULL,
                        `workoutsPerWeek` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "INSERT INTO `user_goals_new` (`id`, `steps`, `distanceMeters`, `calories`, " +
                        "`sleepMinutes`, `activeMinutes`, `workoutsPerWeek`, `updatedAt`) " +
                        "SELECT `id`, `steps`, `distanceMeters`, `calories`, `sleepMinutes`, " +
                        "`activeMinutes`, `workoutsPerWeek`, `updatedAt` FROM `user_goals`"
                )
                db.execSQL("DROP TABLE `user_goals`")
                db.execSQL("ALTER TABLE `user_goals_new` RENAME TO `user_goals`")
            }
        }

        /**
         * v34 -> v35: the local AI coach is gone (2.8.0, Gauge became Vitals' companion; the coach
         * lives in Vitals and on the home server). Drop its six tables and every conversation,
         * memory, summary and check-in record in them. Children before parents.
         */
        internal val MIGRATION_34_35 = object : Migration(34, 35) {
            override fun migrate(db: SupportSQLiteDatabase) {
                RETIRED_COACH_TABLES.forEach { db.execSQL("DROP TABLE IF EXISTS `$it`") }
            }
        }

        /**
         * v35 → v36 (SPEC GA): ring step evidence. `activity_buckets` gains its support columns;
         * every existing row keeps `support = 'legacyUnknown'` and a null duration, because the
         * decoder that wrote it dropped zero minutes and did not mark fallbacks (GA.7). Only a
         * fresh re-pull writes native support. Adds the 7-day `ring_sport_frames` capture.
         * Idempotent, so a half-applied run can be repeated.
         */
        internal val MIGRATION_35_36 = object : Migration(35, 36) {
            override fun migrate(db: SupportSQLiteDatabase) {
                listOf(
                    "durationS" to "INTEGER",
                    "support" to "TEXT NOT NULL DEFAULT 'legacyUnknown'",
                    "parentTotal" to "INTEGER",
                    "parentStart" to "INTEGER",
                    "deviceKey" to "TEXT",
                ).forEach { (column, type) ->
                    if (!hasColumn(db, "activity_buckets", column)) {
                        db.execSQL("ALTER TABLE `activity_buckets` ADD COLUMN `$column` $type")
                    }
                }
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `ring_sport_frames` (" +
                        "`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `receivedAt` INTEGER NOT NULL, " +
                        "`hexPayload` TEXT NOT NULL, `firmwareRevision` TEXT)"
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_ring_sport_frames_receivedAt` ON `ring_sport_frames` (`receivedAt`)")
            }
        }

        /**
         * v36 → v37 (2.8.1): `measurements.cadenceS`, the verified sampling cadence of a workout
         * heart-rate reading ([com.pulseloop.ring.HrProvenance]). Null for every existing row and
         * for all-day history; the ring re-supplies its workout stream on the next sync.
         */
        internal val MIGRATION_36_37 = object : Migration(36, 37) {
            override fun migrate(db: SupportSQLiteDatabase) {
                if (!hasColumn(db, "measurements", "cadenceS")) {
                    db.execSQL("ALTER TABLE `measurements` ADD COLUMN `cadenceS` INTEGER")
                }
            }
        }

        internal val RETIRED_COACH_TABLES = listOf(
            "coach_tool_calls", "coach_messages", "coach_conversations", "coach_memories",
            "coach_summaries", "coach_notification_records",
        )

        internal fun hasColumn(db: SupportSQLiteDatabase, table: String, column: String): Boolean =
            db.query("PRAGMA table_info(`$table`)").use { c ->
                val name = c.getColumnIndex("name")
                generateSequence { if (c.moveToNext()) c.getString(name) else null }.any { it == column }
            }

        private fun adoptStableMeasurementIdentities(db: SupportSQLiteDatabase) {
            db.execSQL("DROP INDEX IF EXISTS `index_measurements_kindRaw_timestamp_sourceRaw`")
            db.execSQL(
                "UPDATE `measurements` SET `sourceRaw` = 'live' " +
                    "WHERE `sourceRaw` = 'colmi' AND `kindRaw` IN ('HRV', 'TEMPERATURE')"
            )
            listOf(
                "HEART_RATE" to "hr",
                "SPO2" to "spo2",
                "STRESS" to "stress",
                "FATIGUE" to "fatigue",
                "HRV" to "hrv",
                "TEMPERATURE" to "temp",
                "BLOOD_PRESSURE_SYSTOLIC" to "bp_sys",
                "BLOOD_PRESSURE_DIASTOLIC" to "bp_dia",
                "BLOOD_SUGAR" to "glucose",
                "RESPIRATORY_RATE" to "resp_rate",
                "VO2MAX" to "vo2max",
            ).forEach { (kind, key) ->
                adoptStableMeasurementIdentity(db, kind = kind, source = "history", key = key)
            }
            adoptStableMeasurementIdentity(db, kind = "STRESS", source = "colmi", key = "stress")
            adoptStableMeasurementIdentity(db, kind = "TEMPERATURE", source = "live", key = "temp")
            // HRV needs the same 'live' pass as TEMPERATURE above, for the same reason: Colmi's
            // HRV *history* used to persist as an `HrvSample` — random id, sourceRaw 'live' — and
            // now decodes to a `HistoryMeasurement`, which keys on `history:hrv:<timestamp>`.
            // Without re-keying the old rows they don't collide with the new ones, so a re-sync
            // writes a second row at every timestamp already stored, and `range()` (which filters
            // on kindRaw + timestamp, never sourceRaw) returns both — doubling the HRV series.
            adoptStableMeasurementIdentity(db, kind = "HRV", source = "live", key = "hrv")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_measurements_kindRaw_timestamp_sourceRaw` " +
                    "ON `measurements` (`kindRaw`, `timestamp`, `sourceRaw`)"
            )
        }

        private fun adoptStableMeasurementIdentity(
            db: SupportSQLiteDatabase,
            kind: String,
            source: String,
            key: String,
        ) {
            db.execSQL(
                """
                UPDATE `measurements`
                SET `id` = 'history:$key:' || `timestamp`
                WHERE `kindRaw` = '$kind' AND `sourceRaw` = '$source'
                  AND `rowid` IN (
                      SELECT MIN(`rowid`) FROM `measurements`
                      WHERE `kindRaw` = '$kind' AND `sourceRaw` = '$source'
                      GROUP BY `timestamp`
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM `measurements` AS `existing`
                      WHERE `existing`.`id` = 'history:$key:' || `measurements`.`timestamp`
                  )
                """.trimIndent()
            )
        }

        /**
         * The one linear upgrade chain, v2 -> [DATABASE_VERSION]. v33 is feat/ota's ring-clock
         * duplicate repair (2.7.4), v34 the Nutrition removal's `user_goals` rebuild, v35 the
         * coach tables' removal (2.8.0), v36 ring step evidence (SPEC GA), v37 heart-rate cadence (2.8.1, [MIGRATION_36_37]). [PulseLoopMigrationChainTest] checks it has no gap.
         */
        internal fun migrations(context: Context): Array<Migration> = arrayOf(
                MIGRATION_2_3,
                MIGRATION_3_4,
                MIGRATION_4_5,
                MIGRATION_5_6,
                MIGRATION_6_7,
                MIGRATION_7_8,
                MIGRATION_8_9,
                MIGRATION_9_10,
                MIGRATION_10_11,
                MIGRATION_11_12,
                MIGRATION_12_13,
                MIGRATION_13_14,
                MIGRATION_14_15,
                MIGRATION_15_16,
                MIGRATION_16_17,
                MIGRATION_17_18,
                MIGRATION_18_19,
                MIGRATION_19_20,
                MIGRATION_20_21,
                MIGRATION_21_22,
                MIGRATION_22_23,
                MIGRATION_23_24,
                MIGRATION_24_25,
                MIGRATION_25_26,
                MIGRATION_26_27,
                MIGRATION_27_28,
                MIGRATION_28_29,
                MIGRATION_29_30,
                MIGRATION_30_31,
                MIGRATION_31_32,
                ClockDuplicateMigration({
                    com.pulseloop.ring.PrefsRingClockStore.allSegments(
                        context.applicationContext.getSharedPreferences(
                            com.pulseloop.ring.PrefsRingClockStore.PREFS_NAME, Context.MODE_PRIVATE,
                        ),
                    )
                }),
                MIGRATION_33_34,
                MIGRATION_34_35,
                MIGRATION_35_36,
                MIGRATION_36_37,
            )

        fun getInstance(context: Context): PulseLoopDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    PulseLoopDatabase::class.java,
                    "pulseloop.db"
                )
                    .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                    .addMigrations(*migrations(context))
                    // Downgrades only (sideloading an older APK). A blanket destructive
                    // fallback would silently wipe every measurement and sleep session on any
                    // future version bump that misses a Migration — that must fail loudly in
                    // development instead.
                    .fallbackToDestructiveMigrationOnDowngrade()
                    .build()
                    .also { INSTANCE = it }
            }
    }
}
