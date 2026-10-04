/**
 * Targets faceplate: the day's prescription (no band — it is a target, not an estimate) and what is eaten so far
 * (an estimate: value + likely range), with a macro micro-bar per line (target track, eaten fill, likely range).
 * Quiet mode: words instead of numbers, behind the per-view "show numbers" key.
 */
import type { ReactNode } from 'react';
import { Faceplate, energyInText, formatEnergy, formatNumber, toEnergyUnit } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Est, PrescribedDaySnapshot, TodayView } from '@/living';
import { EstimateReadout } from '../../components/Estimate';
import { fmtLikely, grams, kcal, likely, quietEaten } from '../../format';
import { FOOD_COPY } from '../copy';

const T = FOOD_COPY.targets;

interface BarProps {
  what: string;
  target: number;
  eaten: Est;
  unit: string;
  /** Data colour of the fill (macro identity). */
  color: string;
  logged: boolean;
}

/** Target vs eaten on a printed 0–100 % track; overshoot runs to 125 % with a tick at the target. */
function MacroBar({ what, target, eaten, unit, color, logged }: BarProps) {
  const max = target * 1.25;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const r = likely(eaten.value, eaten.sd);
  const label = logged ? T.barLabel(what, formatNumber(eaten.value, 0), formatNumber(target, 0), unit, eaten.sd > 0 ? fmtLikely(eaten.value, eaten.sd) : null) : T.barNone(what, formatNumber(target, 0), unit);
  return (
    <div className="lv-food-bar" role="img" aria-label={label}>
      <span className="lv-food-bar__track" aria-hidden="true">
        {logged ? (
          <>
            <span className="lv-food-bar__fill" style={{ width: pct(eaten.value), background: color }} />
            {eaten.sd > 0 ? <span className="lv-food-bar__range" style={{ left: pct(r.lo), width: `calc(${pct(r.hi)} - ${pct(r.lo)})` }} /> : null}
          </>
        ) : null}
        <span className="lv-food-bar__target" style={{ left: pct(target) }} />
        <span className="lv-food-bar__tick" style={{ left: '0%' }} />
        <span className="lv-food-bar__tick" style={{ left: pct(target / 2) }} />
      </span>
    </div>
  );
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
  const rows = [
    { what: T.bars.energy, target: e(rx.energyKcal), targetText: formatEnergy(rx.energyKcal, eu).replace('\u2009', ' '), eaten: { ...totals.energyKcal, value: e(totals.energyKcal.value), sd: e(totals.energyKcal.sd) }, unit: eu as string, color: 'var(--lm-cat-energy)' },
    { what: T.bars.protein, target: m.proteinG, targetText: `${grams(m.proteinG)} g`, eaten: totals.proteinG, unit: 'g', color: 'var(--lm-macro-protein)' },
    { what: T.bars.carbs, target: m.carbG, targetText: `${grams(m.carbG)} g`, eaten: totals.carbG, unit: 'g', color: 'var(--lm-macro-carbs)' },
    { what: T.bars.fat, target: m.fatG, targetText: `${grams(m.fatG)} g`, eaten: totals.fatG, unit: 'g', color: 'var(--lm-macro-fat)' },
  ];
  return (
    <Faceplate id="targets" className="lv-food-targets" title={T.title} caption={T.caption} actions={quietKey}>
      {quiet ? (
        <>
          <p className="lv-food-targets__quiet">{T.quietEaten(logged ? quietEaten(totals.energyKcal.value / Math.max(1, rx.energyKcal)) : T.nothingYet)}</p>
          <p className="lv-food-note">{T.quietNote}</p>
        </>
      ) : (
        <>
          <p className="lv-food-targets__rx lm-num">
            {[energyInText(T.kcal(kcal(rx.energyKcal)), eu), T.protein(grams(m.proteinG)), T.carbs(grams(m.carbG)), T.fat(grams(m.fatG)), T.fibre(grams(m.fibreG))].join(' · ')}
          </p>
          <div className="lv-food-lines">
            {rows.map((r) => (
              <div key={r.what} className="lv-food-line">
                <span className="lv-food-line__label lm-eng">{r.what}</span>
                <span className="lv-food-line__eaten">
                  <span className="lm-eng">{T.eaten} </span>
                  {logged ? <EstimateReadout value={r.eaten.value} sd={r.eaten.sd} unit={r.unit} approx short /> : <span className="lv-food-note">{T.nothingYet}</span>}
                  <span className="lv-food-note lm-num"> {T.ofTarget(r.targetText)}</span>
                </span>
                <MacroBar what={r.what} target={r.target} eaten={r.eaten} unit={r.unit} color={r.color} logged={logged} />
              </div>
            ))}
          </div>
        </>
      )}
    </Faceplate>
  );
}
