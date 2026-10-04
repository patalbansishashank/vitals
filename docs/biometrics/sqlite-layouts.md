# SQLite layouts read by the Health Connect and Gadgetbridge importers

Code: `src/biometrics/importers/{sqlite,healthConnect,gadgetbridge,zipReader}.ts`.
Status keys: VERIFIED = constant read in AOSP source 2026-10-01 (packages/modules/HealthFitness, `storage/datatypehelpers/*Helper.java`); ASSUMED = not verified, mapped defensively.

## Input paths (no WebAssembly in the current CSP)

1. JSON table dump (always works): `{ "tables": { "<table>": [ {col: value}, ... ] } }`, BLOBs as hex. Make it with
   `python3 -c "import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;t=[r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")];print(json.dumps({'tables':{x:[{k:(v.hex() if isinstance(v,bytes) else v) for k,v in dict(r).items()} for r in c.execute(f'select * from \"{x}\"')] for x in t}}))" health_connect_export.db > dump.json`
2. SQLite file or a ZIP containing `*.db`/`*.json` (the Health Connect export is such a zip): needs an injected `SqlOpener` (`createHealthConnectImporter({ openSqlite })`). Without one, `run()` throws `SqliteUnavailableError` telling the user to use the JSON path. Importers only issue `SELECT * FROM <table>` (via `rows()`), so the JSON dump and a real engine behave identically.

## Health Connect

Times: epoch milliseconds (VERIFIED, InstantRecordHelper); zone offsets seconds (VERIFIED). `row_id`, `uuid` (BLOB; hex), `app_info_id`, `device_info_id`, `recording_method`, `last_modified_time`, `client_record_id` VERIFIED (RecordHelper).
`local_date` columns exist but are unused; local date is computed from time + zone offset (falls back to the import time zone when null).

| Table | Columns used | Status | Canonical |
|---|---|---|---|
| application_info_table | row_id, package_name, app_name | VERIFIED (row_id ASSUMED as the key) | provenance.source_app |
| device_info_table | row_id, manufacturer, model, device_type | VERIFIED | provenance.device |
| heart_rate_record_table + heart_rate_record_series_table | start_time, end_time, start_zone_offset; child: parent_key, beats_per_minute, epoch_millis | VERIFIED names; child link column parent_key VERIFIED (SeriesRecordHelper) | series `hr` (bpm outside 20..300 dropped) |
| skin_temperature_record_table + skin_temperature_delta_table | baseline, measurement_location; child: parent_key, delta, epoch_millis | VERIFIED | series `skin_temp`, unit `degC_delta` |
| oxygen_saturation_record_table | time, zone_offset, percentage | VERIFIED | series `spo2` per app/device/day |
| respiratory_rate_record_table | rate | VERIFIED | series `resp_rate` |
| body_temperature_record_table | temperature, measurement_location | VERIFIED | Lumen app: series `skin_temp` (degC) with `vendor_state=skin_temp_stored_as_body_temperature`, decoder `health_connect/lumen_body_temp_as_skin@1`; other apps: spot `body_temp_c` |
| steps_record_table | count | VERIFIED | daily.steps (summed per app/device/day) |
| distance_record_table | distance | VERIFIED; unit ASSUMED metres | daily.distance_m |
| active/total_calories_burned_record_table | energy | VERIFIED; unit ASSUMED calories (cal), divided by 1000 (`energyUnit: 'kcal'` overrides) | daily.active_kcal / total_kcal |
| resting_heart_rate_record_table | beats_per_minute | VERIFIED | daily.resting_hr_bpm (day mean) |
| heart_rate_variability_rmssd_record_table | heart_rate_variability_millis | VERIFIED | daily.hrv rmssd, window `spot` |
| vo2_max_record_table | vo2_milliliters_per_minute_kilogram, measurement_method | VERIFIED | daily.vo2max (1 lab, 3..5 field_test, 2 derived, else vendor_estimate) |
| weight_record_table | weight | VERIFIED name; unit ASSUMED grams (values > 1000 read as grams, else kg) | spot weight_kg |
| body_fat_record_table | percentage | VERIFIED | spot body_fat_pct |
| sleep_session_record_table | start_time, end_time, start/end_zone_offset, title, notes | VERIFIED | sleep |
| sleep_stages_table | parent_id (or parent_key), stage_start_time, stage_end_time, stage_type | VERIFIED (parent_id per source; parent_key also accepted) | sleep.stages |
| exercise_session_record_table | exercise_type, title, notes | VERIFIED | workout (elapsed time; pauses/segments not read) |

