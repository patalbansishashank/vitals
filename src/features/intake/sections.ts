/**
 * Chapter answers → the section bodies of `intake/me` and the profile habit fields the same answers set (pure).
 * `intake.answer` runs `chapterOutput` on the stored turns (`src/state/internal/intake.ts`) and writes the habit fields
 * (SUITE_SPEC §2.3.1), so the screens dispatch only `intake.answer`.
 */
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { HabitProfile } from '@/engine/types/profile';
import type { ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { reduceActivity } from './chapters/activity';
import { reduceDevices } from './chapters/devices';
import { reduceFood } from './chapters/food';
import { reduceTraining } from './chapters/training';
import type { FlowContext } from './flow';
import type { ActivitySection, ChapterAnswers, ChapterId, DevicesSection, DietSection, IntakeDoc, IntakeSectionId, KitchenProfile, MarkersSection, SupplementsAnswer, TrainingSection } from './types';

export interface SectionContext extends FlowContext {
  safety?: ScreeningAnswers | null;
  /** ISO instant (pantry confirmations). */
  now: string;
}

export type SectionBodies = Partial<{
  activity: ActivitySection;
  training: TrainingSection;
  diet: DietSection;
  kitchen: KitchenProfile;
  supplements: SupplementsAnswer;
  markers: MarkersSection;
  devices: DevicesSection;
}>;

/** Habit fields to write on the profile; `null` clears one (a stale rough step tick after "I don't know"). */
export type HabitsPatch = { [K in keyof HabitProfile]?: HabitProfile[K] | null };

export interface ChapterOutput {
  sections: SectionBodies;
  habits: HabitsPatch;
}

const turnsCopy = (a: ChapterAnswers): ChapterAnswers => ({
  values: { ...a.values },
  status: { ...a.status },
  ...(a.order ? { order: [...a.order] } : {}),
  ...(a.skippedAll ? { skippedAll: true } : {}),
});

export function chapterOutput(chapter: ChapterId, a: ChapterAnswers, ctx: SectionContext): ChapterOutput {
  const turns = turnsCopy(a);
  switch (chapter) {
    case 'activity': {
      const r = reduceActivity(a, ctx);
      const habits: HabitsPatch = { ...r.habits };
      if (r.clearTypicalSteps) habits.typicalSteps = null;
      return { sections: { activity: { ...(r.activity ?? {}), ...(r.measured ? { measured: r.measured } : {}), turns } }, habits };
    }
    case 'training': {
      const r = reduceTraining(a, { ...ctx, catalogue: SEED_CATALOGUE });
      return { sections: { training: { ...r.profile, prefs: r.prefs, turns } }, habits: {} };
    }
    case 'food': {
      const r = reduceFood(a, ctx);
      const diet: DietSection = r.diet ? { ...r.diet, rulesComplete: true, turns } : { rulesComplete: false, turns };
      return { sections: { diet, kitchen: r.kitchen, supplements: r.supplements }, habits: { ...r.habits } };
    }
    case 'markers':
      // the values live in the markers documents (written by the chapter's own commands); the turns ride here
      return { sections: { markers: { turns } }, habits: {} };
    case 'devices': {
      const r = reduceDevices(a, ctx);
      return { sections: { devices: { ...r.devices, streams: r.policies, turns } }, habits: {} };
    }
  }
}

/* ------------------------------------------------------------------------------------------- merge patches */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (!isObj(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
  return out;
}

/**
 * The JSON merge patch (RFC 7396) that turns `before` into `after`: keys that disappear become null, objects recurse,
 * arrays and scalars replace. `intake.answer` merges section bodies this way, so a nested key that is no longer true
 * (a commute's minutes after switching to "ride") must be nulled explicitly.
 */
export function mergePatch(before: unknown, after: Record<string, unknown>): Record<string, unknown> {
  const b = isObj(before) ? before : {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b)) if (b[k] !== undefined && after[k] === undefined) out[k] = null;
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    if (isObj(v) && isObj(b[k])) {
      const sub = mergePatch(b[k], v);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (!deepEqual(b[k], v)) out[k] = clean(v);
  }
  return out;
}

/** Apply a merge patch (the same rule as the command), for previews and tests. */
export function applyMergePatch(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = isObj(v) ? applyMergePatch(out[k], v) : v;
  }
  return out;
}

/** Section patches against the stored document (only sections that change). */
export function sectionPatches(doc: IntakeDoc, sections: SectionBodies): Array<{ section: IntakeSectionId; patch: Record<string, unknown> }> {
  const out: Array<{ section: IntakeSectionId; patch: Record<string, unknown> }> = [];
  for (const [section, body] of Object.entries(sections) as Array<[IntakeSectionId, Record<string, unknown>]>) {
    const patch = mergePatch(doc[section], body);
    if (Object.keys(patch).length || !doc.answeredAt[section]) out.push({ section, patch });
  }
  return out;
}
