/**
 * What the food executors read about the person and the day: the food rules (`intake/me` diet, kitchen, supplement
 * stance) and the day's prescription (through E5's `day.get` executor, so the projection stays E5's).
 *
 * The intake shapes are mirrored structurally here (headless commands do not import `@/features`); the source of truth
 * is `src/features/intake/types.ts` (`DietProfile`, `KitchenProfile`, `SupplementsAnswer`).
 */
import { rowsIn, toSectionV2, type SupplementStance, type SupplementState, type SupplementsSectionV2 } from '@/catalogues/supplements';
import type { PrescribedDaySnapshot } from '@/living';
import { getDocumentStore } from '@/state/runtime';
import { getCommand } from '../registry';
import type { CommandContext } from '../types';

export interface DietRules {
  animalFoods: {
    meat: 'none' | 'chicken' | 'chicken+mutton' | 'all_red_meat';
    chicken: boolean;
    mutton: boolean;
    beef: boolean;
    pork: boolean;
    fish: boolean;
    shellfish: boolean;
    eggs: 'none' | 'baked_only' | 'yes';
    dairy: 'none' | 'ghee_only' | 'yes';
    honey: boolean;
  };
  dayRules: Array<{ weekdays: number[]; rule: 'no_meat' | 'no_eggs' | 'vrat' }>;
  jain?: { noRootVeg: boolean; noOnionGarlic: boolean; noHoney: boolean; noFermented: boolean; noMushroom: boolean; greensRestrictedDays: number[] };
  noOnionGarlic: boolean;
  halal: boolean;
  kosher: boolean;
  allergies: string[];
  allergiesOther: string[];
  medicalDiet: string[];
  dislikes: string[];
  familyFoodMode?: boolean;
}

export interface FoodSetup {
  /** Null until the food rules are answered (never guessed). */
  diet: DietRules | null;
  pantry: Array<{ foodId: string; have: boolean }>;
  /** The supplement stance: catalogue suggestions only when 'open'. */
  supplementStance: SupplementStance;
  /** Catalogue ids taken now. */
  takingSupplements: string[];
  /** Catalogue ids at home but not taken (suggested before anything to buy). */
  onHandSupplements: string[];
  /** Catalogue ids the person does not want (never suggested). */
  refusedSupplements: string[];
}

interface IntakeLike {
  diet?: ({ rulesComplete: true } & DietRules) | { rulesComplete: false };
  kitchen?: { pantry?: Array<{ foodId: string; have: boolean }> };
  /** v1 or v2 (read through `toSectionV2`). */
  supplements?: unknown;
}

const idsIn = (s: SupplementsSectionV2 | null, state: SupplementState): string[] => rowsIn(s, state).flatMap((r) => (r.supplementId ? [r.supplementId] : []));

export function readFoodSetup(): FoodSetup {
  const doc = getDocumentStore().peek<IntakeLike>('intake', 'me');
  const diet = doc?.diet && doc.diet.rulesComplete ? (doc.diet as DietRules) : null;
  const supp = toSectionV2(doc?.supplements);
  return {
    diet,
    pantry: doc?.kitchen?.pantry ?? [],
    supplementStance: supp?.stance ?? 'food_first',
    takingSupplements: idsIn(supp, 'taking'),
    onHandSupplements: idsIn(supp, 'onHand'),
    refusedSupplements: idsIn(supp, 'notForMe'),
  };
}

export interface DayView {
  date: string;
  planDay: number | null;
  prescription: PrescribedDaySnapshot | null;
}

/** The day's record as `day.get` returns it (prescription snapshot, plan day). */
export async function readDay(ctx: CommandContext, date: string): Promise<DayView> {
  const def = getCommand('day.get');
  if (!def || def.notImplemented) return { date, planDay: null, prescription: null };
  const out = (await def.execute(ctx, { date } as never)) as Partial<DayView>;
  return { date, planDay: out.planDay ?? null, prescription: out.prescription ?? null };
}

/** Local clock hour of an instant in a time zone (meal entries without a clock time). */
export function clockHourOf(at: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.parse(at)));
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.round((g('hour') + g('minute') / 60) * 100) / 100;
}
