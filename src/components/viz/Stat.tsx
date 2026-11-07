/* ==========================================================================
   <Stat> and <StatGroup> (DATAVIZ P7, SPEC A.3.2): a value with its status,
   as one cell of a `dl` grid inside the section's one card (never a nested
   card). Label (label-s, stone) with an optional info key, the value (20/27
   500, tabular) with the unit in stone, then one chip: status (6 px dot),
   delta (12 px arrow, true minus), qualifier, provisional (hourglass, dashed
   edge: "Calibrating · night 3 of 7") or unavailable. The dl is the text
   alternative: dt the label, dd the value then the chip words; glyphs are
   aria-hidden and a minus is spoken "minus".
   r071: a tile is quiet: the label is mono caps (with a 6 px dot in the domain
   hue when `hue` is given), the value 22 px regular with its unit small and
   muted, the chip one fact line under it, and no rules between cells.
   ========================================================================== */
import { Children, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Hourglass, Info } from 'lucide-react';
import { cx } from '../lib/cx';
import type { Domain } from '../domain';
import { Icon } from '../icons/Icon';
import { IconKey } from '../Key';
import { Popover, usePopover } from '../Popover';
import { Skeleton } from '../EmptyStage';
import type { Severity } from '../Notice';
import { speak } from './geometry';
import './viz.css';

export type StatChip =
  | { kind: 'status'; severity: Severity; word: string }
  | { kind: 'delta'; dir: 'up' | 'down' | 'flat'; text: string; caution?: boolean }
  | { kind: 'qualifier'; text: string }
  | { kind: 'provisional'; text: string }
  | { kind: 'unavailable'; text: string };

export type StatState = 'normal' | 'loading' | 'missing' | 'stale';

export interface StatProps {
  label: string;
  value: string | null;
  unit?: string;
  chip?: StatChip;
  info?: { text: string; method?: string };
  state?: StatState;
  /** Quiet mode: the value is replaced by the chip's words (no digits). */
  quiet?: boolean;
  /** (r071) A 6 px dot in this domain's hue beside the label. */
  hue?: Domain;
  className?: string;
}

/** The chip's words. */
export const chipText = (c: StatChip): string => (c.kind === 'status' ? c.word : c.text);

/** "Heart rate: 53 bpm, Normal". Minus spoken "minus". */
export function spokenStat(p: Pick<StatProps, 'label' | 'value' | 'unit' | 'chip' | 'state' | 'quiet'>): string {
  if (p.state === 'loading') return `${p.label}: loading`;
  const v = p.quiet ? null : p.value == null ? 'no value' : `${p.value}${p.unit ? ` ${p.unit}` : ''}`;
  const parts = [v, p.chip ? chipText(p.chip) : null, p.state === 'stale' ? 'stale' : null].filter(Boolean);
  return speak(`${p.label}: ${parts.join(', ')}`);
}

const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

/**
 * One chip of the P7 vocabulary; the glyph is aria-hidden and the words are spoken with "minus". `line` (r071, what a
 * Stat tile passes) sets the words as one mono-caps fact line instead of a pill's label.
 */
export function StatChipView({ chip, line = false }: { chip: StatChip; line?: boolean }) {
  const text = chipText(chip);
  const spoken = speak(text);
  const textClass = cx('lm-chip__text', line && 'lm-mono');
  const words =
    spoken === text ? (
      <span className={textClass}>{text}</span>
    ) : (
      <>
        <span className={textClass} aria-hidden="true">
          {text}
        </span>
        <span className="lm-sr">{spoken}</span>
      </>
    );
  if (chip.kind === 'status')
    return (
      <span className="lm-chip lmv-chip" data-kind="status" data-severity={chip.severity}>
        <span className="lm-chip__dot" aria-hidden="true" />
        {words}
      </span>
    );
  if (chip.kind === 'delta')
    return (
      <span className="lm-chip lmv-chip" data-kind="delta" data-dir={chip.dir} data-caution={chip.caution || undefined}>
        <Icon icon={ARROW[chip.dir]} size={12} className="lmv-chip__arrow" />
        {words}
      </span>
    );
  if (chip.kind === 'provisional')
    return (
      <span className="lm-chip lmv-chip" data-kind="provisional">
        <Icon icon={Hourglass} size={12} />
        {words}
      </span>
    );
  return (
    <span className="lm-chip lmv-chip" data-kind={chip.kind}>
      {words}
    </span>
  );
}

function InfoKey({ label, info }: { label: string; info: NonNullable<StatProps['info']> }) {
  const pop = usePopover();
  return (
    <>
      <IconKey {...pop.triggerProps} icon={Info} label={`About ${label}`} size="sm" className="lmv-stat__info" tooltip={false} />
      <Popover open={pop.open} onOpenChange={pop.setOpen} anchorRef={pop.anchorRef} label={label} className="lmv-pop">
        <p className="lmv-pop__text">{info.text}</p>
        {info.method ? <p className="lmv-pop__method">Method {info.method}</p> : null}
      </Popover>
    </>
  );
}

export function Stat({ label, value, unit, chip, info, state = 'normal', quiet = false, hue, className }: StatProps) {
  if (state === 'loading')
    return (
      <div className={cx('lmv-stat', className)} data-state="loading" data-hue={hue} aria-busy="true">
        <dt className="lmv-stat__label">
          <span className="lm-mono">{label}</span>
        </dt>
        <dd className="lmv-stat__value">
          <Skeleton width="4.5em" height={20} />
          <span className="lm-sr">loading</span>
        </dd>
      </div>
    );
  const missing = state === 'missing' || value == null;
  const spokenValue = value ? speak(value) : value;
  return (
    <div className={cx('lmv-stat', className)} data-state={state} data-hue={hue}>
      <dt className="lmv-stat__label">
        <span className="lm-mono">{label}</span>
        {state === 'stale' ? (
          <>
            <span className="lmv-stale-dot" aria-hidden="true" />
            <span className="lm-sr">, stale</span>
          </>
        ) : null}
        {info ? <InfoKey label={label} info={info} /> : null}
      </dt>
      {quiet ? null : (
        <dd className="lmv-stat__value">
          {missing ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="lm-sr">no value</span>
            </>
          ) : spokenValue !== value ? (
            <>
              <span aria-hidden="true">{value}</span>
              <span className="lm-sr">{spokenValue}</span>
            </>
          ) : (
            value
          )}
          {unit && !missing ? <span className="lmv-unit"> {unit}</span> : null}
        </dd>
      )}
      {chip ? (
        <dd className="lmv-stat__chip">
          <StatChipView chip={chip} line />
        </dd>
      ) : null}
    </div>
  );
}

export interface StatGroupProps {
  /** Accessible name of the group ("Sleep heart rate"). */
  label?: string;
  /** Columns from 1024 px; phones always show two. */
  columns?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}

/** The 2 / 3 / 4-column `dl` with 0.5 px rules between cells. At most six cells (DATAVIZ P7). */
export function StatGroup({ label, columns = 2, children, className }: StatGroupProps) {
  const count = Children.toArray(children).length;
  return (
    <div className={cx('lmv lmv-stats', className)} data-columns={columns} data-count={count}>
      <dl className="lmv-stats__dl" aria-label={label}>
        {children}
      </dl>
    </div>
  );
}
