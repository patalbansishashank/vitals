/**
 * The collections of SUITE_SPEC §2.3 with their merge-rule metadata (strategy, sync, order), id rules, schema version,
 * per-collection migration hook and a lightweight runtime validator (JSON Schema checked by the interpreter in
 * `@/commands/schema`; open objects where another package owns the fields — that package's sanitiser runs on top).
 */
import { T, Value, type JsonSchema, type ValueError } from '@/commands/schema';
import type { CollectionId, CollectionPolicy, MergeStrategy } from './types';

export interface CollectionDef extends CollectionPolicy {
  /** Key rule of the table ("me", ULID, `day:${date}` …). */
  key: string;
  idPattern?: RegExp;
  /** Current `_schema` of the body. */
  schemaVersion: number;
  /** Body shape (validated on every write in dev/test, logged in production). */
  schema: JsonSchema;
  /** Package that owns the documents (for messages and the docs). */
  owner: string;
  /** Rough budget per year from the table (documentation; `estimate()` reports actual use). */
  budget?: string;
  /** In exports (SUITE_SPEC §2.8). */
  exported: boolean;
  /** Migrate a body from an older `_schema` (runs on read). */
  migrate?: (body: Record<string, unknown>, fromSchema: number) => Record<string, unknown>;
  /** Encrypt bodies at rest through the store's `Encryptor` hook. */
  sealed?: boolean;
}

const ME = /^me$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DATE = '\\d{4}-\\d{2}-\\d{2}';

const open = (required: readonly string[] = [], props: Record<string, JsonSchema> = {}): JsonSchema => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: true,
});

const str = T.String();
const num = T.Number();

function def(
  col: CollectionId,
  strategy: MergeStrategy,
  sync: CollectionPolicy['sync'],
  order: number,
  rest: Omit<CollectionDef, 'col' | 'strategy' | 'sync' | 'order' | 'schemaVersion' | 'exported'> & { schemaVersion?: number; exported?: boolean },
): CollectionDef {
  const exported = rest.exported ?? (sync !== 'no' || col === 'deviceSettings' || col === 'uiPrefs');
  return { col, strategy, sync, order, schemaVersion: 1, ...rest, exported };
}

