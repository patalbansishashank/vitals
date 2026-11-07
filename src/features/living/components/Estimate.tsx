/**
 * <SourceChip> and <EstimateReadout> (COMPONENTS §13.12): every estimated, logged-by-AI, measured or projected value
 * renders as value + likely range (80 %) + source. AI-estimated and photo values always use "≈".
 *
 * r071: the source chip carries a glyph for how the number was made (a keyboard, a camera, a watch: the words stay, the
 * glyph is never the only signal) and, when it has detail, is a button that opens the (i) panel. The detail used to be a
 * hover-only tooltip that a phone could not read. `EstimateReadout` has a `mono` form: the value in ink and
 * "LIKELY 510–780" as mono meta, for a card's hero line or a sheet's estimate.
 */
import { useState } from 'react';
import { Camera, CircleDashed, CircleDot, ClipboardCheck, Download, Keyboard, Library, MessageCircle, ScanBarcode, Smartphone, Watch } from 'lucide-react';
import { Chip, InfoPanel, MonoMeta, cx, formatNumber, formatRange, energyInText, toEnergyUnit, type IconComponent } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { likely } from '../format';
import { SHARED_INFO } from './copy';
import { infoSpec } from './info';

export interface SourceInfo {
  /** "you · typed", "you · as planned", "Coach · photo", "ring · Colmi R10", "assumed". */
  label: string;
  /** Method sentence for the popover ("Coach was fairly sure: 0.72"). */
  detail?: string;
  /** "photo only: about ±35 % for energy". */
  band?: string;
  assumed?: boolean;
}

/**
 * The glyph of a source: how the number was made, read from the chip's own words ("you · typed", "Coach · photo",
 * "ring · Colmi R10"). The words stay beside it; a glyph is never the only signal.
 */
export function sourceGlyph(label: string): IconComponent {
  const l = label.toLowerCase();
  if (l.includes('assumed')) return CircleDashed;
  if (l.includes('photo')) return Camera;
  if (l.includes('typed')) return Keyboard;
  if (l.includes('as planned') || l.includes('the plan')) return ClipboardCheck;
  if (l.includes('food table')) return Library;
  if (l.includes('label')) return ScanBarcode;
  if (l.includes('text') || l.startsWith('coach')) return MessageCircle;
  if (l.includes('phone')) return Smartphone;
  if (l.includes('ring') || l.includes('device') || l.includes('measured')) return Watch;
  if (l.includes('import')) return Download;
  return CircleDot;
}

/**
 * A chip with the source's glyph and words. With detail ("Coach was fairly sure: 0.72", "photo only: about ±35 % for
 * energy") it is a button that opens the (i) panel: what every source means, then this one's own detail.
 */
export function SourceChip({ source, className }: { source: SourceInfo; className?: string }) {
  const [open, setOpen] = useState(false);
  const icon = sourceGlyph(source.label);
  const cls = cx('lv-source', source.assumed && 'is-assumed', className);
  if (!source.detail && !source.band) {
    return (
      <Chip icon={icon} className={cls}>
        {source.label}
      </Chip>
    );
  }
  const own = [source.detail, source.band].filter(Boolean).join('. ');
  const spec = infoSpec({ ...SHARED_INFO.source, body: [{ body: SHARED_INFO.source.body }, { heading: source.label, body: own }] });
  return (
    <>
      <Chip icon={icon} className={cls} onClick={() => setOpen(true)}>
        {source.label}
      </Chip>
      <InfoPanel {...spec} open={open} onClose={() => setOpen(false)} />
    </>
  );
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
  /** Legacy row-form flag; the `text` form's range always reads `≈ 640 kcal (510–780)` (C6: never "likely"). */
  short?: boolean;
  /** `text` (default): the value, its unit and "(510–780)" in one run. `mono`: the value in ink, "LIKELY 510–780" as mono meta. */
  variant?: 'text' | 'mono';
  className?: string;
}

export function EstimateReadout({ value: v0, sd, range, unit: u0, decimals = 0, approx, source, variant = 'text', className }: EstimateReadoutProps) {
  // energy values arrive in kcal; show them in the person's unit (Settings › Units › energy), unit text included
  const eu = useEnergyUnit();
  const conv = eu === 'kJ' && /\bkcal\b/.test(u0);
  const toU = (x: number) => (conv ? Math.round(toEnergyUnit(x, eu) / 10) * 10 : x);
  const unit = conv ? energyInText(u0, eu).replace(/\bkcal\b/g, 'kJ') : u0;
  const value = toU(v0);
  const r0 = range ?? (sd !== undefined && sd > 0 ? likely(v0, sd) : null);
  const r = r0 ? { lo: toU(r0.lo), hi: toU(r0.hi) } : null;
  if (variant === 'mono')
    return (
      <span className={cx('lv-est lv-est--mono', className)}>
        <span className="lv-est__value">
          <span className="lm-num">
            {approx ? '≈ ' : ''}
            {formatNumber(value, decimals)}
          </span>
          <span className="lm-unit"> {unit}</span>
        </span>
        {r ? (
          <MonoMeta tone="hue" className="lv-est__range">
            Likely {formatRange(r.lo, r.hi, decimals)}
          </MonoMeta>
        ) : null}
        {source ? <SourceChip source={source} /> : null}
      </span>
    );
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
          (
          {formatRange(r.lo, r.hi, decimals)})
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
