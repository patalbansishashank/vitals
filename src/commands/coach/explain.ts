/**
 * `sim.explain` (E9b): why a simulated metric moved, as data. The headless counterpart of the Results screen's
 * "explain this curve" drawer: the same per-metric driver lists (`EXPLAIN_DRIVERS` in the simulator results package,
 * restated here because commands do not import the UI), read from the scenario's last simulation result, each driver
 * attached to the Evidence library mechanisms that list it in `relatedMetricIds`. Numbers come from the result only;
 * the mechanisms supply the "why" and the evidence ids; nothing is invented.
 */
import { EVIDENCE_TOPICS } from '@/content/evidence';
import type { Mechanism } from '@/content/evidence/schema';
import { SERIES, type SeriesDef } from '@/engine/types/metrics';
import { fail } from '../registry';
import { implementLate as implement } from './late';

/** Per-metric drivers, most telling first (`@` keys are expanded below). */
const DRIVERS: Readonly<Record<string, readonly string[]>> = {
  bhb: ['@carbs', '@sinceMeal', 'liverGlycogen', '@fast', 'ketoAdaptation'],
  totalKetones: ['@carbs', '@sinceMeal', 'liverGlycogen', '@fast'],
  hoursInKetosis: ['@carbs', '@fast', 'liverGlycogen', 'ketoAdaptation'],
  ketoAdaptation: ['@carbs', 'hoursInKetosis'],
  glycogenTotal: ['@carbs', '@training', '@fast'],
  liverGlycogen: ['@carbs', '@sinceMeal', '@fast'],
  muscleGlycogen: ['@carbs', '@training'],
  glucose: ['@sinceMeal', '@carbs', 'insulinSensitivity'],
  fatOxidation: ['@carbs', '@energy', '@fast'],
  scaleWeight: ['@decomp'],
  leanMass: ['@decomp'],
  fatMass: ['@energy', '@proteinPerKg', 'metabolicAdaptation'],
  bodyFatPct: ['fatMass', 'scaleWeight'],
  waist: ['@fatChange', 'visceralFat'],
  leanTissue: ['@energy', '@proteinPerKg', '@rtSets7'],
  skeletalMuscle: ['@energy', '@proteinPerKg', '@rtSets7'],
  rtMuscleGain: ['@rtSets7', '@proteinPerKg', '@energy'],
  hunger: ['@energy', '@proteinShare', 'inSleep', 'dietFatigue', '@fatChange'],
  adherence: ['hunger', '@energy', 'dietFatigue'],
  tdee: ['rmr', 'neat', 'exerciseEE', 'tef', 'metabolicAdaptation'],
  maintenance: ['rmr', 'neat', 'exerciseEE', 'tef', 'metabolicAdaptation'],
  rmr: ['@fatChange', 'metabolicAdaptation'],
  metabolicAdaptation: ['@energy', '@fatChange'],
  energyBalance: ['inEnergy', 'tdee'],
  autophagyIdx: ['@sinceMeal', '@fast', 'mtorIdx', 'ampkIdx'],
  mtorIdx: ['@sinceMeal', 'inProtein', '@training'],
  ampkIdx: ['@sinceMeal', '@fast', '@training'],
  mps: ['inProtein', '@training', '@energy'],
  energyAvailability: ['inEnergy', 'exerciseEE'],
  insulinSensitivity: ['@fatChange', '@rtSets7', 'inSleep'],
  leptin: ['@fatChange', '@energy'],
};

const EXPAND: Readonly<Record<string, readonly string[]>> = {
  '@decomp': ['fatMass', 'leanMass', 'glycogenWater', 'ecfShift', 'gutContent'],
  '@energy': ['energyBalance'],
  '@carbs': ['inCarbs'],
  '@training': ['exerciseEE'],
  '@fast': ['hoursFasted'],
  '@sinceMeal': ['hoursFasted'],
  '@proteinPerKg': ['inProtein'],
  '@proteinShare': ['inProtein'],
  '@rtSets7': ['inRtSets'],
  '@fatChange': ['fatMass'],
};

const defOf = (id: string): SeriesDef | undefined => (SERIES as readonly SeriesDef[]).find((d) => d.id === id);

function resolveMetric(raw: string): SeriesDef | undefined {
  const norm = (s: string): string => s.replace(/[_\s-]/g, '').toLowerCase();
  return (SERIES as readonly SeriesDef[]).find((d) => d.id === raw) ?? (SERIES as readonly SeriesDef[]).find((d) => norm(d.id) === norm(raw) || norm(d.label) === norm(raw));
}

function driversOf(id: string): string[] {
  const out: string[] = [];
  for (const k of DRIVERS[id] ?? []) for (const d of k.startsWith('@') ? (EXPAND[k] ?? []) : [k]) if (d !== id && !out.includes(d)) out.push(d);
  return out;
}

let mechanisms: Promise<Mechanism[]> | null = null;
function allMechanisms(): Promise<Mechanism[]> {
  mechanisms ??= Promise.all(EVIDENCE_TOPICS.map(async (e) => (await e.load()).default.mechanisms)).then((l) => l.flat());
  return mechanisms;
}

