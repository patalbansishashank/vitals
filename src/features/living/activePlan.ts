/**
 * The live plan (scheduled, active or paused) and the per-device planning override — the two facts that decide the
 * app's mode (docs/SUITE_SPEC.md §6.1, design/INFORMATION_ARCHITECTURE.md §3.4).
 *
 * Two sources (`ActivePlanSource`):
 * - `createDocumentActivePlanSource()` — the app's: E5's plan documents read through E4's store (`activePlan/me` → the
 *   plan in {scheduled, active, paused} and its head adopted version), following store changes. Plans start, pause and
 *   end only through commands (`plan.start`, `plan.pause`, `plan.end`, …); the app installs it (`installDocumentPlanSource`).
 * - `inMemoryActivePlanSource` over `useActivePlanStore` — tests and demos (fixture plans that have no documents).
 * The planning override is per device and per session (UI state, not user data): it stays in `useActivePlanStore` for
 * both. Everything else reads the plan only through `ActivePlanSource` / `useActivePlan()` / `useAppMode()` (`./mode`).
 *
 * Shell-safe: type-only imports from `@/living` (the shell imports this module, so it must not pull in the engine).
 */
import { create } from 'zustand';
import type { Id, LocalDate, PlanDoc, PlanIntentions, PlanStatus, PlanVersionDoc, RungId, StartResult, Weekday } from '@/living';
import { bodyOf, type Doc, type DocumentStore } from '@/store';
import { getDocumentStore, onDocumentStoreSwitch } from '@/state/runtime';

/** What Living screens need to know about the live plan. */
export interface ActivePlan {
  id: Id;
  name: string;
  rung: RungId | 'custom';
  status: PlanStatus;
  startDate: LocalDate;
  plannedEndDate: LocalDate;
  headVersion: number;
  pauses: Array<{ from: LocalDate; to: LocalDate | null; reason?: string }>;
  intentions: PlanIntentions;
  policy: { checkInWeekday: Weekday; autoApplyLoadLowering: boolean };
  /** When the plan was created (24 h discard window). */
  createdAt: string;
  /** Full documents when the plan was started from the planner (E5 `startFromRung`); fixture plans carry none. */
  doc?: PlanDoc & { id: Id };
  version?: PlanVersionDoc;
}

/**
 * The read side E5/E4 implement: the live plan and the planning override, with change notification.
 * `get()` must return the same object until something changes (it backs `useSyncExternalStore`).
 */
export interface ActivePlanSource {
  get(): { plan: ActivePlan | null; planningOverride: boolean };
  subscribe(listener: () => void): () => void;
  /** False while the source is still loading (the document store opening): "no plan" is not known yet. */
  ready?(): boolean;
}

interface ActivePlanState {
  plan: ActivePlan | null;
  planningOverride: boolean;
  /** Plans ended or replaced in this session, newest first (E5 keeps the real history, restorable for 7 days). */
  ended: Array<ActivePlan & { endedOn: LocalDate; reason: 'completed' | 'abandoned' | 'replaced' | 'safety' }>;
}

interface ActivePlanActions {
  /** Make `plan` the live plan; clears the planning override (starting a plan lands on Today). */
  setPlan(plan: ActivePlan | null): void;
  patchPlan(patch: Partial<ActivePlan>): void;
  /** End the live plan (moves it to `ended`); clears the override. */
  endPlan(endedOn: LocalDate, reason: 'completed' | 'abandoned' | 'replaced' | 'safety'): void;
  /** Remove the live plan without history (plan.discard, 24 h with nothing logged). */
  discardPlan(): void;
  setPlanningOverride(on: boolean): void;
}

const INITIAL: ActivePlanState = { plan: null, planningOverride: false, ended: [] };

export const useActivePlanStore = create<ActivePlanState & ActivePlanActions>()((set) => ({
  ...INITIAL,
  setPlan: (plan) => set({ plan, planningOverride: false }),
  patchPlan: (patch) => set((s) => (s.plan ? { plan: { ...s.plan, ...patch } } : s)),
  endPlan: (endedOn, reason) =>
    set((s) => (s.plan ? { plan: null, planningOverride: false, ended: [{ ...s.plan, status: 'ended' as const, endedOn, reason }, ...s.ended] } : s)),
  discardPlan: () => set({ plan: null, planningOverride: false }),
  setPlanningOverride: (on) => set((s) => (s.plan || !on || documentPlanLive() ? { planningOverride: on } : s)),
}));

/** Reset to "no plan" (tests). */
export function resetActivePlan(): void {
  useActivePlanStore.setState(INITIAL);
}

export function getActivePlan(): ActivePlan | null {
  return useActivePlanStore.getState().plan;
}

/** The store as an `ActivePlanSource` (the interface E5/E4 replace it with). */
export const inMemoryActivePlanSource: ActivePlanSource = {
  get: () => {
    const s = useActivePlanStore.getState();
    return snapshotOf(s);
  },
  subscribe: (l) => useActivePlanStore.subscribe(l),
};