export const COLLECTIONS: Readonly<Record<CollectionId, CollectionDef>> = {
  profile: def('profile', 'lwwField', 'yes', 10, {
    key: 'me',
    idPattern: ME,
    owner: 'profile',
    budget: '10 KB',
    // v2 (figure model): the migration hook (`migrateProfileDocBody`) is injected by `src/state/runtime.ts` (`STATE_MIGRATIONS`),
    // because the store must not import the state layer.
    schemaVersion: 2,
    schema: open(['shape', 'waist', 'knownBodyFat', 'training', 'habits', 'cycle', 'labs'], {
      shape: T.OpenObject(),
      habits: T.OpenObject(),
      labs: T.Record(num),
      revision: T.Integer({ minimum: 0 }),
    }),
  }),
  intake: def('intake', 'lwwField', 'yes', 11, {
    key: 'me',
    idPattern: ME,
    owner: 'intake (E7)',
    budget: '40 KB',
    schema: open(['answeredAt', 'questionSetVersion'], { answeredAt: T.Record(str), questionSetVersion: T.Record(num) }),
  }),
  safety: def('safety', 'lwwField', 'yes', 12, {
    key: 'me',
    idPattern: ME,
    owner: 'safety',
    budget: '5 KB',
    schema: open(['acknowledgements', 'dangerAcks'], { acknowledgements: T.OpenObject(), dangerAcks: T.OpenObject(), pendingReview: T.Boolean() }),
  }),
  goals: def('goals', 'lwwField', 'yes', 13, {
    key: 'me',
    idPattern: ME,
    owner: 'planner goals',
    budget: '5 KB',
    schema: open(['goals', 'horizonDays', 'constraints', 'strictness'], {
      goals: T.Array(T.OpenObject()),
      horizonDays: T.Integer({ minimum: 1 }),
      constraints: T.OpenObject(),
      strictness: T.Enum(['strict', 'balanced', 'flexible']),
    }),
  }),
  // E20: blood markers (`vitals.markers/1`, SUITE_SPEC §13.5); history is kept as `lab:<markerId>` APP entries in `measurements`
  markers: def('markers', 'lwwField', 'yes', 14, {
    key: 'me',
    idPattern: ME,
    owner: 'blood markers (E20)',
    budget: '20 KB',
    schema: open(['readings', 'displayOnly', 'context', 'chapter'], {
      readings: T.Array(T.OpenObject()),
      displayOnly: T.Array(T.OpenObject()),
      context: T.OpenObject(),
      chapter: T.Nullable(T.Enum(['skipped', 'manual', 'report'])),
    }),
  }),
  scenarios: def('scenarios', 'lwwField', 'yes', 20, {
    key: 'scenario id',
    idPattern: /^[A-Za-z0-9_-]{1,40}$/,
    owner: 'simulator',
    budget: '≤ 60 KB each, cap 50',
    schemaVersion: 2,
    schema: open(['name', 'schedule', 'started'], { name: str, schedule: open(['startDate', 'horizonDays', 'programs', 'days']), started: T.Boolean() }),
  }),
  plans: def('plans', 'lwwField', 'yes', 30, { key: 'Id', idPattern: ULID, owner: 'living plan (E5)', budget: '5 KB each', schema: open(['status', 'startDate']) }),
  planVersions: def('planVersions', 'immutable', 'yes', 31, {
    key: '${planId}:v${n}',
    idPattern: /^[0-9A-HJKMNP-TV-Z]{26}:v\d+$/,
    owner: 'living plan (E5)',
    budget: '≤ 90 KB each',
    schema: open(['planId', 'version', 'status', 'schedule']),
  }),
  activePlan: def('activePlan', 'lwwField', 'yes', 32, {
    key: 'me',
    idPattern: ME,
    owner: 'living plan (E5)',
    schema: open(['planId', 'since'], { planId: T.Nullable(str), since: str }),
  }),
  dailyLogs: def('dailyLogs', 'append', 'yes', 40, {
    key: 'Id',
    idPattern: ULID,
    owner: 'daily log (E5)',
    budget: '≈ 2 MB',
    schema: open(['date', 'kind', 'source'], { date: T.Date(), kind: str }),
  }),
  dayStatus: def('dayStatus', 'lwwField', 'yes', 41, {
    key: 'day:${LocalDate}',
    idPattern: new RegExp(`^day:${DATE}$`),
    owner: 'daily log (E5)',
    budget: '≈ 0.5 MB',
    schema: open(['date'], { date: T.Date() }),
  }),
  measurements: def('measurements', 'append', 'yes', 42, {
    key: 'Id',
    idPattern: ULID,
    owner: 'daily log (E5)',
    budget: '< 0.2 MB',
    schema: open(['date', 'metric', 'value', 'source'], { date: T.Date(), metric: str, value: num }),
  }),
  anchors: def('anchors', 'immutable', 'yes', 43, {
    key: '${planId}:${LocalDate}',
    idPattern: new RegExp(`^[0-9A-HJKMNP-TV-Z]{26}:${DATE}$`),
    owner: 'living plan (E5)',
    budget: '< 0.1 MB',
    schema: open(),
  }),
  bioRecords: def('bioRecords', 'immutable', 'yes', 50, { key: '${record_id}@${version}', idPattern: /^.+@\d+$/, owner: 'biometrics (E10)', budget: '≈ 1.5 MB', schema: open() }),
  bioChunks: def('bioChunks', 'blob', 'yes', 51, { key: 'chunkId', owner: 'biometrics (E10)', budget: 'manifest < 1 MB', schema: open() }),
  bioSources: def('bioSources', 'lwwField', 'yes', 52, { key: 'sourceKey', owner: 'biometrics (E10)', schema: open() }),
  bioScores: def('bioScores', 'derived', 'no', 53, { key: '${scoreId}@${version}|${scope}', owner: 'biometrics (E10)', budget: '≈ 1 MB', schema: open(), exported: false }),
  bioCorrections: def('bioCorrections', 'lwwField', 'yes', 55, { key: 'correction key (sleep:<date>, daily:<date>:<group>, spot:<date>:<metric>[:<at>])', idPattern: /^(sleep|daily|spot):\d{4}-\d{2}-\d{2}(:.+)?$/, owner: 'biometrics (E28)', budget: '< 0.1 MB', schema: open(['correctionId', 'key', 'target', 'value', 'createdAt', 'actor']) }),
  decisionLog: def('decisionLog', 'append', 'yes', 54, { key: 'Id', idPattern: ULID, owner: 'biometrics (E10)', budget: '< 0.5 MB', schema: open(['at', 'decision']) }),
  conversations: def('conversations', 'lwwField', 'yes', 60, { key: 'Id', idPattern: ULID, owner: 'coach (E9)', schema: open() }),
  messages: def('messages', 'append', 'yes', 61, { key: 'Id', idPattern: ULID, owner: 'coach (E9)', budget: '≈ 15 MB', schema: open(['conversationId', 'at']) }),
  attachments: def('attachments', 'blob', 'optIn', 62, { key: 'Id', idPattern: ULID, owner: 'coach (E9)', schema: open(['mime', 'sha256', 'purpose']) }),
  catalogueCustom: def('catalogueCustom', 'lwwField', 'yes', 70, { key: 'Id', idPattern: ULID, owner: 'catalogues (E8)', budget: '< 1 MB', schema: open() }),
  recipes: def('recipes', 'lwwField', 'yes', 71, { key: 'Id', idPattern: ULID, owner: 'catalogues (E8)', budget: '< 3 MB', schema: open() }),
  // SUITE_SPEC §13.3 (E17): `vitals.kitchen/1` and `vitals.pantry/1`, key `me`, LWW-F
  kitchen: def('kitchen', 'lwwField', 'yes', 73, { key: 'me', idPattern: ME, owner: 'kitchen (E17)', budget: '< 50 KB', schema: open(['equipment', 'cuisines', 'staples'], { equipment: T.Array(T.OpenObject()), cuisines: T.Array(T.OpenObject()), staples: T.Array(T.OpenObject()) }) }),
  pantry: def('pantry', 'lwwField', 'yes', 74, { key: 'me', idPattern: ME, owner: 'kitchen (E17)', budget: '< 100 KB', schema: open(['items'], { items: T.Array(T.OpenObject()) }) }),
  mealPlans: def('mealPlans', 'lwwField', 'yes', 72, { key: '${LocalDate}', idPattern: new RegExp(`^${DATE}$`), owner: 'catalogues (E8)', schema: open() }),
  settings: def('settings', 'lwwField', 'yes', 1, {
    key: 'me',
    idPattern: ME,
    owner: 'settings',
    schema: open([], { units: T.Enum(['metric', 'imperial']), energyUnit: T.Enum(['kcal', 'kJ']), glucoseUnit: T.Enum(['mmol', 'mgdl']) }),
  }),
  devices: def('devices', 'lwwField', 'yes', 2, { key: 'DeviceId', idPattern: /^[0-9A-HJKMNP-TV-Z]{16}$/, owner: 'sync (E11)', schema: open(['name', 'platform', 'lastSeen']) }),
  pendingChanges: def('pendingChanges', 'lwwField', 'yes', 80, {
    key: 'Id',
    idPattern: ULID,
    owner: 'commands',
    budget: '30-day retention',
    schema: open(['commandId', 'actor', 'createdAt', 'expiresAt', 'status']),
    exported: false,
  }),
  providerKeys: def('providerKeys', 'lwwField', 'optIn', 81, { key: 'presetId', owner: 'AI (E9)', schema: open(), exported: false, sealed: true }),
  deviceSettings: def('deviceSettings', 'local', 'no', 3, {
    key: 'me',
    idPattern: ME,
    owner: 'settings',
    schema: open([], { theme: T.Enum(['system', 'light', 'dark']), reduceMotion: T.Enum(['system', 'on', 'off']) }),
  }),
  uiPrefs: def('uiPrefs', 'local', 'no', 4, { key: 'me', idPattern: ME, owner: 'app shell', schema: open() }),
  secrets: def('secrets', 'local', 'no', 90, { key: 'presetId | companion | bleCred:${driver}', owner: 'AI / biometrics', schema: open(), exported: false, sealed: true }),
  changeLog: def('changeLog', 'local', 'no', 91, {
    key: 'Id',
    idPattern: ULID,
    owner: 'commands',
    budget: '30-day retention',
    schema: open(['commandId', 'actor', 'at', 'ops']),
    exported: false,
  }),
  commandLedger: def('commandLedger', 'local', 'no', 92, { key: 'commandId|idempotencyKey', owner: 'commands', schema: open(['commandId', 'at', 'result']), exported: false }),
  jobs: def('jobs', 'local', 'no', 93, { key: 'Id', owner: 'commands', schema: open(['kind', 'state']), exported: false }),
  aiUsage: def('aiUsage', 'local', 'no', 94, { key: 'Id', owner: 'AI (E9)', budget: '400 days', schema: open(), exported: false }),
  derived: def('derived', 'derived', 'no', 95, { key: '${kind}:${key}', idPattern: /^[A-Za-z]+:.+$/, owner: 'projections', budget: '≤ 20 MB LRU', schema: open(), exported: false }),
  syncState: def('syncState', 'local', 'no', 96, { key: 'me', owner: 'sync', schema: open(), exported: false }),
};

export function collectionDef(col: CollectionId): CollectionDef {
  return COLLECTIONS[col];
}

/** Collections in hydration / copy order. */
export function orderedCollections(): CollectionDef[] {
  return Object.values(COLLECTIONS).sort((a, b) => a.order - b.order);
}

/** Collections an export v2 carries (synced ones plus `deviceSettings` and `uiPrefs`, SUITE_SPEC §2.8). */
export function exportedCollections(): CollectionId[] {
  return orderedCollections()
    .filter((c) => c.exported)
    .map((c) => c.col);
}

/** Validate a document body and id against its collection. Empty array = valid. */
export function validateDoc(col: CollectionId, id: string, body: unknown): ValueError[] {
  const d = COLLECTIONS[col];
  const errors: ValueError[] = [];
  if (d.idPattern && !d.idPattern.test(id)) errors.push({ path: '/_id', message: `"${id}" is not a valid ${col} key (${d.key})` });
  for (const e of Value.Errors(d.schema, body, 5)) errors.push(e);
  return errors;
}
