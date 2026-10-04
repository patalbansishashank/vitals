/**
 * The live `ScoresSource` (E13 contract, `../data/scores.ts`; design/screens/scores.md) over E10's stored score results
 * (`bioScores`), source documents and decision log, through the shared synchronous `BioDocIndex` of the app's
 * document store. It replaces `stubScoresSource` (synthetic numbers) once mounted (`LiveScoresProvider`).
 *
 * Honest by construction: with no results it answers no tiles, no detail and no "more" list (the strip shows its
 * "No body signals yet" state); a withheld score shows no value; nothing is computed here that the score did not
 * report (only window means of reported values for the 7- and 28-day scopes). Score definitions (titles, formula
 * text, evidence, plan effects, versions) come from E10's catalogue, loaded lazily so the scoring code stays out of
 * the first paint; until it loads, tiles use plain titles and the detail lacks the formula.
 */
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex, type BioDocIndex, type BioDocSource, type IndexedRecord } from '@/biometrics/store/docIndex';
import { personMatrix } from '@/biometrics/core/effective';
import { scoreAllowed } from '@/biometrics/core/policy';
import type { ScoreDef, ScoreResult, VendorOpinion } from '@/biometrics/core/types';
import { addDays, daysBetween } from '@/living/dates';
import { fmtDayMonth } from '../format';
import type { LocalDate } from '@/living';
import type { ScoreHistoryData } from '@/features/charts/living/types';
import { currentDay, systemClock } from '../clock';
import { scoreCopy, type ScoreDetailModel, type ScoreMoreItem, type ScoreScope, type ScoresSource, type ScoreTileModel } from '../data/scores';

export interface LiveScoresOptions {
  /** The document store whose biometrics documents to read (default: the app's current one). */
  store?: () => BioDocSource;
  /** Today's plan day (default: the system clock with the 04:00 rollover). */
  today?: () => LocalDate;
  /** E10's score catalogue (default: a lazy import). */
  loadDefs?: () => Promise<readonly ScoreDef[]>;
}

/** Tiles of the Progress strip, in this order; Today shows the first three plus an active flag. */
/** Maintainer references in score definitions: research-note citations, section signs, rule/work-package ids, model node names. */
const INTERNAL_REF = /\bdossiers?\b|§|\bR-[A-Z]{2,}|\bWP\d|\b[A-Za-z]+_[A-Za-z]+\b|\bPROPOSED\b/;

/**
 * Score-definition text made fit for the screen: parentheticals that cite internal references are dropped, and so is
 * any sentence that still names one.
 */
export function userText(text: string): string {
  return text
    .replace(/\s*\([^()]*\)/g, (m) => (INTERNAL_REF.test(m) ? '' : m))
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !INTERNAL_REF.test(sentence))
    .join(' ')
    .trim();
}

/** A stream or window id in words: `sleep_sessions` → "sleep sessions", `hr.rhr_night` → "hr rhr night". */
const plainId = (id: string): string => id.replace(/[_.]+/g, ' ');

/** "last data 30 Sep · 2 days old" — the date and age of a result older than the chosen window. */
export function staleLine(date: LocalDate, today: LocalDate): string {
  const n = daysBetween(date, today);
  return `last data ${fmtDayMonth(date)} · ${n} ${n === 1 ? 'day' : 'days'} old`;
}

export const PRIMARY_SCORES = ['sleep.tst', 'hrv.status', 'hr.rhr_night', 'illness.nightsignal', 'fitness.vo2max', 'readiness.index'] as const;
const TODAY_SCORES = new Set<string>(['sleep.tst', 'hrv.status', 'hr.rhr_night']);
const HISTORY_DAYS = 120;

/** Plain, lowercase tile titles (design/screens/scores.md §3.1); others use the definition's title. */
const PLAIN_TITLE: Record<string, string> = {
  'sleep.tst': 'sleep',
  'sleep.index': 'sleep index',
  'sleep.se_spt': 'sleep efficiency',
  'sleep.waso': 'awake in the night',
  'sleep.midpoint': 'sleep timing',
  'sleep.sri': 'sleep regularity',
  'sleep.debt': 'sleep debt',
  'sleep.sjl': 'weekend shift',
  'sleep.msf_sc': 'chronotype',
  'hrv.status': 'hrv status',
  'hrv.ln_rmssd_night': 'nightly hrv',
  'hrv.strain_accumulating': 'hrv strain',
  'hr.rhr_night': 'resting heart rate',
  'illness.nightsignal': 'illness watch',
  'overreaching.flag': 'overreaching watch',
  'autonomic.deviation': 'autonomic load',
  'temp.deviation': 'temperature change',
  'fitness.vo2max': 'cardio fitness',
  'readiness.index': 'readiness',
  'load.trimp': 'training load',
  'load.srpe': 'session load',
  'load.ewma': 'load trend',
};

