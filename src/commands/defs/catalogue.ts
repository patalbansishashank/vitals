/**
 * `catalogue.*`, `food.*`, `train.*` (SUITE_SPEC §1.9, §8): ids, classes and inputs fixed here. The `catalogue.*` and
 * `train.*` executors and `food.dayTargets` are in `../catalogue` (I1-C, over E8's `src/catalogues`); the other `food.*`
 * commands stay stubs until the food reference and recipes land (E8 data task, E9b).
 */
import { T } from '../schema';
import { defineCommand, getCommand } from '../registry';
import { UNDO, stub } from './_shared';

const OWNER = 'E8 (catalogues)';
const LocalDate = T.Date();
const Id = T.String({ minLength: 1, maxLength: 64 });
const Search = T.Object({ q: T.Optional(T.String({ maxLength: 200 })), limit: T.Optional(T.Integer({ minimum: 1, maximum: 50 })), filters: T.Optional(T.OpenObject()) });
const list = T.Array(T.OpenObject());
const Num = T.Number();
const Str = T.String();
const Strs = T.Array(T.String());
const NumMap = T.Record(T.Number());
const Band = T.Enum(['full', 'partial', 'different'] as const);

/** One exercise as search results and reads show it (the full record is in `catalogue.getExercise`). */
const ExerciseView = T.Object({
  id: Str,
  name: Str,
  aliases: Strs,
  tradition: Str,
  pattern: Str,
  regions: NumMap,
  equipmentAnyOf: T.Array(Strs),
  loadType: Str,
  intensityScale: Str,
  volumeUnit: Str,
  defaultDose: NumMap,
  metGross: Num,
  cardioModality: T.Nullable(Str),
  skill: T.Integer(),
  injuryRisk: T.Integer(),
  contraTags: Strs,
  tags: Strs,
  status: Str,
  certainty: Str,
  origin: Str,
  /** The person added it. */
  own: T.Boolean(),
  /** The person has (or can reach) the equipment for it. */
  available: T.Boolean(),
  /** Not refused, no uncleared injury, within their skill. */
  willing: T.Boolean(),
});

const EquipmentView = T.Object({
  id: Str,
  name: Str,
  aliases: Strs,
  category: Str,
  ownershipKind: Str,
  loadRangeKg: T.Nullable(T.Array(Num)),
  adjustable: T.Boolean(),
  enablesPatterns: Strs,
  priceTier: T.Integer(),
  space: Str,
  note: Str,
  origin: Str,
  own: T.Boolean(),
  /** In the person's setup (owned, or at a place they train). */
  owned: T.Boolean(),
});

const Shortfall = T.Object({ term: Str, missing: Num, text: Str });
const equivalenceFields = {
  score: Num,
  credit: Num,
  parity: T.Boolean(),
  band: Band,
  perTerm: T.Array(T.Object({ term: Str, ratio: Num, weight: Num })),
  shortfall: T.Array(Shortfall),
  alsoTrained: Strs,
};

const Alternative = T.Object({
  exerciseId: Str,
  name: Str,
  equipment: Strs,
  minutes: Num,
  credit: Num,
  score: Num,
  band: Band,
  parity: T.Boolean(),
  shortfall: Strs,
  /** What to log when done like this (a `PerformedExercise`). */
  perf: T.OpenObject(),
});

const Item = T.Object({
  exerciseId: Str,
  name: Str,
  equipment: Strs,
  sets: T.Optional(Num),
  reps: T.Optional(Num),
  holdSec: T.Optional(Num),
  workSec: T.Optional(Num),
  minutes: Num,
  loadKg: T.Optional(Num),
  loadPct: T.Optional(Num),
  met: T.Optional(Num),
  rir: T.Optional(Num),
  restSec: T.Optional(Num),
  kcal: Num,
  /** One-line prescription in plain words. */
  text: Str,
  /** What to log when done as planned (a `PerformedExercise`). */
  perf: T.OpenObject(),
});

