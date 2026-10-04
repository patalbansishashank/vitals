/**
 * Results UI preferences, per scenario (persisted as `vitals.results`): the lane selection and order, the metrics
 * pinned to the readout strip, and whether the figure/warnings band is open. The view and zoom live in the URL.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { registerStore } from '@/state/persistence';
import { MAX_PINNED } from './lib/metrics';

export const RESULTS_UI_KEY = 'vitals.results';
export const RESULTS_UI_VERSION = 1;

export interface ScenarioResultsPrefs {
  /** Lane ids in display order (null = the default core set). */
  laneIds?: string[] | null;
  pinned?: string[];
}

export interface ResultsUiValues {
  byScenario: Record<string, ScenarioResultsPrefs>;
  /** Desktop band under the readout strip (figure over time + warnings). */
  bandOpen: boolean;
  /** Mobile: "Why did the scale move?" expanded. */
  breakdownOpen: boolean;
}

export interface ResultsUiState extends ResultsUiValues {
  setLanes: (sid: string, ids: string[] | null) => void;
  togglePinned: (sid: string, id: string) => void;
  setBandOpen: (open: boolean) => void;
  setBreakdownOpen: (open: boolean) => void;
  forgetScenario: (sid: string) => void;
}

const DEFAULTS: ResultsUiValues = { byScenario: {}, bandOpen: true, breakdownOpen: false };

const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');

/** Keeps only well-formed entries (import validation and rehydration). */
export function sanitizeResultsUi(raw: unknown): ResultsUiValues {
  const out: ResultsUiValues = { ...DEFAULTS, byScenario: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.bandOpen === 'boolean') out.bandOpen = r.bandOpen;
  if (typeof r.breakdownOpen === 'boolean') out.breakdownOpen = r.breakdownOpen;
  if (r.byScenario && typeof r.byScenario === 'object') {
    for (const [sid, v] of Object.entries(r.byScenario as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      const prefs: ScenarioResultsPrefs = {};
      if (p.laneIds === null) prefs.laneIds = null;
      else if (isStrArr(p.laneIds)) prefs.laneIds = [...new Set(p.laneIds)];
      if (isStrArr(p.pinned)) prefs.pinned = [...new Set(p.pinned)].slice(0, MAX_PINNED);
      out.byScenario[sid] = prefs;
    }
  }
  return out;
}

export function isResultsUiState(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return r.byScenario === undefined || (typeof r.byScenario === 'object' && r.byScenario !== null);
}

export const useResultsUiStore = create<ResultsUiState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setLanes: (sid, ids) =>
        set((s) => ({ byScenario: { ...s.byScenario, [sid]: { ...s.byScenario[sid], laneIds: ids ? [...new Set(ids)] : null } } })),
      togglePinned: (sid, id) =>
        set((s) => {
          const cur = s.byScenario[sid]?.pinned ?? [];
          const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-MAX_PINNED);
          return { byScenario: { ...s.byScenario, [sid]: { ...s.byScenario[sid], pinned: next } } };
        }),
      setBandOpen: (bandOpen) => set({ bandOpen }),
      setBreakdownOpen: (breakdownOpen) => set({ breakdownOpen }),
      forgetScenario: (sid) =>
        set((s) => {
          const byScenario = { ...s.byScenario };
          delete byScenario[sid];
          return { byScenario };
        }),
    }),
    {
      name: RESULTS_UI_KEY,
      version: RESULTS_UI_VERSION,
      partialize: (s) => ({ byScenario: s.byScenario, bandOpen: s.bandOpen, breakdownOpen: s.breakdownOpen }),
      migrate: (persisted) => sanitizeResultsUi(persisted) as unknown as ResultsUiState,
      merge: (persisted, current) => ({ ...current, ...sanitizeResultsUi(persisted) }),
    },
  ),
);

registerStore(RESULTS_UI_KEY, RESULTS_UI_VERSION, {
  label: 'chart layout',
  describe: (s) => {
    const n = Object.keys(sanitizeResultsUi(s).byScenario).length;
    return n ? `chart channels for ${n} scenario${n === 1 ? '' : 's'}` : null;
  },
  validate: isResultsUiState,
  merge: (current, incoming) => {
    const a = sanitizeResultsUi(current);
    const b = sanitizeResultsUi(incoming);
    return { ...a, byScenario: { ...b.byScenario, ...a.byScenario } };
  },
  rehydrate: () => useResultsUiStore.persist.rehydrate(),
  // Chart layout is per device (screen size), so it never syncs.
  syncable: false,
});

const NO_PREFS: ScenarioResultsPrefs = {};

export function useScenarioResultsPrefs(sid: string): ScenarioResultsPrefs {
  return useResultsUiStore((s) => s.byScenario[sid] ?? NO_PREFS);
}
