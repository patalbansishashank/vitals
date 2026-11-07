/**
 * The words of the Signals card and the Ring glance (r071), as pure functions: a status word that carries no figure in
 * quiet mode, its tone, and the ranges the fixed-band signals' words stand for ("Normal 50–89 bpm"). The readings of heart
 * rate, blood oxygen and stress are whole numbers, so a band runs to one under the next band's first value.
 */
import type { StateTone } from '@/components';
import { MINUS, formatNumber } from '@/components/lib/format';
import { BANDS, bandIndex, unitOf, type RingMetric, type Status, type UnitPrefs } from './model';

/** A status word with no figure in quiet mode: "Calibrating · night 3 of 7" is "Calibrating" there; other words are as they are. */
export function statusWord(status: Status, quiet: boolean): string {
  return quiet && /\d/.test(status.word) ? status.word.replace(/\s*·.*$/, '') : status.word;
}

/** A status as the foot's and the row's mark: caution and danger keep theirs, ok and info are neutral. */
export const statusTone = (s: Pick<Status, 'severity'>): StateTone => (s.severity === 'danger' ? 'danger' : s.severity === 'caution' ? 'caution' : 'neutral');

export interface BandRow {
  word: string;
  /** "50–89 bpm", "under 50 bpm", "120 bpm and over" */
  range: string;
  severity: Status['severity'];
}

/** The bands of a fixed-band signal as word and range, whole numbers: [] for HRV and skin temperature (read against your own usual). Pure. */
export function bandRows(kind: RingMetric, prefs: UnitPrefs): BandRow[] {
  const bands = BANDS[kind];
  if (!bands) return [];
  const u = unitOf(kind, prefs);
  const n = (v: number) => formatNumber(v, 0).replace('-', MINUS);
  return bands.map((b, i) => {
    const next = bands[i + 1];
    const range = !Number.isFinite(b.from) ? `under ${n(next!.from)} ${u}` : next ? `${n(b.from)}–${n(next.from - 1)} ${u}` : `${n(b.from)} ${u} and over`;
    return { word: b.word, range, severity: b.severity };
  });
}

/** The range of the band a reading sits in ("50–89 bpm"), null for a signal with no fixed bands. Pure. */
export function bandRange(kind: RingMetric, reading: number, prefs: UnitPrefs): string | null {
  const bands = BANDS[kind];
  return bands ? (bandRows(kind, prefs)[bandIndex(bands, reading)]?.range ?? null) : null;
}