const SessionView = T.Object({
  slotKey: Str,
  kind: T.Enum(['resistance', 'cardio'] as const),
  startH: Num,
  minutes: Num,
  /** The plan carried no composed session; it was composed now from the person's equipment. */
  composedHere: T.Boolean(),
  items: T.Array(Item),
  kcal: Num,
  withinTolerance: T.Boolean(),
  credit: Num,
  band: Band,
  shortfall: Strs,
  purchasesUsed: Strs,
});

const ShoppingItem = T.Object({
  equipmentId: Str,
  equipmentIds: Strs,
  name: Str,
  priceTier: Num,
  required: T.Boolean(),
  unlocks: Strs,
  deltaUtility: Num,
  score: Num,
  withinAllowance: T.Boolean(),
  benefit: T.Array(T.Object({ goal: Num, delta: Num, unit: Str })),
  text: Str,
});

const Added = T.Object({ id: Str, name: Str, created: T.Boolean() });

stub({ id: 'catalogue.searchExercises', title: 'Search exercises', description: 'Find exercises by name (local names included), with optional filters: pattern, tradition, region, equipment, loadType, origin, available (true: only what the person can do with their equipment).', input: Search, output: T.Array(ExerciseView), perm: 'read', owner: OWNER });
stub({
  id: 'catalogue.getExercise',
  title: 'Read an exercise',
  description: 'One exercise with its stimulus, equipment and alternatives.',
  input: T.Object({ id: Id }),
  output: T.Object({
    exercise: ExerciseView,
    mechanism: Str,
    energy: T.OpenObject(),
    evidence: T.OpenObject(),
    equipment: T.Array(EquipmentView),
    dose: T.Object({ sets: Num, minutes: Num, netKcal: Num, mem: Num, effectiveSetsByRegion: NumMap }),
    alternatives: T.Array(Alternative),
  }),
  perm: 'read',
  owner: OWNER,
});
stub({ id: 'catalogue.searchFoods', title: 'Search foods', description: 'Find foods by name (local names included), with nutrients per 100 g.', input: Search, output: list, perm: 'read', owner: OWNER });
stub({ id: 'catalogue.getFood', title: 'Read a food', description: 'One food with nutrients per 100 g and portions.', input: T.Object({ id: Id }), output: T.OpenObject(), perm: 'read', owner: OWNER });
stub({ id: 'catalogue.supplements', title: 'Supplements', description: 'Supplements with their evidence label and whether they serve the person’s goals.', input: T.Object({ q: T.Optional(T.String()) }), output: list, perm: 'read', owner: OWNER });
stub({ id: 'catalogue.equipment', title: 'Equipment', description: 'Training equipment the catalogue knows, and whether the person has it.', input: T.Object({ q: T.Optional(T.String()) }), output: T.Array(EquipmentView), perm: 'read', owner: OWNER });
stub({ id: 'catalogue.addExercise', title: 'Add an exercise', description: 'Add a custom exercise with its stimulus.', input: T.Object({ exercise: T.OpenObject() }), output: Added, perm: 'write', impact: 'low', undo: UNDO.TS, idempotency: 'key', owner: OWNER });
stub({ id: 'catalogue.addFood', title: 'Add a food', description: 'Add a custom food with nutrients per 100 g (from a label or the person).', input: T.Object({ food: T.OpenObject() }), output: Added, perm: 'write', impact: 'low', undo: UNDO.TS, idempotency: 'key', owner: OWNER });
stub({ id: 'catalogue.addEquipment', title: 'Add equipment', description: 'Add custom training equipment.', input: T.Object({ equipment: T.OpenObject() }), output: Added, perm: 'write', impact: 'low', undo: UNDO.TS, idempotency: 'key', owner: OWNER });
stub({ id: 'catalogue.equivalence', title: 'Stimulus equivalence', description: 'How close performed exercises come to a prescribed stimulus.', input: T.Object({ prescribed: T.OpenObject(), performed: T.Array(T.OpenObject()) }), output: T.Object({ ...equivalenceFields, /** Performed items that named no catalogue exercise (free text). */ unresolved: Strs }), perm: 'read', owner: OWNER });

