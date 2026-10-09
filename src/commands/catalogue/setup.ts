/**
 * The person's catalogue, training setup and prescribed days, read headlessly from the document store (tier H). One
 * reading for every caller: the `catalogue.*` / `train.*` executors, the Train screen's setup source and the Food
 * screen's grocery source, so the Coach and the screens compose the same sessions from the same setup.
 *
 * - Catalogue: the seed (`@/content/catalogues`) with the person's `catalogueCustom` items merged over it.
 * - Training profile: the intake's training section (`intake/me.training`, written by `intake.answer`), plus the
 *   equipment the person added (`catalogue.addEquipment`), plus typed "something else" items the catalogue knows.
 *   Nothing answered → bodyweight at home (the intake's skip defaults).
 * - Body context: body mass = the plan's trend weight (`derived/trend:<planId>`, E5's assimilation) when there is one,
 *   else the profile weight; VO2max = a measured value (labs) when known, else the engine's initial value (40 mL/kg/min)
 *   — the same rule as the living-plan session compiler, so a composed session and its logged credit agree; height and
 *   resting metabolism from the profile.
 * - Prescribed days: the frozen prescription (`dayStatus.prescribed`) for past and current plan days, else the
 *   prescription the plan's version in force gives that date (`freezePrescription`, compiled once per version).
 *
 * The catalogue modules are large: callers pass them in (`loadCatalogueModules()` imports them lazily).
 */
