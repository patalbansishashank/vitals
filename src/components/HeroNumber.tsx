import { useMemo, useRef, type ReactNode } from 'react';
import { useCountUp, useInView } from '@/app/motion';
import { cx } from './lib/cx';
import { EM_DASH, formatNumber, formatRange } from './lib/format';
import { MonoMeta } from './MonoMeta';
import { RollingNumber } from './RollingNumber';
import type { Domain } from './domain';
import './hero.css';

export type HeroSize = 'hero' | 'num-l' | 'num' | 'time' | 'stat';

export interface HeroPart {
  value: string | number;
  unit?: string;
}

export interface HeroNumberProps {
  /** A number counts up; a string ("16:30", "Weigh in") is drawn as it is; null draws a dash. */
  value?: number | string | null;
  /** Number to text (default formatNumber with `decimals`). Also the count-up's formatter, so the unit never moves. */
  format?: (n: number) => string;
  decimals?: number;
  /** A number in pieces, "7 h 56": each piece counts on its own. */
  parts?: ReadonlyArray<HeroPart>;
  /** A small, muted unit after the number. */
  unit?: string;
  unitPlacement?: 'inline' | 'below';
  /** The likely range, under the number: required for any estimate. A string is shown as it is; a pair is formatted. */
  range?: string | [number, number];
  /** hero 64/88 · num-l 52/64 · num 44/52 · time 36 (a clock, tabular) · stat 15 (a secondary figure, tabular). */
  size: HeroSize;
  /** Heroes, wide and tile numbers are proportional; clocks, columns and tables are tabular. Defaults follow `size`. */
  numerals?: 'proportional' | 'tabular';
  /** Count up on first view and on every change (default on for hero, num-l and num). `time` rolls its digits instead. */
  countUp?: boolean | { from?: number; duration?: number };
  /** Quiet mode: this word replaces every digit. `null`: nothing at all. Leave undefined when not quiet. */
  quietWord?: string | null;
  /** Tints the unit (and the range) with the domain; usually the card's own domain is enough. */
  hue?: Domain;
  /** The final spoken value, "1,096 kilocalories". The digits themselves are hidden from assistive technology so it never hears 0 to 1,096. */
  label: string;
  /** False: the final number at once. */
  animate?: boolean;
  /** A figure that ticks in place (a live readout): the digits that changed roll in, and it never counts up. */
  roll?: boolean;
  className?: string;
}

const COUNTS: ReadonlySet<HeroSize> = new Set(['hero', 'num-l', 'num']);

/**
 * The one hero number of a card (r071): Geist 300 at 44-88 px with proportional figures, or a tabular clock or figure,
 * the unit small and muted beside it. Real text in the display font (selectable), `aria-label` carries the final spoken
 * value. The final width is reserved during a count-up, so the unit and the layout never move; once it has finished the
 * markup is exactly the static one. The count and the first-view start are the shared hooks of `@/app/motion`
 * (`useCountUp`, `useInView`), so reduced motion, tests and `animate={false}` all draw the final number at once.
 */
export function HeroNumber(props: HeroNumberProps) {
  // `quietWord: null` is "nothing at all": the figure, with its observer, exists only while there is something to draw
  if (props.quietWord === null) return null;
  return <HeroFigure {...props} />;
}

function HeroFigure({ value, format, decimals = 0, parts, unit, unitPlacement = 'inline', range, size, numerals, countUp, quietWord, hue, label, animate = true, roll = false, className }: HeroNumberProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref);
  // the unit and the range wait for the first view where motion can run; everywhere else the number is final at once
  const pending = animate && !inView;
  const wantsCount = countUp === undefined ? COUNTS.has(size) : countUp !== false;
  const countOpts = typeof countUp === 'object' ? countUp : {};
  const fmt = useMemo(() => format ?? ((n: number) => formatNumber(n, decimals)), [format, decimals]);
  const tabular = (numerals ?? (size === 'time' || size === 'stat' ? 'tabular' : 'proportional')) === 'tabular';

  const quiet = quietWord !== undefined;
  const items: HeroPart[] = parts ? [...parts] : [{ value: value ?? EM_DASH, unit }];
  const rangeText = typeof range === 'string' ? range : range ? `Likely ${formatRange(range[0], range[1], decimals)}` : null;

  return (
    <span
      ref={ref}
      className={cx('lm-hero', className)}
      data-size={size}
      data-numerals={tabular ? 'tabular' : 'proportional'}
      data-unit={unitPlacement}
      data-hue={hue}
      data-quiet={quiet || undefined}
      data-reveal={pending && !quiet ? 'pending' : undefined}
      role="img"
      aria-label={label}
    >
      {quiet ? (
        <span className="lm-hero__word" aria-hidden="true">
          {quietWord}
        </span>
      ) : (
        <span className="lm-hero__line" aria-hidden="true">
          {items.map((p, i) => (
            <span key={i} className="lm-hero__part">
              <Digits value={p.value} size={size} fmt={fmt} roll={roll} count={animate && !roll && wantsCount && typeof p.value === 'number'} start={inView} from={countOpts.from} duration={countOpts.duration} />
              {p.unit ? <span className="lm-hero__unit">{p.unit}</span> : null}
            </span>
          ))}
        </span>
      )}
      {!quiet && rangeText ? (
        <MonoMeta tone="hue" className="lm-hero__range" aria-hidden="true">
          {rangeText}
        </MonoMeta>
      ) : null}
    </span>
  );
}

interface DigitsProps {
  value: string | number;
  size: HeroSize;
  fmt: (n: number) => string;
  count: boolean;
  /** Roll the digits that changed instead of counting (a live readout). */
  roll: boolean;
  /** The first view has happened (or cannot be waited for): the count may start. */
  start: boolean;
  from?: number;
  duration?: number;
}

/** One figure: counts up to a number, rolls the digits of a clock, or prints a string. */
function Digits({ value, size, fmt, count, roll, start, from, duration }: DigitsProps): ReactNode {
  // 0 → value in 1,100 ms on the first view, from what is shown to the new value in 400 ms on a change; the value itself
  // wherever motion cannot run. `null` (not counting, or not a number) leaves the hook idle.
  const shown = useCountUp(count && typeof value === 'number' ? value : null, { from, duration, start });
  if (typeof value !== 'number')
    return (
      <span className="lm-hero__digits">
        {/* a clock (or a live figure) rolls the digits that changed and never counts; its digits are hidden from assistive technology like the rest */}
        {size === 'time' || roll ? <RollingNumber text={value} /> : value}
      </span>
    );
  if (roll)
    return (
      <span className="lm-hero__digits">
        <RollingNumber text={fmt(value)} />
      </span>
    );
  const final = fmt(value);
  const live = count && shown !== null ? fmt(shown) : final;
  // while it counts (or waits to), the final text holds the width in an invisible twin; afterwards only the number is left
  const counting = count && (!start || live !== final);
  return (
    <span className="lm-hero__digits" data-counting={counting || undefined}>
      {counting ? (
        <span className="lm-hero__ghost" aria-hidden="true">
          {final}
        </span>
      ) : null}
      <span className="lm-hero__live">{live}</span>
    </span>
  );
}