const FLAG_WORD = { yellow: 'worth watching', amber: 'signs of strain', red: 'strong signs of strain' } as const;
const STATE_WORD: Record<string, string> = { below: 'below your normal', within: 'within your normal', above: 'above your normal' };
const TIER_TEXT = {
  A: 'tier A — checked against medical devices.',
  B: 'tier B — partly checked.',
  C: 'tier C — not independently checked. Heart-rate variability, autonomic load, SpO2 and temperature are shown only as change from your own normal.',
} as const;

const titleOf = (id: string, def?: ScoreDef): string => PLAIN_TITLE[id] ?? (def ? def.title.replace(/\s*\(.*\)\s*$/, '').toLowerCase() : id);
const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).replace(/\bhrv\b/g, 'HRV');
const shortVersion = (v: string): string => `v${v.split('.').slice(0, 2).join('.')}`;

function newer(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const KIND: Record<ScoreDef['label'], ScoreTileModel['kind']> = { measurement: 'measurement', estimate: 'estimate', convenience_index: 'index', flag: 'flag' };

function decimalsOf(unit: string, value: number | null): number {
  if (unit === '°C' || unit === 'h') return 1;
  return value !== null && Math.abs(value) < 10 && unit !== 'bpm' ? 1 : 0;
}

function deviceOf(ix: BioDocIndex, r: ScoreResult): ScoreTileModel['device'] | undefined {
  const sk = typeof r.detail?.['sourceKey'] === 'string' ? (r.detail['sourceKey'] as string) : undefined;
  const src = sk ? ix.source(sk) : undefined;
  if (!src) return undefined;
  const t = src.deviceType ?? ix.deviceTypes.get(src.sourceKey);
  const kind = t === 'ring' || t === 'watch' || t === 'scale' || t === 'phone' ? t : t === 'band' ? 'watch' : null;
  return kind ? { kind, name: src.label, tier: src.tier } : undefined;
}

/** Newest version per (score, day) of non-workout results; `byScore` ascending by date. */
function latestResults(ix: BioDocIndex): Map<string, ScoreResult[]> {
  const best = new Map<string, ScoreResult>();
  for (const r of ix.scores()) {
    if (r.scope.kind === 'workout') continue;
    const k = `${r.scoreId}|${r.scope.localDate}`;
    const p = best.get(k);
    if (!p || newer(r.version, p.version) > 0) best.set(k, r);
  }
  const by = new Map<string, ScoreResult[]>();
  for (const r of best.values()) {
    const a = by.get(r.scoreId);
    if (a) a.push(r);
    else by.set(r.scoreId, [r]);
  }
  for (const a of by.values()) a.sort((x, y) => x.scope.localDate.localeCompare(y.scope.localDate));
  return by;
}

function tileOf(ix: BioDocIndex, r: ScoreResult, def: ScoreDef | undefined, scope: ScoreScope, window: ScoreResult[]): ScoreTileModel {
  const unit = def?.output.unit === 'h_local' ? 'h' : def?.output.unit ?? '';
  const display: ScoreTileModel['display'] = def?.output.display ?? (r.value === null ? 'state' : 'number');
  const kind: ScoreTileModel['kind'] = def ? KIND[def.label] : r.state && r.state in FLAG_WORD ? 'flag' : 'measurement';
  const withheld = r.status === 'withheld';
  let value = withheld || r.value === null || !Number.isFinite(r.value) ? null : r.value;
  const t: ScoreTileModel = {
    scoreId: r.scoreId,
    title: titleOf(r.scoreId, def),
    version: shortVersion(r.version),
    grade: def?.evidence.certainty ?? 'C',
    kind,
    display,
    status: r.status,
    value,
    unit,
    decimals: decimalsOf(unit, value),
  };
  const device = deviceOf(ix, r);
  if (device) t.device = device;
  if (kind === 'flag') {
    const lvl = r.state as keyof typeof FLAG_WORD | undefined;
    if (lvl && lvl in FLAG_WORD) {
      t.flag = { level: lvl, word: FLAG_WORD[lvl] };
      const nights = r.detail?.['nights'];
      if (typeof nights === 'number' && nights > 0) t.flag.nights = nights;
      t.state = FLAG_WORD[lvl];
    } else t.state = 'nothing to watch';
    return t;
  }
  if (r.state) t.state = STATE_WORD[r.state] ?? r.state;
  if (withheld) return t;
  const weekly = scope === '7d' || scope === '28d';
  if (weekly && display === 'number') {
    const vals = window.filter((x) => x.status === 'ok' && x.value !== null && Number.isFinite(x.value)).map((x) => x.value!);
    if (vals.length > 0) {
      value = vals.reduce((a, b) => a + b, 0) / vals.length;
      t.value = value;
      t.line = `${scope === '28d' ? 28 : 7}-day average · ${vals.length} ${vals.length === 1 ? 'day' : 'days'}`;
    }
  } else if (r.band && Number.isFinite(r.band.lo) && Number.isFinite(r.band.hi)) t.band = { lo: r.band.lo, hi: r.band.hi };
  if (r.status === 'insufficient_baseline') {
    const have = r.detail?.['nights'];
    const needed = r.detail?.['nightsNeeded'];
    if (typeof have === 'number' && typeof needed === 'number') t.baselineForming = { have, needed };
  }
  return t;
}

function historyOf(results: ScoreResult[], today: LocalDate, unit: string, decimals: number): ScoreHistoryData {
  const start = addDays(today, -(HISTORY_DAYS - 1));
  const at = new Map(results.map((r) => [r.scope.localDate, r] as const));
  const nightly: number[] = [];
  const versions: Array<{ day: number; label: string }> = [];
  let lastV: string | null = null;
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = addDays(start, i);
    const r = at.get(d);
    nightly.push(r && r.status !== 'withheld' && r.value !== null && Number.isFinite(r.value) ? r.value : Number.NaN);
    if (r) {
      const v = shortVersion(r.version);
      if (lastV !== null && v !== lastV) versions.push({ day: i, label: `${v} from ${d}` });
      lastV = v;
    }
  }
  const mean7 = nightly.map((_, i) => {
    const win = nightly.slice(Math.max(0, i - 6), i + 1).filter(Number.isFinite);
    return win.length >= 3 ? win.reduce((a, b) => a + b, 0) / win.length : Number.NaN;
  });
  return { startDate: start, days: HISTORY_DAYS, unit, decimals, nightly, mean7, category: 'recovery', ...(versions.length ? { versions } : {}) };
}

