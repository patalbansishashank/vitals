/**
 * Today's "So far" and "Against the forecast" faceplates (living-mode.md §4.1–§4.3).
 * So far: the adherence dial (COMPONENTS §13.9) + coverage, eaten and protein against the targets with likely ranges,
 * and "6 of the last 7 days logged" (never a streak). Tapping the dial lists what is still open.
 * Against the forecast: the 7–14 day trend lane (CHART_SPEC §7.8), "trend 83.1 kg · expected today 82.8–83.6 ·
 * on track", the goal-date line and the unusual-weigh-in flag. Quiet mode turns the numbers into words.
 */
import { useState } from 'react';
import { Faceplate, InlineWarning, Key, StatusMark, formatNumber, formatRange } from '@/components';
import { AdherenceDial } from '@/features/charts/living/AdherenceDial';
import { TrendLane } from '@/features/charts/living/TrendLane';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { TodayView } from '@/living';
import { TODAY_COPY } from '../../copy';
import { EstimateReadout } from '../../components/Estimate';
import { kcal, quietEaten, quietWord } from '../../format';
import { coverageText, dialItemsOf, itemLabel } from '../../model/adherence';
import { goalDateLine, openItems } from '../model';

/** `daysLogged7`: days with a log among this day and the six before it (the contract's count covers finished days only). */
export function SoFarFace({ view, quiet, size, daysLogged7, onArc }: { view: TodayView; quiet: boolean; size: 'sm' | 'md'; daysLogged7?: number; onArc: (itemId: string) => void }) {
  const [open, setOpen] = useState(false);
  const rx = view.prescription;
  const score = view.adherence.today;
  const items = dialItemsOf(score, rx);
  const eaten = view.logged.totals.energyKcal;
  const protein = view.logged.totals.proteinG;
  const label = (id: string) => {
    const it = score?.items.find((i) => i.itemId === id);
    return it ? `the ${itemLabel(id, it.type, rx).toLowerCase()}` : id;
  };
  const open3 = openItems(view, label);
  return (
    <Faceplate title={TODAY_COPY.soFar} aria-label={TODAY_COPY.soFar} className="lv-sofar">
      <div className="lv-sofar__grid">
        <button type="button" className="lv-sofar__dial" aria-expanded={open} aria-controls="lv-sofar-open" onClick={() => setOpen((o) => !o)}>
          <AdherenceDial
            items={items}
            score={score?.score ?? null}
            size={size}
            final={score?.final ?? false}
            {...(quiet ? { quietWord: quietWord(score?.score ?? null) } : {})}
            onArcClick={onArc}
          />
        </button>
        <div className="lv-sofar__lines">
          {!quiet ? (
            <p className="lv-sofar__head">
              {!score || score.score === null ? TODAY_COPY.notEnough : score.final ? 'final' : TODAY_COPY.soFarWord}
              {score && coverageText(score) ? ` · ${coverageText(score)}` : ''}
            </p>
          ) : null}
          {rx && rx.energyKcal > 0 ? (
            quiet ? (
              <p className="lv-sofar__line">
                <span className="lm-eng">{TODAY_COPY.eaten}</span> {quietEaten(eaten.value / rx.energyKcal)}
              </p>
            ) : (
              <>
                <p className="lv-sofar__line">
                  <span className="lm-eng">{TODAY_COPY.eaten}</span> <EstimateReadout value={eaten.value} sd={eaten.sd} unit={`of ${kcal(rx.energyKcal)} kcal`} approx short />
                </p>
                <p className="lv-sofar__line">
                  <span className="lm-eng">{TODAY_COPY.protein}</span> <EstimateReadout value={protein.value} sd={protein.sd} unit={`of ${Math.round(rx.macros.proteinG)} g`} approx short />
                </p>
              </>
            )
          ) : null}
          <p className="lv-sofar__line lv-sofar__logged">{TODAY_COPY.daysLogged(daysLogged7 ?? view.adherence.daysLogged7)}</p>
        </div>
      </div>
      {open ? (
        <ul id="lv-sofar-open" className="lv-sofar__open">
          {open3.length ? open3.map((t) => <li key={t}>{t}</li>) : <li>Everything on today’s plan has an answer.</li>}
        </ul>
      ) : null}
    </Faceplate>
  );
}

export function ForecastFace({ view, trend, quiet, compact }: { view: TodayView; trend: TrendLaneData | null; quiet: boolean; compact: boolean }) {
  const [show, setShow] = useState(false);
  const q = quiet && !show;
  const tw = view.trendWeight;
  const drift = view.drift?.[0];
  const gd = goalDateLine(view);
  const weighInsN = trend?.weighIns.length ?? 0;
  const todayW = trend && trend.todayIndex !== null ? trend.weighIns.find((w) => w.day === trend.todayIndex) : undefined;
  const unusual = todayW?.flagged && tw ? todayW.value - tw.kg : null;
  const state = drift ? TODAY_COPY.drift[drift.state] : null;
  return (
    <Faceplate
      title={TODAY_COPY.forecast}
      aria-label={TODAY_COPY.forecast}
      className="lv-forecast"
      actions={
        quiet ? (
          <Key size="sm" variant="quiet" onClick={() => setShow((s) => !s)}>
            {show ? TODAY_COPY.hideNumbers : TODAY_COPY.showNumbers}
          </Key>
        ) : undefined
      }
    >
      {trend && weighInsN > 0 ? <TrendLane data={trend} size="today" height={compact ? 72 : 88} quiet={q} readout={false} /> : null}
      {tw ? (
        <p className="lv-forecast__line">
          {q ? null : (
            <>
              <span className="lm-num">{TODAY_COPY.trend(formatNumber(tw.kg, 1))}</span>
              {' · '}
              {TODAY_COPY.expected(formatRange(tw.todayExpected.p10, tw.todayExpected.p90, 1))}
              {state ? ' · ' : ''}
            </>
          )}
          {state && drift ? (
            <span className="lv-forecast__state">
              <StatusMark severity={drift.state === 'behind' ? 'info' : 'ok'} size={16} />
              {state}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="lv-forecast__line lv-forecast__empty">{TODAY_COPY.noTrend}</p>
      )}
      {gd.range ? (
        <p className="lv-forecast__line">
          {TODAY_COPY.goalDate(gd.range)}
          {gd.shift ? <span className="lv-forecast__shift"> · {TODAY_COPY.goalShift(gd.shift.days, gd.shift.sd)}</span> : null}
        </p>
      ) : null}
      {unusual !== null && Math.abs(unusual) >= 0.8 && !q ? (
        <InlineWarning severity="info">{TODAY_COPY.unusualWeighIn(`${unusual > 0 ? '+' : '−'}${formatNumber(Math.abs(unusual), 1)}`)}</InlineWarning>
      ) : null}
    </Faceplate>
  );
}
