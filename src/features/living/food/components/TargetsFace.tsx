/**
 * Targets faceplate. Energy is the hero: a large readout "1 332 of 2 664 kcal" with what is left (or a calm
 * "+120 over"), over one full-width bar whose END is the target — the eaten part filled in the energy colour, its
 * likely range a soft lighter band around the fill's end. Protein, carbs and fat follow as three equal tiles (name,
 * "78 of 156 g", a short bar to target; the likely range as small text). Fibre is one quiet line unless food reported
 * some. Before anything is logged the head says so once and every readout shows its target.
 * Quiet mode: words instead of numbers, behind the per-view "show numbers" key.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Faceplate, cx, formatNumber, toEnergyUnit } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Est, PrescribedDaySnapshot, TodayView } from '@/living';
import { fmtLikely, likely, quietEaten } from '../../format';
import { FOOD_COPY } from '../copy';

const T = FOOD_COPY.targets;

interface Channel {
  what: string;
  target: number;
  eaten: Est;
  unit: string;
  /** Data colour of the fill (macro identity). */
  color: string;
}

const pct = (v: number, target: number) => `${Math.max(0, Math.min(100, (v / Math.max(target, 1e-9)) * 100))}%`;

/** Eaten against the target: the track's end IS the target; the range is a lighter band of the same colour. */
function TargetBar({ c, logged, size }: { c: Channel; logged: boolean; size: 'lg' | 'sm' }) {
  const r = likely(c.eaten.value, c.eaten.sd);
  const label = logged
    ? T.barLabel(c.what, formatNumber(c.eaten.value, 0), formatNumber(c.target, 0), c.unit, c.eaten.sd > 0 ? fmtLikely(c.eaten.value, c.eaten.sd) : null)
    : T.barNone(c.what, formatNumber(c.target, 0), c.unit);
  return (
    <div className={cx('lv-tbar', `lv-tbar--${size}`)} role="img" aria-label={label} style={{ '--c': c.color } as CSSProperties}>
      {logged && c.eaten.sd > 0 ? <span className="lv-tbar__range" style={{ left: pct(r.lo, c.target), width: `calc(${pct(r.hi, c.target)} - ${pct(r.lo, c.target)})` }} /> : null}
      {logged ? <span className="lv-tbar__fill" style={{ width: pct(c.eaten.value, c.target) }} /> : null}
    </div>
  );
}

/** "78 of 156 g" (logged) or "156 g" (nothing yet), figures in tabular ink and the unit small. */
function Readout({ c, logged, big }: { c: Channel; logged: boolean; big?: boolean }) {
  return (
    <p className={cx('lv-tread', big && 'lv-tread--big')}>
      {logged ? (
        <>
          <span className="lv-tread__n lm-num">{formatNumber(c.eaten.value, 0)}</span>
          <span className="lv-tread__u"> {T.of} </span>
        </>
      ) : null}
      <span className={cx('lm-num', logged ? 'lv-tread__t' : 'lv-tread__n')}>{formatNumber(c.target, 0)}</span>
      <span className="lv-tread__u"> {c.unit}</span>
    </p>
  );
}

/** What is left, or a calm "+N over" (no red: an over day is information, not a fault). */
function leftText(c: Channel): string {
  const d = c.target - c.eaten.value;
  return d >= 0 ? T.left(formatNumber(d, 0), c.unit) : T.over(formatNumber(-d, 0), c.unit);
}

export interface TargetsFaceProps {
  rx: PrescribedDaySnapshot;
  totals: TodayView['logged']['totals'];
  /** At least one meal is logged for the day. */
  logged: boolean;
  quiet: boolean;
  /** The per-view "show numbers" key (quiet mode only). */
  quietKey?: ReactNode;
}

export function TargetsFace({ rx, totals, logged, quiet, quietKey }: TargetsFaceProps) {
  const m = rx.macros;
  // energy in the person's unit (Settings › Units › energy); the bar is a ratio, so it is unchanged
  const eu = useEnergyUnit();
  const e = (v: number) => toEnergyUnit(v, eu);
  const energy: Channel = { what: T.bars.energy, target: e(rx.energyKcal), eaten: { ...totals.energyKcal, value: e(totals.energyKcal.value), sd: e(totals.energyKcal.sd) }, unit: eu as string, color: 'var(--lm-cat-energy)' };
  const macros: Channel[] = [
    { what: T.bars.protein, target: m.proteinG, eaten: totals.proteinG, unit: 'g', color: 'var(--lm-macro-protein)' },
    { what: T.bars.carbs, target: m.carbG, eaten: totals.carbG, unit: 'g', color: 'var(--lm-macro-carbs)' },
    { what: T.bars.fat, target: m.fatG, eaten: totals.fatG, unit: 'g', color: 'var(--lm-macro-fat)' },
  ];
  const fibre = totals.fibreG ?? { value: 0, sd: 0 };
  const fibreCounted = logged && (fibre.value > 0 || fibre.sd > 0);
  return (
    <Faceplate id="targets" className="lv-food-targets" title={T.title} caption={logged || quiet ? undefined : T.nothingYet} actions={quietKey}>
      {quiet ? (
        <>
          <p className="lv-food-targets__quiet">{T.quietEaten(logged ? quietEaten(totals.energyKcal.value / Math.max(1, rx.energyKcal)) : T.nothingYet)}</p>
          <p className="lv-food-note">{T.quietNote}</p>
        </>
      ) : (
        <div className="lv-tgt">
          <section className="lv-tgt__hero" aria-label={energy.what}>
            <div className="lv-tgt__heroHead">
              <span className="lm-eng">{energy.what}</span>
              <Readout c={energy} logged={logged} big />
              {logged ? <span className="lv-tgt__left">{leftText(energy)}</span> : null}
            </div>
            <TargetBar c={energy} logged={logged} size="lg" />
            {logged && energy.eaten.sd > 0 ? <p className="lv-tgt__range">{T.likely(fmtLikely(energy.eaten.value, energy.eaten.sd), energy.unit)}</p> : null}
          </section>
          <ul className="lv-tgt__tiles">
            {macros.map((c) => (
              <li key={c.what} className="lv-tgt__tile">
                <span className="lm-eng">{c.what}</span>
                <Readout c={c} logged={logged} />
                <TargetBar c={c} logged={logged} size="sm" />
                {logged ? <span className="lv-tgt__small">{c.eaten.value > c.target ? leftText(c) : c.eaten.sd > 0 ? T.likelyShort(fmtLikely(c.eaten.value, c.eaten.sd)) : leftText(c)}</span> : null}
              </li>
            ))}
          </ul>
          <p className="lv-tgt__fibre">
            <span className="lm-eng">{T.bars.fibre}</span>{' '}
            {fibreCounted ? (
              <>
                <span className="lm-num">≈ {formatNumber(fibre.value, 0)}</span> {T.of} <span className="lm-num">{formatNumber(m.fibreG, 0)}</span> g
              </>
            ) : (
              <>
                <span className="lm-num">{formatNumber(m.fibreG, 0)}</span> g {T.target}
              </>
            )}
          </p>
        </div>
      )}
    </Faceplate>
  );
}
