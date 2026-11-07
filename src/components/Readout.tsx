import { useMemo, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { EM_DASH, formatNumber, formatRange, formatSigned } from './lib/format';
import { clamp, niceStep, scaleTicks } from './lib/scale';
import { Faceplate } from './Faceplate';
import { HeroNumber } from './HeroNumber';
import { RollingNumber } from './RollingNumber';
import { Swatch, type MetricCategory } from './Chip';

/** Kept here for the callers that import it from this file; it lives in its own module so HeroNumber and Readout can both use it. */
export { RollingNumber };

/* ---------------------------------------------------------------------------
   RangeBar — likely range on a printed scale (REVIEW_FINDINGS #2)
   --------------------------------------------------------------------------- */

export interface RangeBarProps {
  low: number;
  high: number;
  /** Point estimate (2 × 10 ink tick). */
  value: number;
  /** Domain; defaults to the range ± 60 % of its width (and includes `ghost`). */
  min?: number;
  max?: number;
  /** Start value, drawn as an ink-3 tick (before/after). */
  ghost?: number;
  /** Glyph width in px (64–120). Default 96. */
  width?: number;
  /** Text after the glyph ("likely 18.6–21.0"). */
  children?: ReactNode;
  className?: string;
}

/** 96 × 12 glyph: hairline axis with printed ticks, the likely range as a 4 px gold bar, the estimate as a gold tick. */
export function RangeBar({ low, high, value, min, max, ghost, width = 96, children, className }: RangeBarProps) {
  const span = Math.max(high - low, Math.abs(value) * 0.02, 1e-9);
  const lo0 = Math.min(low, ghost ?? low, value);
  const hi0 = Math.max(high, ghost ?? high, value);
  const dMin = min ?? lo0 - span * 0.6;
  const dMax = max ?? hi0 + span * 0.6;
  const W = width;
  const X = (v: number) => 2 + ((clamp(v, dMin, dMax) - dMin) / (dMax - dMin || 1)) * (W - 4);
  const ticks = useMemo(() => {
    const major = niceStep(dMax - dMin, 4);
    const pxPerMajor = ((W - 4) * major) / (dMax - dMin || 1);
    // a printed scale that stays legible at 64–120 px: halves only when there is room
    const minor = pxPerMajor >= 16 ? major / 2 : major;
    return scaleTicks(dMin, dMax, minor, major, 40);
  }, [dMin, dMax, W]);
  return (
    <span className={cx('lm-rangebar', className)}>
      <svg width={W} height={12} viewBox={`0 0 ${W} 12`} aria-hidden="true">
        <line className="lm-rangebar__axis" x1={2} x2={W - 2} y1={4.5} y2={4.5} />
        {ticks.map((t) => (
          <line key={t.value} className="lm-rangebar__tick" data-major={t.major} x1={Math.round(X(t.value)) + 0.5} x2={Math.round(X(t.value)) + 0.5} y1={8} y2={t.major ? 12 : 10} />
        ))}
        <rect className="lm-rangebar__span" x={X(low)} y={2.5} width={Math.max(1, X(high) - X(low))} height={4} rx={2} />
        {ghost !== undefined ? <rect className="lm-rangebar__ghost" x={X(ghost) - 1} y={0} width={2} height={9} /> : null}
        <rect className="lm-rangebar__pt" x={X(value) - 1} y={0} width={2} height={9} />
      </svg>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Readout — the live estimate unit (no card)
   --------------------------------------------------------------------------- */

export interface ReadoutProps {
  /** Name (body-s, stone): "Body fat". */
  label: ReactNode;
  /** Current / end value; null renders "—" with `unknownCaption`. */
  value: number | null;
  decimals?: number;
  unit?: string;
  /** Start value: renders "24.1 → 19.7" (readout strip). */
  from?: number;
  /** Show the signed change line ("−4.4 kg"). Defaults to true when `from` is set. */
  delta?: boolean;
  /** Likely range (80 % interval) for the RangeBar + "likely lo–hi" text. */
  range?: readonly [number, number];
  /** RangeBar domain override. */
  domain?: readonly [number, number];
  /** Category swatch before the name. */
  category?: MetricCategory;
  /** A fact about the value (12 px, stone, max 34 ch). */
  caption?: ReactNode;
  /** Shown instead of a range when value is null ("needs waist"). */
  unknownCaption?: ReactNode;
  /** `lg` 32/38 (one per view) · `md` 28/34 (default) · `sm` 20/27 (readout strip). Unit smaller, stone. */
  size?: 'lg' | 'md' | 'sm';
  /** Roll changed digits (live readouts). */
  animate?: boolean;
  format?: (v: number) => string;
  className?: string;
}

/** Big number with unit, optional start → end, signed change and likely-range gauge. */
export function Readout({
  label,
  value,
  decimals = 1,
  unit,
  from,
  delta,
  range,
  domain,
  category,
  caption,
  unknownCaption,
  size = 'md',
  animate = false,
  format,
  className,
}: ReadoutProps) {
  const fmt = (v: number) => (format ? format(v) : formatNumber(v, decimals));
  const unknown = value === null || !Number.isFinite(value);
  const text = unknown ? EM_DASH : fmt(value);
  const showDelta = !unknown && from !== undefined && (delta ?? true);
  const spoken = unknown
    ? `${typeof label === 'string' ? label : ''} unknown`
    : `${from !== undefined ? `${fmt(from)} to ` : ''}${text}${unit ? ` ${unit}` : ''}${range ? `, range ${fmt(range[0])} to ${fmt(range[1])}` : ''}`;
  return (
    <div className={cx('lm-readout', className)} data-size={size} data-unknown={unknown || undefined}>
      <span className="lm-readout__name">
        {category ? <Swatch category={category} /> : null}
        <span className="lm-eng">{label}</span>
      </span>
      <span className="lm-readout__value">
        {from !== undefined && !unknown ? (
          <span className="lm-readout__trail" aria-hidden="true">
            <span className="lm-readout__from">{fmt(from)}</span>
            <span className="lm-readout__arrow">→</span>
          </span>
        ) : null}
        {/* the figure and its unit are a HeroNumber (one number component: spoken value, hidden digits, a rolling readout) at the readout's own sizes */}
        <HeroNumber className="lm-readout__hero" size="stat" numerals="tabular" value={unknown ? null : value} format={fmt} unit={unit && !unknown ? unit : undefined} label={spoken} countUp={false} animate={false} roll={animate && !unknown} />
      </span>
      {showDelta ? (
        <span className="lm-readout__delta">
          {formatSigned(value - from, decimals)}
          {unit ? ` ${unit}` : ''}
        </span>
      ) : null}
      {!unknown && range ? (
        <RangeBar low={range[0]} high={range[1]} value={value} ghost={from} min={domain?.[0]} max={domain?.[1]} width={size === 'sm' ? 72 : 96}>
          range {formatRange(range[0], range[1], decimals)}
        </RangeBar>
      ) : null}
      {unknown && unknownCaption ? <span className="lm-readout__caption">{unknownCaption}</span> : null}
      {caption ? <span className="lm-readout__caption">{caption}</span> : null}
    </div>
  );
}

/** A value in running text: "Your maintenance is about <ReadoutInline value={2540} unit="kcal" />." */
export function ReadoutInline({ value, decimals = 0, unit, className }: { value: number; decimals?: number; unit?: string; className?: string }) {
  return (
    <span className={cx('lm-readout-inline lm-num', className)}>
      {formatNumber(value, decimals)}
      {unit ? <span className="lm-unit">{unit}</span> : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   ReadoutStrip — one faceplate, readouts divided by hairlines (never cards)
   --------------------------------------------------------------------------- */

export interface ReadoutStripItem extends Omit<ReadoutProps, 'size' | 'className'> {
  id: string;
}

export interface ReadoutStripProps {
  items: ReadonlyArray<ReadoutStripItem>;
  /** Region name, e.g. "Start to end". */
  label: string;
  className?: string;
}

/** 4–6 readouts in a row; on mobile a snap rail where the next item peeks. */
export function ReadoutStrip({ items, label, className }: ReadoutStripProps) {
  return (
    <Faceplate variant="flush" className={cx('lm-strip', className)} aria-label={label}>
      {items.map(({ id, ...it }) => (
        <div key={id} className="lm-strip__item">
          <Readout size="sm" {...it} />
        </div>
      ))}
    </Faceplate>
  );
}