const GRADE: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/** Mechanisms listing `metricId`, best first: established and well-graded before contested, questions last. */
function mechanismsFor(all: readonly Mechanism[], metricId: string): Mechanism[] {
  return all
    .filter((m) => m.relatedMetricIds.includes(metricId))
    .map((m, i) => ({ m, i, s: (m.status === 'established' ? 0 : m.status === 'proposed-fit' ? 1 : 2) * 10 + (GRADE[m.grade] ?? 3) + (/\?\s*$/.test(m.title) ? 50 : 0) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.m);
}

const lead = (s: string): string => {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s.trim());
  return (m?.[0] ?? s).trim();
};

const nice = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '') || '0';

export interface ExplainDriver {
  factor: string;
  effect: string;
  mechanism: string;
  evidenceIds: string[];
}

export interface Explanation {
  headline: string;
  metric: string;
  label: string;
  unit: string;
  day: number;
  value: number;
  start: number;
  change: number;
  drivers: ExplainDriver[];
  caveats: string[];
  evidenceIds: string[];
}

implement(
  'sim.explain',
  async (_ctx, input: { source: { scenarioId: string }; metric: string; day?: number }): Promise<Explanation> => {
    const def = resolveMetric(input.metric) ?? fail('invalid_input', `There is no simulated metric called "${input.metric}".`, { path: '/metric' });
    const sim = await import('@/state/internal/simulation');
    const result = sim.runOf(input.source.scenarioId)?.result;
    if (!result) fail('precondition_failed', 'There is no simulation result yet: run the simulation first.', { precondition: 'scenarioExists', allowedAlternatives: ['sim.run'] });
    const daily = result.daily as Partial<Record<string, Float32Array>>;
    const series = daily[def.id] ?? fail('not_found', `The simulation did not record ${def.label}.`, { path: '/metric' });
    const day = Math.min(input.day ?? series.length - 1, series.length - 1);
    const initial = (result.initial as Partial<Record<string, number>>)[def.id];
    const start = Number.isFinite(initial) ? (initial as number) : series[0]!;
    const value = series[day]!;
    const change = value - start;
    const all = await allMechanisms();

    const drivers: ExplainDriver[] = [];
    for (const id of driversOf(def.id)) {
      const d = defOf(id);
      const arr = daily[id];
      if (!d || !arr || arr.length === 0) continue;
      const at = arr[Math.min(day, arr.length - 1)]!;
      const init = (result.initial as Partial<Record<string, number>>)[id];
      const from = Number.isFinite(init) ? (init as number) : arr[0]!;
      let effect: string;
      if (d.kind === 'input') {
        let sum = 0;
        let n = 0;
        for (let i = 0; i <= Math.min(day, arr.length - 1); i++) if (Number.isFinite(arr[i]!)) {
          sum += arr[i]!;
          n++;
        }
        effect = `${d.label} averaged ${nice(n ? sum / n : at)} ${d.unit} over days 0–${day}`;
      } else {
        effect = `${d.label} ${at >= from ? 'rose' : 'fell'} ${nice(Math.abs(at - from))} ${d.unit} (${nice(from)} → ${nice(at)})`;
      }
      const mech = mechanismsFor(all, id).slice(0, 2);
      drivers.push({ factor: d.label, effect, mechanism: mech[0] ? `${mech[0].title}: ${lead(mech[0].summary)}` : '', evidenceIds: mech.map((m) => m.id) });
      if (drivers.length >= 5) break;
    }

    const own = mechanismsFor(all, def.id).slice(0, 3);
    const caveats: string[] = [];
    if (def.caveat) caveats.push(def.caveat);
    if (def.grade === 'C' || def.grade === 'D') caveats.push(`Evidence grade ${def.grade}: treat ${def.label.toLowerCase()} as indicative, not exact.`);
    for (const m of own) if (m.caveats && caveats.length < 4) caveats.push(lead(m.caveats));
    const warns = (result.warnings ?? []).filter((w) => w.startDay <= day && w.endDay >= day);
    for (const w of warns.slice(0, 2)) caveats.push(`Simulation warning on day ${day}: ${w.message}`);

    const top = drivers[0];
    const headline =
      Math.abs(change) < 1e-9
        ? `${def.label} is unchanged on day ${day} (${nice(value)} ${def.unit}).`
        : `${def.label} ${change >= 0 ? 'rises' : 'falls'} ${nice(Math.abs(change))} ${def.unit} by day ${day} (${nice(start)} → ${nice(value)})${top ? `, mainly through ${top.factor.toLowerCase()}` : ''}.`;
    return {
      headline,
      metric: def.id,
      label: def.label,
      unit: def.unit,
      day,
      value: Number(value.toFixed(4)),
      start: Number(start.toFixed(4)),
      change: Number(change.toFixed(4)),
      drivers,
      caveats,
      evidenceIds: [...new Set([...own.map((m) => m.id), ...drivers.flatMap((d) => d.evidenceIds)])],
    };
  },
  'E9b',
);
