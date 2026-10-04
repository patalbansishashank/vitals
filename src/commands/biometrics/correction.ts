/**
 * Corrections of device values (SUITE_SPEC §14.6 b), the pure part: validating a `biometrics.correct` input, finding
 * the device record a correction replaces, and mapping the old logging commands (`log.sleep`, `log.steps`,
 * `log.measurement`, `bio.manual`) onto a correction input for a stream a device owns (§14.6 a).
 */
import { correctionKey, DAILY_METRIC_GROUPS, isManualSource, metricOfTarget, resolveDays, type SourcedRecord } from '@/biometrics/core/resolve';
import { validateBatch } from '@/biometrics/core/validate';
import { localDateOf } from '@/biometrics/importers/util';
import { BIO_SCHEMA, type BioSourceDoc, type CorrectionTarget, type CorrectionValue, type DailyRecord, type LocalDate, type SpotMetric } from '@/biometrics/core/types';
import type { OwnedFamily } from '@/biometrics/core/policy';

export interface CorrectInput {
  target: CorrectionTarget;
  value: CorrectionValue;
  note?: string;
}

/** The family a correction target belongs to (null: no device can own it, e.g. waist or blood pressure). */
export function familyOfTarget(t: CorrectionTarget): OwnedFamily | null {
  if (t.kind === 'sleep') return 'sleep_sessions';
  if (t.kind === 'daily') return t.metric === 'steps' ? 'steps' : t.metric === 'resting_hr_bpm' ? 'resting_hr' : t.metric === 'hrv' ? 'hrv' : null;
  if (t.metric === 'weight_kg' || t.metric === 'body_fat_pct') return 'body';
  if (t.metric === 'hrv_ms') return 'hrv';
  return null;
}

/** Why a correction input cannot be stored, or null. Plain words for the person (and the Coach). */
export function checkCorrection(input: CorrectInput, today: LocalDate): { message: string; path: string } | null {
  const t = input.target;
  if (t.localDate > today) return { message: 'That date is in the future.', path: '/target/localDate' };
  const v = input.value;
  if (t.kind === 'sleep') {
    if (!('asleepS' in v)) return { message: 'A night needs the time asleep (asleepS).', path: '/value' };
    if (!(v.asleepS > 0 && v.asleepS <= 24 * 3600)) return { message: 'Time asleep must be between 0 and 24 hours.', path: '/value/asleepS' };
    if (v.bedAt && v.wakeAt) {
      const span = (Date.parse(v.wakeAt) - Date.parse(v.bedAt)) / 1000;
      if (!(span > 0)) return { message: 'Bedtime must be before the wake time.', path: '/value/bedAt' };
      if (v.asleepS > span + 60) return { message: 'Time asleep cannot be longer than the time in bed.', path: '/value/asleepS' };
    }
    return null;
  }
  if (t.kind === 'daily') {
    if (!('fields' in v)) return { message: 'A daily total needs its fields.', path: '/value' };
    const allowed = DAILY_METRIC_GROUPS[t.metric];
    if (!allowed) return { message: `“${t.metric}” is not a daily metric Vitals keeps.`, path: '/target/metric' };
    const keys = Object.keys(v.fields);
    if (keys.length === 0) return { message: 'Give at least one value.', path: '/value/fields' };
    const extra = keys.filter((k) => !(allowed as readonly string[]).includes(k));
    if (extra.length) return { message: `For ${t.metric} give only: ${allowed.join(', ')}.`, path: '/value/fields' };
    const rec = { kind: 'daily', record_id: 'check', version: 1, time: { tz_offset_s: 0, local_date: t.localDate }, provenance: PROV, quality: QUAL, ...v.fields };
    return plausible(rec);
  }
  if (!('value' in v)) return { message: 'A reading needs its value.', path: '/value' };
  const at = t.at ?? `${t.localDate}T12:00:00.000Z`;
  return plausible({ kind: 'spot', record_id: 'check', version: 1, metric: t.metric, value: v.value, time: { at, tz_offset_s: 0, local_date: t.localDate }, provenance: PROV, quality: QUAL });
}

const PROV = { channel: 'manual', recording_method: 'manual', modality: 'self_reported', ingested_at: '2026-01-01T00:00:00.000Z' } as const;
const QUAL = { validation: 'self_reported', confidence: null, flags: [] } as const;

function plausible(rec: Record<string, unknown>): { message: string; path: string } | null {
  const chk = validateBatch({ schema: BIO_SCHEMA, producer: { name: 'vitals-correction', version: '1' }, exported_at: PROV.ingested_at, tz: 'UTC', records: [rec] });
  const ok = chk.batch && chk.batch.records.length === 1 && chk.rejected.length === 0 && !(chk.batch.records[0]!.quality.flags ?? []).includes('out_of_range');
  return ok ? null : { message: 'That value is outside what a body can measure.', path: '/value' };
}

