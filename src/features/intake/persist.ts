/**
 * Saving intake answers: every commit dispatches `intake.answer` per changed section (undoable, low impact); the
 * command also derives the profile habit fields the same answers set (SUITE_SPEC §2.3.1) and, for a measured resting
 * energy from a breath test, the profile's measured resting metabolism (§13.1). Dispatches are chained so
 * each section's merge patch is computed against the document the previous one left.
 */
import { dispatch } from '@/commands/bus';
import '@/commands/defs/intake';
import '@/commands/defs/profile';
import '@/commands/defs/catalogue';
import '@/commands/defs/bio';
import { policyCalls } from './devicePolicies';
import { readIntake } from './doc';
import { chapterOutput, sectionPatches, type SectionContext } from './sections';
import { CHAPTER_SECTIONS, QUESTION_SET_VERSION, type ChapterAnswers, type ChapterId, type StreamPolicy } from './types';

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

/** Resolves when every queued save has been dispatched and committed (tests, leaving the screen). */
export function settleIntakeSaves(): Promise<void> {
  return chain.then(() => undefined);
}

export interface SaveOptions {
  /** Unused: `intake.answer` derives the habit fields and compares them with the profile itself. */
  habitsNow?: Record<string, unknown>;
}

/** Save one chapter's turns (and everything derived from them). Resolves false when a section could not be saved. */
export function saveChapter(chapter: ChapterId, answers: ChapterAnswers, ctx: SectionContext, _opts: SaveOptions = {}): Promise<boolean> {
  const out = chapterOutput(chapter, answers, ctx);
  return enqueue(async () => {
    const before = readIntake();
    let ok = true;
    for (const { section, patch } of sectionPatches(readIntake(), out.sections)) {
      const r = await dispatch('intake.answer', { section, answers: patch, questionSetVersion: QUESTION_SET_VERSION[section] });
      if (!r.ok) {
        ok = false;
        console.warn(`Vitals: could not save the ${section} answers`, r);
      }
    }
    await applyDerived(chapter, before, out.sections);
    return ok;
  });
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/** What the saved answers set outside the intake document: typed equipment joins the catalogue, the devices matrix the biometric policies. */
export async function applyDerived(chapter: ChapterId, before: ReturnType<typeof readIntake>, sections: Record<string, unknown>): Promise<void> {
  if (chapter === 'training') {
    const was = new Set(strList((before.training as { prefs?: { customEquipment?: unknown } } | undefined)?.prefs?.customEquipment).map((x) => x.trim().toLowerCase()));
    const now = strList((sections.training as { prefs?: { customEquipment?: unknown } } | undefined)?.prefs?.customEquipment);
    for (const name of now) {
      if (was.has(name.trim().toLowerCase())) continue;
      const r = await dispatch('catalogue.addEquipment', { equipment: { name: name.trim() } });
      if (!r.ok) console.warn(`Vitals: could not add “${name}” to your equipment`, r);
    }
  }
  if (chapter === 'devices') {
    const prev = (before.devices as { streams?: StreamPolicy[] } | undefined)?.streams;
    const next = (sections.devices as { streams?: StreamPolicy[] } | undefined)?.streams;
    for (const { stream, policy } of policyCalls(prev, next)) {
      const r = await dispatch('bio.setPolicy', { stream, policy });
      if (!r.ok) console.warn(`Vitals: could not set the ${stream} sharing policy`, r);
    }
  }
}

/** "Skip this part": the chapter's turns as skips (defaults apply), then the sections marked skipped. */
export function skipChapterSave(chapter: ChapterId, answers: ChapterAnswers, ctx: SectionContext, opts: SaveOptions = {}): Promise<void> {
  void saveChapter(chapter, answers, ctx, opts);
  return enqueue(async () => {
    for (const section of CHAPTER_SECTIONS[chapter]) await dispatch('intake.skip', { section });
  });
}
