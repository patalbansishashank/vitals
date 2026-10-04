/**
 * Progress › Trend (living-mode.md §8.2 item 1, §8.3; CHART_SPEC §7.8): the trend lane with both forecast bands, the
 * goal line and the goal-date bracket. The readout reads the source's arrays — "trend 83.1 kg (±0.3) · since day 1
 * −2.4 kg (likely −2.0 to −2.8)". Under a week of weigh-ins the trend line is withheld (raw dots stay); after 14 days
 * without one the trend restarts. Quiet mode: no weight axis, direction words only.
 */
import { useMemo } from 'react';
import { Faceplate, formatNumber, formatSigned } from '@/components';
import { TrendLane } from '@/features/charts/living/TrendLane';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLiving } from '../../data/source';
import { PROGRESS_COPY as C } from '../copy';
import { readTrend, signedInterval, trendWindow, type TrendRange } from '../model';

export interface TrendSectionProps {
  plan: ActivePlan;
  today: LocalDate;
  range: TrendRange;
  quiet: boolean;
}

export function TrendSection({ plan, today, range, quiet }: TrendSectionProps) {
  const { from, to } = trendWindow(range, plan, today);
  const data = useLiving((s) => s.trend(from, to), [from, to]);
  const whole = useLiving((s) => s.trend(plan.startDate, today), [plan.startDate, today]);
  const driftState = useLiving((s) => s.driftCards()[0]?.state ?? null, []);
  const r = readTrend(whole, today);
  const forming = r.weighDays < 7;
  const gap = !forming && r.gapDays !== null && r.gapDays >= 14;
  const shown = useMemo(() => (data && forming ? { ...data, trend: data.trend.map(() => Number.NaN) } : data), [data, forming]);

  let readout: string | null = null;
  if (!forming && !gap && r.now !== null) {
    const delta = r.first !== null ? r.now - r.first : null;
    const sd = r.sd ?? 0;
    if (quiet) {
      const dir = delta === null || Math.abs(delta) < 0.2 ? 'steady' : delta < 0 ? 'down' : 'up';
      readout = [C.quietTrend(C.directions[dir]), driftState ? C.drift[driftState] : null].filter(Boolean).join(' · ');
    } else {
      const parts = [C.trendReadout(formatNumber(r.now, 1), formatNumber(sd, 1))];
      if (delta !== null) {
        const [near, far] = signedInterval(delta, sd);
        parts.push(C.sinceStart(formatSigned(delta, 1), formatSigned(near, 1), formatSigned(far, 1)));
      }
      if (driftState) parts.push(C.drift[driftState]);
      readout = parts.join(' · ');
    }
  }

  return (
    <Faceplate id="trend" title={C.faces.trend} className="lv-prog-face">
      {forming ? <p className="lv-prog-state">{C.trendForming(r.weighDays)}</p> : null}
      {gap ? <p className="lv-prog-state">{C.trendGap}</p> : null}
      {shown ? (
        <TrendLane data={shown} size="progress" quiet={quiet} title={C.trendTitle} readout={readout ?? false} />
      ) : (
        <p className="lv-prog-state">{C.noTrend}</p>
      )}
    </Faceplate>
  );
}
