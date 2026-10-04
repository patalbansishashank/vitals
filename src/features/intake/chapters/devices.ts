/**
 * Chapter 4 · Devices and data (`devices`) → `StreamOptIns`: which devices, which brand, which phone, how the data
 * would arrive (a computed route card, not a question), and the per-stream matrix (bring in · my scores · my plan ·
 * Coach sees; SUITE_SPEC §4.5 `StreamPolicy`). Nothing connects or imports from here. Skipping leaves every stream off;
 * the recommended cells are only suggested until the person presses "Use recommended" or sets them one by one.
 */
import { D } from '../copy';
import { usedValues, type FlowContext, type Question } from '../flow';
import type { ChapterAnswers, CoachVisibility, DeviceKind, DevicesAnswer, Platform, StreamId, StreamOptIns, StreamPolicy } from '../types';

export const DEVICE_KINDS: readonly DeviceKind[] = ['ring', 'watch', 'band', 'scale', 'chestStrap', 'phoneOnly', 'none'];
/** Devices that have a brand to pick. */
export const BRANDED: readonly DeviceKind[] = ['ring', 'watch', 'band', 'scale', 'chestStrap'];

export const STREAM_ORDER: readonly StreamId[] = ['sleep_sessions', 'heart_rate', 'hrv', 'spo2', 'skin_temp', 'steps', 'workouts', 'weight', 'body_fat', 'vendor_scores'];

/** Streams each kind of device offers. */
export const DEVICE_STREAMS: Readonly<Record<DeviceKind, readonly StreamId[]>> = {
  ring: ['sleep_sessions', 'heart_rate', 'hrv', 'spo2', 'skin_temp', 'steps', 'vendor_scores'],
  watch: ['sleep_sessions', 'heart_rate', 'hrv', 'spo2', 'steps', 'workouts', 'vendor_scores'],
  band: ['sleep_sessions', 'heart_rate', 'steps', 'workouts', 'vendor_scores'],
  scale: ['weight', 'body_fat'],
  chestStrap: ['heart_rate', 'hrv', 'workouts'],
  phoneOnly: ['steps'],
  none: [],
};

type Cell = 'yes' | 'na' | 'never';
export interface StreamRule {
  scores: Cell;
  engine: Cell;
  /** Suggested when a device is turned on (bring in, scores, plan); the Coach is never suggested. */
  recommend: { imported: boolean; scores: boolean; engine: boolean };
}

/** What each stream may do (SUITE_SPEC §4.5 table) and what is suggested. */
export const STREAM_RULES: Readonly<Record<StreamId, StreamRule>> = {
  sleep_sessions: { scores: 'yes', engine: 'yes', recommend: { imported: true, scores: true, engine: true } },
  heart_rate: { scores: 'yes', engine: 'yes', recommend: { imported: true, scores: true, engine: true } },
  hrv: { scores: 'yes', engine: 'yes', recommend: { imported: true, scores: true, engine: false } },
  spo2: { scores: 'yes', engine: 'never', recommend: { imported: true, scores: true, engine: false } },
  skin_temp: { scores: 'yes', engine: 'yes', recommend: { imported: true, scores: true, engine: false } },
  steps: { scores: 'na', engine: 'yes', recommend: { imported: true, scores: false, engine: true } },
  workouts: { scores: 'na', engine: 'yes', recommend: { imported: true, scores: false, engine: true } },
  weight: { scores: 'na', engine: 'yes', recommend: { imported: true, scores: false, engine: true } },
  body_fat: { scores: 'na', engine: 'yes', recommend: { imported: true, scores: false, engine: true } },
  vendor_scores: { scores: 'never', engine: 'never', recommend: { imported: false, scores: false, engine: false } },
};

export const offPolicy = (stream: StreamId): StreamPolicy => ({ stream, imported: false, coach: 'hidden', engine: false, scores: false });
export const recommendedPolicy = (stream: StreamId): StreamPolicy => {
  const r = STREAM_RULES[stream];
  return { stream, imported: r.recommend.imported, scores: r.recommend.imported && r.recommend.scores, engine: r.recommend.imported && r.recommend.engine, coach: 'hidden' };
};

/** Streams the named devices offer, in display order. */
export function streamsFor(has: readonly DeviceKind[]): StreamId[] {
  const set = new Set(has.flatMap((d) => DEVICE_STREAMS[d] ?? []));
  return STREAM_ORDER.filter((s) => set.has(s));
}

/** One cell change, keeping the rules: off "bring in" clears the other columns; "never" cells stay false. */
export function setCell(p: StreamPolicy, col: 'imported' | 'scores' | 'engine' | 'coach', value: boolean | CoachVisibility): StreamPolicy {
  const r = STREAM_RULES[p.stream];
  if (col === 'imported') return value ? { ...p, imported: true } : offPolicy(p.stream);
  if (!p.imported) return p;
  if (col === 'coach') return { ...p, coach: value as CoachVisibility };
  if (r[col] !== 'yes') return p;
  return { ...p, [col]: Boolean(value) };
}

/** "Coach can see daily summaries": every imported stream becomes 'daily' (detail stays as chosen). */
export function coachDaily(list: readonly StreamPolicy[]): StreamPolicy[] {
  return list.map((p) => (p.imported && p.coach === 'hidden' ? { ...p, coach: 'daily' } : p));
}