function readingOf(t: ScoreTileModel, r: ScoreResult): string[] {
  const out: string[] = [];
  if (r.status === 'withheld') out.push(r.reason ? `no value yet: ${r.reason}` : 'no value yet');
  else if (t.flag) out.push(t.flag.word);
  else if (t.value !== null) out.push(`${r.scope.localDate}: ${t.value.toFixed(t.decimals)}${t.unit ? ` ${t.unit}` : ''}${t.band ? ` (likely ${t.band.lo.toFixed(t.decimals)}–${t.band.hi.toFixed(t.decimals)})` : ''}`);
  else if (t.state) out.push(t.state);
  if (r.status === 'insufficient_baseline') out.push(r.reason ? `normal range forming: ${r.reason}` : 'normal range forming');
  return out;
}

/** Which of our tiles a vendor opinion sits beside (scores.md §10: ours leads, the vendor's follows, labelled). */
const VENDOR_BESIDE: Record<keyof VendorOpinion, string> = {
  readiness: 'readiness.index',
  recovery: 'readiness.index',
  body_battery: 'readiness.index',
  sleep: 'sleep.tst',
  stress: 'hrv.status',
  strain: 'load.trimp',
};
const VENDOR_WORD: Record<keyof VendorOpinion, string> = {
  readiness: 'readiness',
  recovery: 'recovery',
  body_battery: 'body battery',
  sleep: 'sleep',
  stress: 'stress',
  strain: 'strain',
};

/** "readiness 62 of 100", in the vendor's own scale. */
function vendorPhrase(k: keyof VendorOpinion, v: VendorOpinion[keyof VendorOpinion]): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return `${VENDOR_WORD[k]} ${v}${k === 'strain' ? '' : ' of 100'}`;
  if (v && typeof v === 'object' && Number.isFinite(v.value)) {
    const max = /^0-(\d+)$/.exec(v.scale)?.[1];
    return `${VENDOR_WORD[k]} ${v.value}${max ? ` of ${max}` : ''}`;
  }
  return null;
}

/**
 * Vendor opinions from imported daily records, beside our tiles — only when the person turned the vendor-scores stream
 * on (off by default). Never an input to anything; an opinion whose own tile is not shown goes beside the first tile.
 */