/** The device record a correction at `target` replaces (the resolved device view of that day, no corrections), or null. */
export function deviceRecordFor(
  target: CorrectionTarget,
  records: readonly SourcedRecord[],
  sources: readonly BioSourceDoc[],
): { sourceKey: string; recordId: string; version: number } | null {
  const devices = records.filter((r) => !isManualSource(r.sourceKey, r.record) && r.record.time.local_date === target.localDate);
  const day = resolveDays(devices, sources, { from: target.localDate, to: target.localDate })[0];
  if (!day) return null;
  const metric = metricOfTarget(target);
  const sk = day.sourceByMetric[metric];
  if (!sk) return null;
  if (target.kind === 'sleep') return day.mainSleep ? { sourceKey: sk, recordId: day.mainSleep.record_id, version: day.mainSleep.version } : null;
  if (target.kind === 'daily') {
    const fields = DAILY_METRIC_GROUPS[target.metric] ?? [];
    const rec = devices
      .filter((r) => r.sourceKey === sk && r.record.kind === 'daily' && fields.some((f) => (r.record as DailyRecord)[f] !== undefined))
      .sort((a, b) => b.record.version - a.record.version)[0];
    return rec ? { sourceKey: sk, recordId: rec.record.record_id, version: rec.record.version } : null;
  }
  const spots = day.spots.filter((s) => s.metric === target.metric);
  const s = target.at ? spots.find((x) => x.time.at === target.at) : spots[spots.length - 1];
  return s ? { sourceKey: sk, recordId: s.record_id, version: s.version } : null;
}

export { correctionKey };

/* ---------------------------------------------------------------- old logging commands → a correction */

const MANUAL_ALIASES: Record<string, string> = { weight: 'weight_kg', body_fat: 'body_fat_pct', resting_hr: 'resting_hr_bpm', hrv: 'hrv_ms', sleep: 'sleep_h' };

/** The correction an entry by hand stands for, with the family that decides whether a device owns it; null when the
 * command logs something no device can own (a waist, a blood pressure, a VO2max test). */
export function correctionFromLog(id: string, input: Record<string, unknown>, at: { today: LocalDate; tz: string }): { family: OwnedFamily; input: CorrectInput } | null {
  const date = (typeof input.date === 'string' ? input.date : at.today) as LocalDate;
  const note = typeof input.note === 'string' ? { note: input.note.slice(0, 500) } : {};
  const spot = (metric: SpotMetric, value: number, family: OwnedFamily) => ({ family, input: { target: { kind: 'spot' as const, localDate: date, metric }, value: { value }, ...note } });
  switch (id) {
    case 'log.sleep': {
      const bedAt = String(input.bedAt);
      const wakeAt = String(input.wakeAt);
      const asleepS = Math.max(0, Math.round((Date.parse(wakeAt) - Date.parse(bedAt)) / 1000));
      return { family: 'sleep_sessions', input: { target: { kind: 'sleep', localDate: localDateOf(Date.parse(wakeAt), at.tz), }, value: { asleepS, bedAt, wakeAt } } };
    }
    case 'log.steps':
      return { family: 'steps', input: { target: { kind: 'daily', localDate: date, metric: 'steps' }, value: { fields: { steps: Number(input.steps) } } } };
    case 'log.measurement': {
      // `log.measurement` converts pounds and refuses other units; the correction takes the same number, so "180 lb" is not 180 kg
      const u = typeof input.unit === 'string' ? input.unit.trim().toLowerCase().replace(/\s+/g, '') : '';
      const lb = ['lb', 'lbs', 'pound', 'pounds'].includes(u);
      if (input.metric === 'weightKg') return u && u !== 'kg' && !lb ? null : spot('weight_kg', Number(input.value) * (lb ? 0.45359237 : 1), 'body'); // another unit: the command itself refuses it
      if (input.metric === 'bodyFatPct') return spot('body_fat_pct', Number(input.value), 'body');
      return null;
    }
    case 'bio.manual': {
      const metric = MANUAL_ALIASES[String(input.metric)] ?? String(input.metric);
      const value = Number(input.value);
      if (metric === 'sleep_h') return { family: 'sleep_sessions', input: { target: { kind: 'sleep', localDate: date }, value: { asleepS: Math.round(value * 3600) }, ...note } };
      if (metric === 'steps') return { family: 'steps', input: { target: { kind: 'daily', localDate: date, metric: 'steps' }, value: { fields: { steps: Math.round(value) } }, ...note } };
      if (metric === 'resting_hr_bpm') return { family: 'resting_hr', input: { target: { kind: 'daily', localDate: date, metric: 'resting_hr_bpm' }, value: { fields: { resting_hr_bpm: value } }, ...note } };
      if (metric === 'weight_kg') return spot('weight_kg', value, 'body');
      if (metric === 'body_fat_pct') return spot('body_fat_pct', value, 'body');
      if (metric === 'hrv_ms') return spot('hrv_ms', value, 'hrv');
      return null;
    }
    default:
      return null;
  }
}
