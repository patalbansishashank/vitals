/** Test seeds for the food executors: a running plan (2000 kcal, 150 g protein, 200 g carbohydrate) and intake answers. */
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';

export const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };

export async function seedPlan(day: { kcal?: number; proteinG?: number; carbG?: number; label?: string } = {}): Promise<void> {
  const plan = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanDoc;
  const program = {
    id: 'A', label: day.label ?? 'day', energy: { kind: 'kcal' as const, kcal: day.kcal ?? 2000 },
    macros: { protein: { unit: 'g' as const, value: day.proteinG ?? 150 }, carbs: { unit: 'g' as const, value: day.carbG ?? 200 }, fat: { unit: 'remainder' as const } }, steps: 8000,
  };
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [program], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanVersionDoc;
  await seed(async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
  });
}

const VEG_DIET = {
  rulesComplete: true,
  animalFoods: { meat: 'none', chicken: false, mutton: false, beef: false, pork: false, fish: false, shellfish: false, eggs: 'none', dairy: 'yes', honey: true },
  dayRules: [], periodRules: [], noOnionGarlic: false, halal: false, kosher: false, allergies: [], allergiesOther: [], allergyStrict: false,
  intolerances: [], medicalDiet: [], dislikes: [], cuisines: ['north_indian'], staples: { grain: [], fat: [] }, whoCooks: 'self', familyFoodMode: false,
  timeBudgetMin: { weekdayBreakfast: 10, weekdayLunch: 20, weekdayDinner: 30, weekend: 45 },
};

export async function seedIntake(o: { diet?: Record<string, unknown>; stance?: 'open' | 'food_first'; pantry?: string[] } = {}): Promise<void> {
  await seed(async (tx) => {
    await tx.put('intake', {
      _id: 'me',
      diet: { ...VEG_DIET, ...o.diet },
      kitchen: { equipment: [], pantry: (o.pantry ?? []).map((foodId) => ({ foodId, have: true, confirmedAt: '2026-09-30T00:00:00.000Z' })) },
      supplements: { stance: o.stance ?? 'food_first', taking: [] },
      answeredAt: {},
      questionSetVersion: {},
    });
  });
}

async function seed(fn: Parameters<ReturnType<typeof getDocumentStore>['transact']>[1]): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), fn);
}