function attachVendor(ix: BioDocIndex, tiles: ScoreTileModel[], dates: ReadonlyMap<string, LocalDate>): void {
  if (!tiles.length || ix.personPolicies.find((p) => p.stream === 'vendor_scores')?.imported !== true) return;
  const says = new Map<ScoreTileModel, { name: string; parts: string[] }>();
  const byDate = new Map<LocalDate, IndexedRecord[]>();
  for (const t of tiles) {
    const date = dates.get(t.scoreId);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, ix.latestRecords(date, date));
    for (const { sourceKey, record } of byDate.get(date)!) {
      if (record.kind !== 'daily' || !record.vendor) continue;
      const name = ix.source(sourceKey)?.label ?? 'Your device';
      for (const [k, v] of Object.entries(record.vendor) as Array<[keyof VendorOpinion, VendorOpinion[keyof VendorOpinion]]>) {
        const home = VENDOR_BESIDE[k];
        const target = home === t.scoreId ? t : !tiles.some((x) => x.scoreId === home) && t === tiles[0] ? t : null;
        const phrase = target ? vendorPhrase(k, v) : null;
        if (!target || !phrase) continue;
        const e = says.get(target) ?? { name, parts: [] };
        if (home === t.scoreId) e.parts.unshift(phrase);
        else e.parts.push(phrase);
        says.set(target, e);
      }
    }
  }
  for (const [t, e] of says) t.vendor = { name: e.name, says: e.parts.join(' · ') };
}

