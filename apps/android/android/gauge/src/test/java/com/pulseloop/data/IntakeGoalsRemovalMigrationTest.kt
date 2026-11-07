package com.pulseloop.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Room
import androidx.room.RoomDatabase
import com.pulseloop.data.entity.MealEntryEntity
import com.pulseloop.data.entity.UserGoalEntity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Opens a real v33 Room file, applies MIGRATION_33_34, then lets Room validate the v34
 * `user_goals` schema. The intake goals go (Nutrition moved to the Vitals app); every other goal
 * column and every stored meal stays. (feat/ota owns v32 -> v33, so this rebuild moved up one.)
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class IntakeGoalsRemovalMigrationTest {
    private lateinit var context: Context
    private val databaseName = "intake-goals-removal-migration-test.db"

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(databaseName)
    }

    @After fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test fun `33 to 34 drops the intake goals and keeps goals and meals`() {
        val old = Room.databaseBuilder(context, GoalsV33Database::class.java, databaseName)
            .allowMainThreadQueries().build()
        try {
            val w = old.openHelper.writableDatabase
            w.execSQL(
                "INSERT INTO user_goals (id,steps,distanceMeters,calories,sleepMinutes,activeMinutes," +
                    "workoutsPerWeek,intakeCalories,intakeProteinG,intakeCarbsG,intakeFatG,nutritionEnabled,updatedAt) " +
                    "VALUES ('g1',7000,6000.0,450,420,30,3,2100.0,140.0,230.0,70.0,1,555)",
            )
            w.execSQL(
                "INSERT INTO meal_entries (id,date,timestamp,name,mealTypeRaw,calories,proteinG,carbsG,fatG," +
                    "sourceRaw,quantity,confidenceRaw,userEdited,loggedByCoach,createdAt,updatedAt) " +
                    "VALUES ('m1',1000,1100,'Soup','lunch',320,18,45,7,'manual',1,'known',0,0,1200,1200)",
            )
        } finally { old.close() }

        val migrated = Room.databaseBuilder(context, GoalsV34Database::class.java, databaseName)
            .addMigrations(PulseLoopDatabase.MIGRATION_33_34)
            .allowMainThreadQueries().build()
        try {
            val r = migrated.openHelper.writableDatabase
            r.query("SELECT steps, distanceMeters, calories, sleepMinutes, activeMinutes, workoutsPerWeek, updatedAt FROM user_goals WHERE id = 'g1'")
                .use { c ->
                    assertTrue(c.moveToFirst())
                    assertEquals(7000, c.getInt(0))
                    assertEquals(6000.0, c.getDouble(1), 0.0)
                    assertEquals(450, c.getInt(2))
                    assertEquals(420, c.getInt(3))
                    assertEquals(30, c.getInt(4))
                    assertEquals(3, c.getInt(5))
                    assertEquals(555L, c.getLong(6))
                }
            r.query("PRAGMA table_info(`user_goals`)").use { c ->
                val names = buildList { while (c.moveToNext()) add(c.getString(c.getColumnIndexOrThrow("name"))) }
                assertFalse(names.any { it.startsWith("intake") || it == "nutritionEnabled" })
            }
            r.query("SELECT name, calories FROM meal_entries WHERE id = 'm1'").use { c ->
                assertTrue(c.moveToFirst())
                assertEquals("Soup", c.getString(0))
                assertEquals(320.0, c.getDouble(1), 0.0)
            }
        } finally { migrated.close() }
    }

    @Test fun `33 to 34 leaves goals alone when there were no intake columns`() {
        val old = Room.databaseBuilder(context, GoalsV33NoIntakeDatabase::class.java, databaseName)
            .allowMainThreadQueries().build()
        try {
            old.openHelper.writableDatabase.execSQL(
                "INSERT INTO user_goals (id,steps,distanceMeters,calories,sleepMinutes,activeMinutes,workoutsPerWeek,updatedAt) " +
                    "VALUES ('g1',9000,7000.0,500,450,40,4,777)",
            )
        } finally { old.close() }
        val migrated = Room.databaseBuilder(context, GoalsV34Database::class.java, databaseName)
            .addMigrations(PulseLoopDatabase.MIGRATION_33_34)
            .allowMainThreadQueries().build()
        try {
            migrated.openHelper.writableDatabase.query("SELECT steps, updatedAt FROM user_goals WHERE id = 'g1'").use { c ->
                assertTrue(c.moveToFirst())
                assertEquals(9000, c.getInt(0))
                assertEquals(777L, c.getLong(1))
            }
        } finally { migrated.close() }
    }
}

/** `user_goals` as of v33, intake goals included. */
@Entity(tableName = "user_goals")
internal data class LegacyUserGoalV33(
    @PrimaryKey val id: String,
    val steps: Int,
    @ColumnInfo(defaultValue = "8000.0") val distanceMeters: Double,
    @ColumnInfo(defaultValue = "500") val calories: Int,
    val sleepMinutes: Int,
    val activeMinutes: Int,
    val workoutsPerWeek: Int,
    val intakeCalories: Double?,
    val intakeProteinG: Double?,
    val intakeCarbsG: Double?,
    val intakeFatG: Double?,
    val nutritionEnabled: Boolean,
    val updatedAt: Long,
)

@Database(entities = [LegacyUserGoalV33::class, MealEntryEntity::class], version = 33, exportSchema = false)
internal abstract class GoalsV33Database : RoomDatabase()

@Database(entities = [UserGoalEntity::class, MealEntryEntity::class], version = 34, exportSchema = false)
internal abstract class GoalsV34Database : RoomDatabase()

/** A v33 file that never had the intake columns (built from feat/ota's 2.7.4 without Nutrition's rebuild). */
@Database(entities = [UserGoalEntity::class, MealEntryEntity::class], version = 33, exportSchema = false)
internal abstract class GoalsV33NoIntakeDatabase : RoomDatabase()
