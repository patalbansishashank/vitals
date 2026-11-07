package com.pulseloop.data

import android.content.Context
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Room
import androidx.room.RoomDatabase
import com.pulseloop.data.entity.MealEntryEntity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Opens a real v27 Room file, applies the production migration, then validates the v28 schema. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class NutritionProvenanceMigrationTest {
    private lateinit var context: Context
    private val databaseName = "nutrition-provenance-migration-test.db"

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(databaseName)
    }

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun `27 to 28 retains meals and unrelated history with null provenance`() {
        val old = Room.databaseBuilder(context, NutritionV27Database::class.java, databaseName)
            .allowMainThreadQueries()
            .build()
        try {
            old.openHelper.writableDatabase.execSQL(
                """
                INSERT INTO meal_entries (
                    id,date,timestamp,name,mealTypeRaw,calories,proteinG,carbsG,fatG,
                    fiberG,sugarG,sodiumMg,sourceRaw,offProductCode,servingDescription,
                    servingGrams,quantity,confidenceRaw,userEdited,notes,loggedByCoach,
                    createdAt,updatedAt
                ) VALUES (
                    'meal-before-migration',1000,1100,'Soup','lunch',320,18,45,7,
                    12,NULL,680,'manual',NULL,NULL,NULL,1,'known',0,NULL,0,1200,1200
                )
                """.trimIndent(),
            )
            old.openHelper.writableDatabase.execSQL(
                "INSERT INTO migration_history_sentinel (id,payload) VALUES (1,'keep me')",
            )
        } finally {
            old.close()
        }

        val migrated = Room.databaseBuilder(context, NutritionV28Database::class.java, databaseName)
            .addMigrations(PulseLoopDatabase.MIGRATION_27_28)
            .allowMainThreadQueries()
            .build()
        try {
            migrated.openHelper.writableDatabase.query(
                "SELECT name, fiberG, sodiumMg, aiEstimateJson, aiProviderRaw, aiModel " +
                    "FROM meal_entries WHERE id = 'meal-before-migration'",
            ).use { cursor ->
                assertEquals(true, cursor.moveToFirst())
                assertEquals("Soup", cursor.getString(0))
                assertEquals(12.0, cursor.getDouble(1), 0.0)
                assertEquals(680.0, cursor.getDouble(2), 0.0)
                assertNull(cursor.getString(3))
                assertNull(cursor.getString(4))
                assertNull(cursor.getString(5))
            }
            migrated.openHelper.writableDatabase.query(
                "SELECT payload FROM migration_history_sentinel WHERE id = 1",
            ).use { cursor ->
                assertEquals(true, cursor.moveToFirst())
                assertEquals("keep me", cursor.getString(0))
            }
        } finally {
            migrated.close()
        }
    }
}

@Entity(tableName = "meal_entries", indices = [Index("date")])
internal data class LegacyMealEntryV27(
    @PrimaryKey val id: String,
    val date: Long,
    val timestamp: Long,
    val name: String,
    val mealTypeRaw: String,
    val calories: Double,
    val proteinG: Double,
    val carbsG: Double,
    val fatG: Double,
    val fiberG: Double?,
    val sugarG: Double?,
    val sodiumMg: Double?,
    val sourceRaw: String,
    val offProductCode: String?,
    val servingDescription: String?,
    val servingGrams: Double?,
    val quantity: Double,
    val confidenceRaw: String,
    val userEdited: Boolean,
    val notes: String?,
    val loggedByCoach: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(tableName = "migration_history_sentinel")
internal data class MigrationHistorySentinel(
    @PrimaryKey val id: Long,
    val payload: String,
)

@Database(
    entities = [LegacyMealEntryV27::class, MigrationHistorySentinel::class],
    version = 27,
    exportSchema = false,
)
internal abstract class NutritionV27Database : RoomDatabase()

@Database(
    entities = [MealEntryEntity::class, MigrationHistorySentinel::class],
    version = 28,
    exportSchema = false,
)
internal abstract class NutritionV28Database : RoomDatabase()