Not read: exercise segment/lap/route tables, planned sessions, blood pressure/glucose, nutrition, `weight`/`energy` unit confirmation, and any other table.
Whether the Android 16 export file name is exactly `health_connect_export.db` is ASSUMED; the importer takes the first `*.db` (else `*.json`) in the zip.

Stage ints (public API): 0 unknown, 1 awake, 2 sleeping (asleep_unspecified), 3 out_of_bed, 4 light, 5 deep, 6 rem, 7 awake_in_bed. recording_method ints: 0 unknown, 1 active, 2 automatic, 3 manual (manual -> modality self_reported). Device type ints: 1 watch, 2 phone, 3 scale, 4 ring, 6 band, 7 strap (others -> manual). Exercise type table: `HC_EXERCISE_TYPES` (public API constants, written from memory of the documented list; unlisted -> `other:<n>`).

Device tier heuristic (PROPOSED): chest strap A; ring/watch/band/scale B; phone/unknown C. Sleep stages carry flag `provisional_stages`. Main sleep = longest session per wake date.

Record ids (idempotent re-import): `recordId(source 'health_connect', native_id)` with native ids `<metric>:<uuid>` for per-record series/sleep/workout/spot, and `<metric>|<app>|<appId>|<devId>|<method>|<date>` / `daily|<app>|<appId>|<devId>|<date>` for grouped records. Grouped records use `version` = number of contributing samples/rows (grows monotonically as a re-export adds data).

## Gadgetbridge (`Gadgetbridge.db`)

Names come from the public greenDAO entity definitions (GBDaoGenerator); table = UPPER_SNAKE of the entity, column = UPPER_SNAKE of the property. Column lookup is case-insensitive. No code is reused (AGPL).

| Table | Columns | Status |
|---|---|---|
| DEVICE | _id, NAME, MANUFACTURER, IDENTIFIER (unique), TYPE, TYPE_NAME, MODEL, ALIAS | VERIFIED (generator); `_id` as the greenDAO key ASSUMED |
| *_ACTIVITY_SAMPLE (generic, includes COLMI_ACTIVITY_SAMPLE) | TIMESTAMP (int, **seconds**), DEVICE_ID, USER_ID, STEPS, HEART_RATE, RAW_KIND, RAW_INTENSITY | common props VERIFIED; Colmi: RAW_KIND, STEPS, HEART_RATE VERIFIED; RAW_INTENSITY ASSUMED (not imported) |
| COLMI_HEART_RATE_SAMPLE | TIMESTAMP, DEVICE_ID, USER_ID, HEART_RATE | property VERIFIED; TIMESTAMP unit ASSUMED |
| COLMI_SPO2_SAMPLE | SPO2 | property VERIFIED |
| COLMI_STRESS_SAMPLE | STRESS | property VERIFIED -> series `vendor:stress` (vendor opinion only) |
| COLMI_HRV_VALUE_SAMPLE | VALUE | property VERIFIED -> series `hrv`, flag `hrv_vendor_defined` |
| COLMI_SLEEP_STAGE_SAMPLE | TIMESTAMP, DURATION, STAGE | properties VERIFIED; DURATION unit ASSUMED minutes; TIMESTAMP ASSUMED = stage start; STAGE codes ASSUMED 1 light, 2 deep, 3 rem, 4 awake, 0 unknown |
| COLMI_SLEEP_SESSION_SAMPLE | WAKEUP_TIME | property VERIFIED; not used (sessions are rebuilt from contiguous stage rows, gap > 30 min splits, PROPOSED) |
| COLMI_TEMPERATURE_SAMPLE | TEMPERATURE (degC) | table not found in the generator read: ASSUMED; imported if present as `skin_temp` |
| COLMI_HRV_SUMMARY_SAMPLE | weekly/last-night summaries | VERIFIED, not imported |

Timestamp unit: activity samples are epoch seconds; for other sample tables the importer treats values >= 1e11 as milliseconds, else seconds (ASSUMED, so either works). HR 0, 255, -1 or outside 20..250 is "not measured" and dropped; steps <= 0 dropped (-1 = not measured). Same timestamp from two tables is merged into one sample. Channel `file:gadgetbridge`, source_app `gadgetbridge`, all devices tier C, decoder `gadgetbridge/colmi@1` or `gadgetbridge/generic_activity@1`. Device type ring when the name/type name looks like a ring (R02, "ring"), else band.
