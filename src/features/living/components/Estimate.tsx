/**
 * <SourceChip> and <EstimateReadout> (COMPONENTS §13.12): every estimated, logged-by-AI, measured or projected value
 * renders as value + likely range (80 %) + source. AI-estimated and photo values always use "≈".
 */
import { Chip, Tooltip, cx, formatNumber, EN_DASH, energyInText, toEnergyUnit } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { likely } from '../format';

export interface SourceInfo {
  /** "you · typed", "you · as planned", "Coach · photo", "ring · Colmi R10", "assumed". */
  label: string;
  /** Method sentence for the popover ("Coach was fairly sure: 0.72"). */
  detail?: string;
  /** "photo only: about ±35 % for energy". */
  band?: string;
  assumed?: boolean;
}

export function SourceChip({ source, className }: { source: SourceInfo; className?: string }) {
  const chip = (
    <span>
      <Chip className={cx('lv-source', source.assumed && 'is-assumed', className)}>{source.label}</Chip>
    </span>
  );
  if (!source.detail && !source.band) return chip;
  return <Tooltip content={[source.detail, source.band].filter(Boolean).join(' · ')}>{chip}</Tooltip>;
}

export interface EstimateReadoutProps {
  value: number;
  /** Standard deviation of the estimate; the range shown is P50 ± 1.28 SD. */
  sd?: number;
  /** Explicit range instead of SD. */
  range?: { lo: number; hi: number };
  unit: string;
  decimals?: number;
  /** "≈" prefix (AI or photo estimates, logged meals). */
  approx?: boolean;
  source?: SourceInfo;
  /** Short row form `≈ 640 kcal (510–780)` vs long `≈ 640 kcal (likely 510–780)`. */
  short?: boolean;
  className?: string;
}

export function EstimateReadout({ value: v0, sd, range, unit: u0, decimals = 0, approx, source, short, className }: EstimateReadoutProps) {
  // energy values arrive in kcal; show them in the person's unit (Settings › Units › energy), unit text included
  const eu = useEnergyUnit();
  const conv = eu === 'kJ' && /\bkcal\b/.test(u0);
  const toU = (x: number) => (conv ? Math.round(toEnergyUnit(x, eu) / 10) * 10 : x);
  const unit = conv ? energyInText(u0, eu).replace(/\bkcal\b/g, 'kJ') : u0;
  const value = toU(v0);
  const r0 = range ?? (sd !== undefined && sd > 0 ? likely(v0, sd) : null);
  const r = r0 ? { lo: toU(r0.lo), hi: toU(r0.hi) } : null;
  return (
    <span className={cx('lv-est', className)}>
      <span className="lm-num">
        {approx ? '≈ ' : ''}
        {formatNumber(value, decimals)}
      </span>
      <span className="lm-unit"> {unit}</span>
      {r ? (
        <span className="lv-est__range">
          {' '}
          ({short ? '' : 'likely '}
          {formatNumber(r.lo, decimals)}
          {EN_DASH}
          {formatNumber(r.hi, decimals)})
        </span>
      ) : null}
      {source ? <SourceChip source={source} /> : null}
    </span>
  );
}

/** Source label for an entry (E5 `EntrySource` → chip text). */
export function sourceLabel(by: string, method?: string): string {
  const who = by === 'ai' ? 'Coach' : by === 'device' ? 'device' : by === 'import' ? 'import' : by === 'system' ? 'the plan' : 'you';
  const how: Record<string, string> = {
    typed: 'typed',
    asPlanned: 'as planned',
    aiText: 'text',
    aiPhoto: 'photo',
    aiPhotoUserGrams: 'photo + your grams',
    label: 'label',
    dbMatch: 'from the food table',
    biometrics: 'measured',
    import: 'imported',
    backfill: 'assumed',
  };
  if (method === 'backfill') return 'assumed';
  return method && how[method] ? `${who} · ${how[method]}` : who;
}