/** The live source (see the module comment). */
export function createLiveScoresSource(o: LiveScoresOptions = {}): ScoresSource & { dispose(): void; defsReady(): Promise<void> } {
  const store = o.store ?? getDocumentStore;
  const today = o.today ?? (() => currentDay(systemClock));
  const load = o.loadDefs ?? (async () => (await import('@/biometrics/core/scores/catalogue')).SCORE_CATALOGUE);
  const listeners = new Set<() => void>();
  let defs: readonly ScoreDef[] | null = null;
  let defsP: Promise<void> | null = null;
  let rev = 0;
  let attached: { ix: BioDocIndex; off: () => void } | null = null;
  let cache: { key: string; tiles: Map<ScoreScope, ScoreTileModel[]>; details: Map<string, ScoreDetailModel | null>; more: ScoreMoreItem[] | null; by: Map<string, ScoreResult[]> } | null = null;

  const notify = () => {
    rev++;
    for (const l of listeners) l();
  };
  const ensureDefs = (): Promise<void> => {
    defsP ??= load().then(
      (d) => {
        defs = d;
        notify();
      },
      (e) => console.warn('Vitals: score definitions did not load', e),
    );
    return defsP;
  };
  /** The index of the current store, re-attached when the app swaps its document store. */
  const index = (): BioDocIndex => {
    const ix = sharedBioIndex(store());
    if (attached?.ix !== ix) {
      attached?.off();
      attached = { ix, off: ix.subscribe(notify) };
      rev++;
    }
    return ix;
  };
  const defOf = (id: string, version?: string): ScoreDef | undefined => {
    if (!defs) return undefined;
    const all = defs.filter((d) => d.scoreId === id);
    return (version ? all.find((d) => d.version === version) : undefined) ?? all.sort((a, b) => newer(b.version, a.version))[0];
  };
  const state = () => {
    const ix = index();
    const key = `${rev}|${ix.revision()}|${today()}`;
    if (!cache || cache.key !== key) {
      cache = { key, tiles: new Map(), details: new Map(), more: null, by: latestResults(ix) };
      if (cache.by.size > 0 && !defs) void ensureDefs();
    }
    return { ix, c: cache };
  };

  const tiles = (scope: ScoreScope): ScoreTileModel[] => {
    const { ix, c } = state();
    const hit = c.tiles.get(scope);
    if (hit) return hit;
    const d = today();
    const span = scope === '28d' ? 28 : scope === '7d' ? 7 : 2;
    const from = addDays(d, -(span - 1));
    const out: ScoreTileModel[] = [];
    const dates = new Map<string, LocalDate>();
    const ids: string[] = [...PRIMARY_SCORES];
    if (ids.every((id) => !c.by.has(id))) for (const id of c.by.keys()) if (!ids.includes(id)) ids.push(id);
    for (const id of ids) {
      const all = (c.by.get(id) ?? []).filter((r) => r.scope.localDate <= d);
      let window = all.filter((r) => r.scope.localDate >= from);
      // Nothing in this window but older data exists (an import that ends a few days ago): show the latest result with
      // its date and age rather than the "no body signals" empty state. Not on Today, which is about last night only.
      const stale = window.length === 0 && scope !== 'today' ? all[all.length - 1] : undefined;
      if (stale) window = [stale];
      const last = window[window.length - 1];
      if (!last) continue;
      const t = tileOf(ix, last, defOf(id, last.version), stale ? 'lastNight' : scope, window);
      if (stale) t.line = staleLine(stale.scope.localDate, d);
      if (scope === 'today' && !TODAY_SCORES.has(id) && !(t.kind === 'flag' && t.flag)) continue;
      out.push(t);
      dates.set(t.scoreId, last.scope.localDate);
      if (out.length >= 6) break;
    }
    attachVendor(ix, out, dates);
    c.tiles.set(scope, out);
    return out;
  };

  const detail = (scoreId: string): ScoreDetailModel | null => {
    const { ix, c } = state();
    if (c.details.has(scoreId)) return c.details.get(scoreId)!;
    const results = c.by.get(scoreId) ?? [];
    const last = results[results.length - 1];
    let model: ScoreDetailModel | null = null;
    if (last) {
      const def = defOf(scoreId, last.version);
      const tile = tileOf(ix, last, def, 'lastNight', [last]);
      const effects = (def?.planEffects ?? []).filter((e) => e.target !== 'display_only' && e.target !== 'trainer_briefing');
      const copy = scoreCopy(scoreId);
      const src = tile.device ? ix.sources().find((s) => s.label === tile.device!.name) : undefined;
      model = {
        tile,
        heading: sentence(tile.title),
        readings: readingOf(tile, last),
        confidence: last.status === 'withheld' ? null : last.confidence,
        ...(tile.flag && last.reason ? { flagText: last.reason } : {}),
        history: historyOf(results, today(), tile.unit, tile.decimals),
        formula: userText(def?.formula.text ?? ''),
        inputs: (def?.inputs ?? []).map((i) => `${plainId(i.stream)} · ${plainId(i.window)}`),
        evidence: { grade: tile.grade, text: copy?.evidenceText ?? userText(def?.evidence.mechanism.pathway ?? '') },
        planEffects: !effects.length
          ? 'Shown and trended only — no established link to your plan.'
          : copy?.planEffects ?? (userText(effects.map((e) => e.rule).join(' ')) || 'Can change your plan.'),
        changesPlan: effects.length > 0,
        decisions: ix
          .decisions()
          .filter((e) => e.scoreId === scoreId)
          .slice(-10)
          .reverse()
          .map((e) => ({ date: e.at.slice(0, 10), text: e.decision, version: e.version ? shortVersion(e.version) : tile.version, changeId: null })),
        deviceText: src ? `${src.label}: ${TIER_TEXT[src.tier]}` : tile.device ? TIER_TEXT[tile.device.tier] : 'Built from the data you brought in.',
        versions: (defs ?? [])
          .filter((x) => x.scoreId === scoreId)
          .sort((a, b) => newer(b.version, a.version))
          .map((x, i, all) => ({ version: shortVersion(x.version), date: x.released, current: i === 0, text: i === all.length - 1 ? 'first version.' : 'updated.' })),
        ...(def?.kind === 'index' && last.contributors.length
          ? {
              contributors: last.contributors.map((p) => ({
                part: p.id,
                today: p.raw !== undefined ? `${p.raw}${p.unit ? ` ${p.unit}` : ''}` : 'not logged',
                score: p.component ?? null,
                weightSet: p.weightConfigured,
                weightUsed: p.weightApplied,
                available: p.available,
              })),
            }
          : {}),
      };
    }
    c.details.set(scoreId, model);
    return model;
  };

  const more = (): ScoreMoreItem[] => {
    const { ix, c } = state();
    if (c.more) return c.more;
    if (c.by.size === 0) return (c.more = []);
    const shown = new Set(tiles('lastNight').map((t) => t.scoreId));
    const out: ScoreMoreItem[] = [];
    for (const id of c.by.keys()) if (!shown.has(id)) out.push({ scoreId: id, title: titleOf(id, defOf(id)), broughtIn: true });
    if (defs) {
      const matrix = personMatrix(ix.personPolicies);
      const seen = new Set([...shown, ...c.by.keys()]);
      for (const d of defs) {
        if (seen.has(d.scoreId)) continue;
        seen.add(d.scoreId);
        if (!scoreAllowed(d, matrix)) out.push({ scoreId: d.scoreId, title: titleOf(d.scoreId, d), broughtIn: false });
      }
    }
    return (c.more = out);
  };

  return {
    tiles,
    detail,
    more,
    subscribe(l) {
      index();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision() {
      const ix = index();
      return rev * 1_000_003 + ix.revision();
    },
    dispose() {
      attached?.off();
      attached = null;
      listeners.clear();
    },
    defsReady: () => ensureDefs(),
  };
}
