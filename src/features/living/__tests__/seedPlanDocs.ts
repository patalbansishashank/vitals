/** Test helper: a running plan as documents (as `plan.start` writes them), like src/commands/__tests__/living.test.ts. */
import type { PersonProfile } from '@/engine';
import { addDays, DEFAULT_ITEM_WEIGHTS, type LocalDate, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';

export const SEED_PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const PERSON: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-01' };

export async function seedPlanDocs(o: { startDate: LocalDate; days?: number; name?: string }): Promise<void> {
  const days = o.days ?? 84;
  const plan = {
    name: o.name ?? 'Spring cut', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${o.startDate}T08:00:00.000Z` }, status: 'active',
    startDate: o.startDate, plannedEndDate: addDays(o.startDate, days), request: { profile: PERSON, goals: [], horizonDays: days }, baselineProfile: PERSON, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${o.startDate}T08:00:00.000Z`,
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const version = {
    planId: SEED_PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: o.startDate, horizonDays: days, programs: [day], days: Array.from({ length: days }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${o.startDate}T08:00:00.000Z`,
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: SEED_PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${SEED_PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: SEED_PLAN_ID, since: o.startDate });
  });
}
