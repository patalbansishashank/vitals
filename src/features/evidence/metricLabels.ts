/**
 * Metric adapter for the Evidence library: every metric label, category and grade the
 * library shows is read through here, so the library never depends on the engine's
 * catalogue shape directly.
 *
 * Wired to the engine catalogue (`src/engine/types/metrics.ts`, `SERIES`). Ids that are not
 * in the catalogue (content written ahead of the engine, legacy ids) fall back to an
 * id-derived label, so a chip always renders something readable.
 */
import type { EvidenceCategory, EvidenceGrade, SourceRef } from '@/content/evidence/schema';
import { dossierOfTopic } from '@/content/evidence/sources';
import { SERIES, type SeriesDef } from '@/engine/types/metrics';
import { paths } from '@/app/paths';

export interface MetricInfo {
  id: string;
  /** Plain-first name, e.g. "Blood ketones (BHB)". */
  label: string;
  unit?: string;
  category?: EvidenceCategory;
  grade?: EvidenceGrade;
  /** 'metric' = an outcome channel; 'detail' / 'input' = component or echoed-input series; 'unknown' = not in the catalogue. */
  kind: 'metric' | 'detail' | 'input' | 'unknown';
  /** The Planner can use it as a goal. */
  goalEligible: boolean;
  /** Mandatory caveat the engine shows with the series (grade C/D, blood markers, indices). */
  caveat?: string;
  /** Plain-language definition of what the series shows (engine catalogue `description`), where the label could mislead. */
  description?: string;
  /** Evidence topics that define the computation, owner first. These are what a screen shows (as links). */
  sources: SourceRef[];
  /** Internal research-file numbers of `sources` (mechanism ids start with one). Used for ordering; never shown. */
  dossiers: string[];
}

/** "fatMass" / "fat_mass" / "fat-mass" → "Fat mass". */
export function idToLabel(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** Research-file numbers of a metric's source topics, in order (internal: for ranking mechanisms, never shown). */
export function dossiersOfSources(sources: readonly SourceRef[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const d = dossierOfTopic(s.topic);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

function fromSeries(d: SeriesDef): MetricInfo {
  return {
    id: d.id,
    label: d.label,
    unit: d.unit,
    category: d.category,
    grade: d.grade,
    kind: d.kind,
    goalEligible: d.goal !== 'none',
    caveat: d.caveat,
    description: d.description,
    sources: [...d.sources],
    dossiers: dossiersOfSources(d.sources),
  };
}

const CATALOGUE: ReadonlyMap<string, MetricInfo> = new Map(
  (SERIES as readonly SeriesDef[]).map((d) => [d.id, fromSeries(d)]),
);

/** Normalised lookup key so `fat_mass`, `fat-mass` and `fatMass` resolve to the same entry. */
const looseKey = (id: string): string => id.replace(/[_-]/g, '').toLowerCase();
const LOOSE: ReadonlyMap<string, MetricInfo> = new Map(
  [...CATALOGUE.values()].map((m) => [looseKey(m.id), m]),
);

/** Everything the library knows about a metric id (never throws). */
export function metricInfo(id: string): MetricInfo {
  return (
    CATALOGUE.get(id) ??
    LOOSE.get(looseKey(id)) ?? {
      id,
      label: idToLabel(id),
      kind: 'unknown',
      goalEligible: false,
      sources: [],
      dossiers: [],
    }
  );
}

/** Display label for a metric id. */
export function metricLabel(id: string): string {
  return metricInfo(id).label;
}

/** Outcome metrics (the channels a user can chart or rank as goals), for search. */
export function outcomeMetrics(): MetricInfo[] {
  return [...CATALOGUE.values()].filter((m) => m.kind === 'metric');
}

/**
 * "Used by" chip target: Results with the metric focused.
 * TODO(simulator): `/simulate` resolves the active scenario; it should forward `view` and `m`
 * to `/simulate/:sid/results` when a projection exists (IA §2), and drop them when none does.
 */
export function metricResultsHref(id: string): string {
  return `${paths.simulate}?view=focus&m=${encodeURIComponent(id)}`;
}

/**
 * "Use as a goal" target, only for goal-eligible metrics (null otherwise).
 * TODO(planner): the goals screen should read `?add=<metricId>` and add that goal.
 */
export function metricGoalHref(id: string): string | null {
  return metricInfo(id).goalEligible ? `${paths.planGoals}?add=${encodeURIComponent(id)}` : null;
}