let lastState: ActivePlanState | null = null;
let lastSnap: { plan: ActivePlan | null; planningOverride: boolean } = { plan: null, planningOverride: false };
function snapshotOf(s: ActivePlanState): { plan: ActivePlan | null; planningOverride: boolean } {
  if (lastState && lastState.plan === s.plan && lastState.planningOverride === s.planningOverride) return lastSnap;
  lastState = s;
  lastSnap = { plan: s.plan, planningOverride: s.planningOverride };
  return lastSnap;
}

/** Live = scheduled, active or paused. */
export function isLivePlan(plan: Pick<ActivePlan, 'status'> | null | undefined): boolean {
  return !!plan && (plan.status === 'scheduled' || plan.status === 'active' || plan.status === 'paused');
}

/** The active-plan view of E5's start documents (`startFromRung` / `startFromScenario`). */
export function activePlanFromStart(r: Pick<StartResult, 'plan' | 'version'>): ActivePlan {
  const p = r.plan;
  return {
    id: p.id,
    name: p.name,
    rung: p.rung,
    status: p.status,
    startDate: p.startDate,
    plannedEndDate: p.plannedEndDate,
    headVersion: p.headVersion,
    pauses: p.pauses,
    intentions: p.intentions,
    policy: p.policy,
    createdAt: p.createdAt,
    doc: p,
    version: r.version,
  };
}

/** The active-plan view of a plan document and its head adopted version. */
export function activePlanFromDocs(plan: PlanDoc & { id: Id }, head: PlanVersionDoc | null): ActivePlan {
  return {
    id: plan.id,
    name: plan.name,
    rung: plan.rung,
    status: plan.status,
    startDate: plan.startDate,
    plannedEndDate: plan.plannedEndDate,
    headVersion: plan.headVersion,
    pauses: plan.pauses,
    intentions: plan.intentions,
    policy: plan.policy,
    createdAt: plan.createdAt,
    doc: plan,
    ...(head ? { version: head } : {}),
  };
}

const PLAN_COLLECTIONS: ReadonlySet<string> = new Set(['activePlan', 'plans', 'planVersions']);

/** The plan `activePlan/me` points at, else the newest live one (as E5's executors read it). */
function livePlanDoc(store: DocumentStore): Doc<PlanDoc> | null {
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const plans = store.peekAll<PlanDoc>('plans');
  const pointed = active?.planId ? plans.find((d) => d._id === active.planId) : undefined;
  return pointed ?? plans.filter((d) => isLivePlan(d)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

let documentProbe: (() => boolean) | null = null;
/** Is a live plan known from the documents (the override may be turned on)? */
function documentPlanLive(): boolean {
  return documentProbe?.() ?? false;
}

/**
 * The live plan from the documents. `get()` returns the same object until the plan, its versions or the override
 * change; listeners hear plan commands, merged remote changes (sync), the store finishing its load and a switch of
 * storage engine (E11).
 */
export function createDocumentActivePlanSource(
  getStore: () => DocumentStore = getDocumentStore,
  onSwitch: (fn: (s: DocumentStore) => void) => () => void = onDocumentStoreSwitch,
): ActivePlanSource & { ready(): boolean } {
  const listeners = new Set<() => void>();
  let snap: { plan: ActivePlan | null; planningOverride: boolean } = { plan: null, planningOverride: false };
  let key = '';
  let loaded = false;
  let attached: DocumentStore | null = null;
  let off: (() => void) | null = null;
  const emit = () => listeners.forEach((l) => l());

  /** Recompute the snapshot; true when it changed. */
  const compute = (): boolean => {
    const store = attached!;
    const doc = livePlanDoc(store);
    const versions = doc ? store.peekAll<PlanVersionDoc>('planVersions').filter((v) => v.planId === doc._id) : [];
    const override = useActivePlanStore.getState().planningOverride;
    const k = `${doc?._id ?? ''}@${doc?._rev ?? ''}|${versions.map((v) => v._rev).join(',')}|${override}|${loaded}`;
    if (k === key) return false;
    key = k;
    let head: PlanVersionDoc | null = null;
    for (const v of versions) if (v.status === 'adopted' && (!head || v.version > head.version)) head = bodyOf<PlanVersionDoc>(v);
    snap = { plan: doc ? activePlanFromDocs({ ...bodyOf<PlanDoc>(doc), id: doc._id }, head) : null, planningOverride: override };
    return true;
  };
  const refresh = () => {
    if (attached && compute()) emit();
  };

  /** Follow `store` (the app's store at start, after an engine switch, or a fresh one in tests). */
  const attach = (store: DocumentStore): void => {
    off?.();
    attached = store;
    loaded = false;
    off = store.subscribe((c) => {
      if (PLAN_COLLECTIONS.has(c.col)) refresh();
    });
    const done = () => {
      if (attached !== store) return;
      loaded = true;
      refresh();
    };
    store.ready.then(done, done);
    compute();
  };
  const current = (): void => {
    const store = getStore();
    if (store !== attached) attach(store);
  };

  current();
  onSwitch((s) => {
    attach(s);
    emit();
  });
  useActivePlanStore.subscribe(refresh);
  documentProbe = () => {
    current();
    return isLivePlan(snap.plan);
  };

  return {
    get: () => {
      current();
      return snap;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ready: () => {
      current();
      return loaded;
    },
  };
}