export type RouteKind = 'healthConnect' | 'direct' | 'directUnavailable' | 'iphone' | 'file' | 'scale';

/** How a device's data would reach Vitals (computed, not asked). */
export function routeOf(device: DeviceKind, brand: string, platform: Platform | undefined, bluetooth: boolean): RouteKind {
  if (device === 'scale') return 'scale';
  if (platform === 'ios') return 'iphone';
  const directCapable = device === 'ring' && /colmi|j-?style/i.test(brand);
  if (directCapable) return bluetooth ? 'direct' : 'directUnavailable';
  if (platform === 'android') return 'healthConnect';
  return 'file';
}

export function routeText(kind: RouteKind, brand: string): string {
  const name = brand && brand !== D.which.notSure && brand !== 'other' ? brand : 'device';
  switch (kind) {
    case 'healthConnect':
      return D.route.healthConnect(name);
    case 'direct':
      return D.route.direct;
    case 'directUnavailable':
      return `${D.route.file(name)} ${D.route.noBluetooth}`;
    case 'iphone':
      return D.route.iphone;
    case 'scale':
      return D.route.scale;
    case 'file':
      return D.route.file(name);
  }
}

const has = (v: Readonly<Record<string, unknown>>) => (Array.isArray(v.has) ? (v.has as DeviceKind[]) : []).filter((d) => d !== 'none');

export const DEVICES_QUESTIONS: readonly Question[] = [
  {
    id: 'has',
    chapter: 'devices',
    section: 'devices',
    anchor: 'devices',
    kind: 'multi',
    required: true,
    prompt: D.has.prompt,
    short: D.has.short,
    skipText: D.has.skip,
    options: DEVICE_KINDS.map((d) => ({ value: d, label: D.has.options[d], ...(d === 'none' ? { exclusive: true } : {}) })),
  },
  {
    id: 'models',
    parent: 'has',
    chapter: 'devices',
    section: 'devices',
    kind: 'custom',
    widget: 'models',
    prompt: D.which.prompt,
    short: D.which.short,
    skipText: D.which.skip,
    applies: (v) => has(v).some((d) => BRANDED.includes(d)),
    receipt: (v) =>
      Object.entries((v ?? {}) as Record<string, string>)
        .map(([d, b]) => `${D.has.options[d as DeviceKind]}: ${b}`)
        .join(' · '),
  },
  {
    id: 'platform',
    parent: 'has',
    chapter: 'devices',
    section: 'devices',
    kind: 'single',
    prompt: D.platform.prompt,
    short: D.platform.short,
    skipText: D.platform.skip,
    applies: (v) => has(v).length > 0,
    options: (['android', 'ios', 'desktop'] as const).map((p) => ({ value: p, label: D.platform.options[p] })),
  },
  {
    id: 'routes',
    parent: 'has',
    chapter: 'devices',
    section: 'devices',
    kind: 'custom',
    widget: 'routes',
    prompt: D.route.prompt,
    short: D.route.short,
    skipText: D.route.later.toLowerCase(),
    applies: (v) => has(v).some((d) => BRANDED.includes(d)),
    receipt: () => D.route.later.toLowerCase(),
  },
  {
    id: 'streams',
    parent: 'has',
    chapter: 'devices',
    section: 'devices',
    anchor: 'streams',
    kind: 'custom',
    widget: 'streams',
    prompt: D.matrix.prompt,
    short: D.matrix.short,
    skipText: D.matrix.skip,
    applies: (v) => has(v).length > 0,
    receipt: (v) => {
      const list = ((v ?? []) as StreamPolicy[]).filter((p) => p.imported);
      if (!list.length) return D.matrix.skip.split(' (')[0]!;
      return list.map((p) => D.matrix.streams[p.stream]).join(', ');
    },
  },
];

/** Answers → devices + stream policies (pure). Skipped or unanswered streams are all off. */
export function reduceDevices(a: ChapterAnswers, ctx: FlowContext): StreamOptIns {
  const v = usedValues(DEVICES_QUESTIONS, a, ctx);
  const list = Array.isArray(v.has) ? (v.has as DeviceKind[]) : [];
  const models = (v.models ?? {}) as Partial<Record<DeviceKind, string>>;
  const devices: DevicesAnswer = {
    has: list.length ? [...list] : [],
    models: list.filter((d) => BRANDED.includes(d)).map((d) => models[d] ?? D.which.notSure),
    platforms: typeof v.platform === 'string' ? [v.platform as Platform] : [],
  };
  const offered = streamsFor(list);
  const chosen = new Map(((v.streams ?? []) as StreamPolicy[]).map((p) => [p.stream, p]));
  const policies = offered.map((s) => {
    const p = chosen.get(s);
    if (!p) return offPolicy(s);
    // re-apply the rules on the way out (a stored "never" cell can never come back true)
    let out = offPolicy(s);
    if (p.imported) {
      out = setCell(out, 'imported', true);
      out = setCell(out, 'scores', p.scores);
      out = setCell(out, 'engine', p.engine);
      out = setCell(out, 'coach', p.coach);
    }
    return out;
  });
  return { devices, policies };
}

/** A step-counting device was named (walking commute minutes are counted by it). */
export const hasStepDevice = (d: DevicesAnswer | undefined): boolean => Boolean(d?.has.some((x) => x === 'ring' || x === 'watch' || x === 'band'));