stub({ id: 'food.dayTargets', title: 'Meal targets', description: 'Energy and macro targets per meal for a date.', input: T.Object({ date: LocalDate }), output: list, perm: 'read', owner: OWNER });
stub({ id: 'food.recipes', title: 'Recipes', description: 'Saved and suggested recipes.', input: T.Object({ q: T.Optional(T.String()) }), output: list, perm: 'read', owner: OWNER });
stub({ id: 'food.groceryList', title: 'Grocery list', description: 'A grocery list for a date range of planned meals.', input: T.Object({ from: LocalDate, to: T.Optional(LocalDate) }), perm: 'read', owner: OWNER });
stub({ id: 'food.parse', title: 'Parse a meal description', description: 'Turn a typed meal description into components with estimated grams (catalogue parser, no AI).', input: T.Object({ text: T.String({ minLength: 1, maxLength: 2000 }) }), perm: 'read', owner: OWNER });
stub({ id: 'food.candidates', title: 'Allowed foods', description: 'Foods allowed for a date and meal slot (diet, allergies, day rules, kitchen).', input: T.Object({ date: LocalDate, slot: T.Optional(T.String()) }), output: list, perm: 'read', owner: OWNER });
stub({ id: 'food.planDay', title: 'Plan a day’s meals', description: 'Propose a day’s meals as food ids with raw grams; the app fits portions to the targets and saves the meal plan.', input: T.Object({ date: LocalDate, meals: T.Array(T.OpenObject(), { minItems: 1, maxItems: 8 }) }), perm: 'write', impact: 'low', undo: UNDO.IP, idempotency: 'key', owner: OWNER });
stub({ id: 'food.saveRecipe', title: 'Save a recipe', description: 'Save a recipe (ingredients with grams, servings).', input: T.Object({ recipe: T.OpenObject() }), output: T.Object({ id: T.String() }), perm: 'write', impact: 'low', undo: UNDO.TS, idempotency: 'key', owner: OWNER });
stub({ id: 'food.deleteRecipe', title: 'Delete a recipe', description: 'Delete a saved recipe (restorable).', input: T.Object({ id: Id }), output: T.Object({ id: T.String() }), perm: 'write', impact: 'low', undo: UNDO.TS, idempotency: 'key', owner: OWNER });

stub({
  id: 'train.session',
  title: 'Training session',
  description: 'The session prescribed for a date, exercise by exercise.',
  input: T.Object({ date: LocalDate }),
  output: T.Object({
    date: Str,
    planId: T.Nullable(Str),
    /** A plan day with no session. */
    rest: T.Boolean(),
    sessions: T.Array(SessionView),
    /** The person has told the app what equipment they have (else sessions are bodyweight). */
    equipmentAnswered: T.Boolean(),
    /** Typed equipment no catalogue item matches yet. */
    unresolvedEquipment: Strs,
  }),
  perm: 'read',
  owner: OWNER,
});
stub({ id: 'train.alternatives', title: 'Exercise alternatives', description: 'Alternatives to an exercise that keep the stimulus, given the equipment.', input: T.Object({ exerciseId: Id, date: T.Optional(LocalDate) }), output: T.Array(Alternative), perm: 'read', owner: OWNER });
stub({ id: 'train.shoppingList', title: 'Equipment shopping list', description: 'Equipment a plan needs that the person does not own yet.', input: T.Object({ planId: T.Optional(Id), kind: T.Optional(T.String({ minLength: 1 })) }, { description: 'Exactly one of planId or kind.' }), output: T.Array(ShoppingItem), perm: 'read', owner: OWNER });

/** A screen calls these: drop the "no screen calls it yet" reason (the intake's training chapter adds typed equipment). */
function onScreen(...ids: string[]): void {
  for (const id of ids) {
    const d = getCommand(id);
    if (!d?.excludedReason?.ui) continue;
    const { ui: _ui, ...rest } = d.excludedReason;
    void _ui;
    defineCommand({ ...d, excludedReason: rest });
  }
}
onScreen('catalogue.addEquipment');