import type * as Catalogues from '@/catalogues';
import type * as CatalogueContent from '@/content/catalogues';
import type { Catalogue, ParsedUserItems, StimulusContext, TrainingProfile } from '@/catalogues';
import type { PersonProfile } from '@/engine';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { SIGNAL_BY_NAME } from '@/engine/types/signals';
import {
  addDays,
  compareDates,
  compileVersion,
  freezePrescription,
  headAdopted,
  isLive,
  pausedDaySet,
  planDay,
  versionInForce,
  weekdayOf,
  withUsualSessions,
  type LocalDate,
  type PlanDoc,
  type PlanVersionDoc,
  type PrescribedDaySnapshot,
} from '@/living';
import type { DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { readLivingDocs } from '../livingWiring';

export interface CatalogueModules {
  cat: typeof Catalogues;
  content: typeof CatalogueContent;
}

let modules: Promise<CatalogueModules> | null = null;

/** The catalogue code and seed data, imported on first use. */
export function loadCatalogueModules(): Promise<CatalogueModules> {
  modules ??= Promise.all([import('@/catalogues'), import('@/content/catalogues')]).then(([cat, content]) => ({ cat, content }));
  return modules;
}

/* ---------------------------------------------------------------- catalogue */

/** Raw `catalogueCustom` documents (metadata kept: `_id` is the document id). */
export function readUserDocs(store: DocumentStore = getDocumentStore()): Array<Record<string, unknown>> {
  return store.peekAll<Record<string, unknown>>('catalogueCustom') as Array<Record<string, unknown>>;
}

export interface PersonCatalogue {
  catalogue: Catalogue;
  user: ParsedUserItems;
}

/** The seed catalogue with the person's items merged over it. */
export function personCatalogueNow(m: CatalogueModules, store: DocumentStore = getDocumentStore()): PersonCatalogue {
  const user = m.cat.parseUserItems(readUserDocs(store), m.content.SEED_CATALOGUE);
  const catalogue = user.ids.size > 0 ? m.cat.personCatalogue(m.content.SEED_INPUT, user) : m.content.SEED_CATALOGUE;
  return { catalogue, user };
}

/* ---------------------------------------------------------------- body context */

/** VO2max when nothing is measured: the engine's initial value (the session compiler uses the same). */
export const DEFAULT_VO2MAX = SIGNAL_BY_NAME.get('vo2maxMlKgMin')!.init;

/** The plan's trend weight (E5 assimilation cache), kg, or null. */
export function trendWeightNow(store: DocumentStore = getDocumentStore()): number | null {
  const active = store.peek<{ planId?: string | null }>('activePlan', 'me');
  const planId = active?.planId ?? readLivingDocs().plan?.id ?? null;
  if (!planId) return null;
  const t = store.peek<{ trendToday?: { kg?: number } | null }>('derived', `trend:${planId}`);
  const kg = t?.trendToday?.kg;
  return typeof kg === 'number' && Number.isFinite(kg) && kg > 0 ? kg : null;
}

/** Stimulus context from an engine profile and an optional trend weight (see the module note for the fallbacks). */
export function stimulusContextOf(profile: PersonProfile, trendKg: number | null = null): StimulusContext {
  let rmr: number | undefined;
  try {
    const r = resolveProfile(profile).rmr0Kcal;
    if (Number.isFinite(r) && r > 0) rmr = r;
  } catch {
    rmr = undefined;
  }
  const measured = profile.labs?.vo2maxMlKgMin;
  return {
    bodyMassKg: trendKg ?? profile.body.weightKg,
    vo2max: typeof measured === 'number' && measured > 0 ? measured : DEFAULT_VO2MAX,
    heightM: profile.body.heightCm / 100,
    ...(rmr !== undefined ? { rmrKcalPerDay: rmr } : {}),
  };
}

/** The person's body context now. */
export function stimulusContextNow(store: DocumentStore = getDocumentStore()): StimulusContext {
  return stimulusContextOf(simulatorProfileNow(), trendWeightNow(store));
}

/* ---------------------------------------------------------------- training setup */

export interface TrainingSetupNow extends PersonCatalogue {
  profile: TrainingProfile;
  ctx: StimulusContext;
  /** The intake's training chapter has answers. */
  answered: boolean;
  /** Typed "something else" items no catalogue item matches yet. */
  unresolvedEquipment: string[];
}

/** The person's training setup now. */
export function trainingSetupNow(m: CatalogueModules, store: DocumentStore = getDocumentStore()): TrainingSetupNow {
  const pc = personCatalogueNow(m, store);
  const intake = store.peek<{ training?: unknown }>('intake', 'me');
  const r = m.cat.trainingProfileFromIntake(intake?.training, { catalogue: pc.catalogue, ownedEquipment: pc.user.ownedEquipment });
  return { ...pc, profile: r.profile, ctx: stimulusContextNow(store), answered: r.answered, unresolvedEquipment: r.unresolvedEquipment };
}

/* ---------------------------------------------------------------- prescribed days */

/** Living dates are Monday-first; the catalogue's weekday is Sunday-first (0 = Sunday). */
export function catalogueWeekday(date: LocalDate): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return ((weekdayOf(date) + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface PlanRef {
  id: string;
  status: PlanDoc['status'];
  rung: PlanDoc['rung'];
  startDate: LocalDate;
  plannedEndDate: LocalDate;
}

const compiled = new Map<string, ReturnType<typeof compileVersion>>();

function compiledFor(plan: PlanDoc & { id: string }, version: PlanVersionDoc): ReturnType<typeof compileVersion> {
  const key = `${plan.id}:${version.version}`;
  let c = compiled.get(key);
  if (!c) {
    c = compileVersion(plan.baselineProfile, version.schedule);
    if (compiled.size >= 4) compiled.delete(compiled.keys().next().value!);
    compiled.set(key, c);
  }
  return c;
}

/**
 * The prescriptions of `dates` for the running plan (null outside it, or with no running plan). `tz` places fasts on
 * the clock.
 */
export function prescribedDays(dates: readonly LocalDate[], tz: string): { plan: PlanRef | null; days: Map<LocalDate, PrescribedDaySnapshot | null> } {
  const docs = readLivingDocs();
  const plan = docs.plan as (PlanDoc & { id: string }) | null;
  const days = new Map<LocalDate, PrescribedDaySnapshot | null>();
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan)) {
    for (const d of dates) days.set(d, null);
    return { plan: plan ? planRef(plan) : null, days };
  }
  const frozen = new Map(docs.dayStatus.filter((s) => s.prescribed?.planId === plan.id).map((s) => [s.date, s.prescribed!] as const));
  for (const date of dates) {
    if (compareDates(date, plan.startDate) < 0 || compareDates(date, plan.plannedEndDate) >= 0) {
      days.set(date, null);
      continue;
    }
    const f = frozen.get(date);
    if (f) {
      // a day frozen before usual sessions were prescribed gets them re-derived from its own version (never written back)
      const fd = planDay(plan, date);
      const fv = (docs.versions.find((v) => v.planId === plan.id && v.version === f.version) ?? versionInForce(docs.versions, fd) ?? head) as PlanVersionDoc;
      const fp = pausedDaySet(plan, addDays(date, 1)).has(fd);
      days.set(date, withUsualSessions(f, plan.baselineProfile, date, () => freezePrescription({ plan, version: fv, date, tz, ...(fp ? { paused: true } : { compiled: compiledFor(plan, fv) }) })));
      continue;
    }
    const d = planDay(plan, date);
    const version = (versionInForce(docs.versions, d) ?? head) as PlanVersionDoc;
    const paused = pausedDaySet(plan, addDays(date, 1)).has(d);
    try {
      days.set(date, freezePrescription({ plan, version, date, tz, ...(paused ? { paused: true } : { compiled: compiledFor(plan, version) }) }));
    } catch {
      days.set(date, null);
    }
  }
  return { plan: planRef(plan), days };
}

function planRef(p: PlanDoc & { id: string }): PlanRef {
  return { id: p.id, status: p.status, rung: p.rung, startDate: p.startDate, plannedEndDate: p.plannedEndDate };
}

/** Tests: forget the compiled plan versions. */
export function resetSetupCaches(): void {
  compiled.clear();
}
