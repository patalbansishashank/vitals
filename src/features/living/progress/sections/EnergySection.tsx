/** Energy out remains a scenario range; missing intake is a gap, never the plan's intake. */
import { useMemo } from 'react';
import { Flame } from 'lucide-react';
import {
  CardFoot,
  ChartTwin,
  HeroNumber,
  MonoMeta,
  OverflowText,
  Swatch,
  formatNumber,
  formatRange,
  toEnergyUnit,
} from '@/components';
import { topicHref } from '@/features/evidence/links';
import type { LocalDate } from '@/living';
import { addDays, compareDates } from '@/living/dates';
import { useEnergyUnit } from '@/state/settingsStore';
import type { ActivePlan } from '../../activePlan';
import { fmtDayMonth } from '../../format';
import { ACTIVITY_COPY as C } from '../copy';
import { energyBalance, energyRows } from '../activityModel';
import { LaneChart } from '../components/LaneChart';
import { ProgressCard } from '../components/ProgressCard';
import { trendWindow, type TrendRange } from '../model';
import { useProgressActuals } from './HeartPointsSection';
import './activityCards.css';

export interface EnergySectionProps {
  plan: ActivePlan;
  today: LocalDate;
  range: TrendRange;
  quiet: boolean;
  onShowNumbers?: () => void;
}

export function EnergySection({ plan, today, range, quiet }: EnergySectionProps) {
  const eu = useEnergyUnit();
  const win = trendWindow(range, plan, today);
  const yesterday = addDays(today, -1);
  const to = compareDates(win.to, yesterday) > 0 ? yesterday : win.to;
  const from = compareDates(win.from, to) > 0 ? to : win.from;
  const actuals = useProgressActuals(from, to);
  const rows = useMemo(() => (actuals ? energyRows(actuals, from, to) : []), [actuals, from, to]);
  if (!actuals || rows.every((r) => r.out === null && r.intake === null)) return null;

  const e = (kcal: number) => toEnergyUnit(kcal, eu);
  const rounded = (kcal: number) => Math.round(e(kcal) / 10) * 10;
  const fmt = (kcal: number) => formatNumber(rounded(kcal));
  const fmtR = (a: number, b: number) => formatRange(rounded(a), rounded(b));
  const bal = energyBalance(rows);
  const balance = bal ? Math.round(e(bal.intakeMean - bal.outMean)) : null;
  const both = rows.filter((r) => r.out !== null && r.intake !== null).length;
  const n = rows.length;
  const step = n <= 31 ? 7 : 14;
  const tail = (n - 1) % step;
  const labels = rows.map((r, i) =>
    i % step === 0 || (i === n - 1 && tail > 5) ? fmtDayMonth(r.date) : null,
  );
  const twin = quiet ? (
    <p>Numbers stay hidden in quiet mode.</p>
  ) : (
    <ChartTwin
      data={{
        title: `${C.faces.energy} table`,
        caption: C.energySummary(n, both),
        head: [
          C.energyCols.date,
          `${C.energyCols.out} (${eu})`,
          C.energyCols.range,
          `${C.energyCols.intake} (${eu})`,
        ],
        rows: rows.map((r) => [
          r.date,
          r.out === null ? '—' : fmt(r.out),
          r.outLo === null || r.outHi === null ? '—' : fmtR(r.outLo, r.outHi),
          r.intake === null ? '—' : fmt(r.intake),
        ]),
        fileName: 'energy-out-and-intake.csv',
      }}
    />
  );

  return (
    <ProgressCard
      id="energy"
      domain="energy"
      title={C.faces.energy}
      icon={Flame}
      info={{
        title: C.faces.energy,
        body: "Energy out is an estimate from your plan's model, shown as a range. Intake is what you logged. Both are averages over days that have both numbers; a day with meals missing is left out, never filled in. Intake minus out is the gap: below zero means you ate less than you used.",
        source: { kind: 'estimate', words: 'Energy out from the model; intake from your logged food.' },
        range: quiet
          ? 'Scenario ranges stay hidden in quiet mode.'
          : 'The band is the energy-out scenario range, not a measured confidence interval.',
        evidence: { to: topicHref('energy-expenditure'), label: 'Energy expenditure' },
        twin,
      }}
      foot={
        <CardFoot
          tone="ink"
          right={
            <span className="lv-prog-energy-key">
              <i className="lv-prog-energy-dot" aria-hidden="true" />
              <OverflowText text={quiet ? 'In · logged' : `In ${bal ? fmt(bal.intakeMean) : '—'}`} />
            </span>
          }
        >
          <MonoMeta className="lv-prog-energy-key" tone="ink">
            <Swatch color="var(--lm-ink)" shape="line" />
            <OverflowText text={quiet ? 'Out · estimate' : `Out ${bal ? fmtR(bal.outLo, bal.outHi) : '—'}`} />
          </MonoMeta>
        </CardFoot>
      }
    >
      <HeroNumber
        value={balance}
        unit={`${eu}/day`}
        range={!quiet && bal ? `Likely ${fmtR(bal.balanceLo, bal.balanceHi)} ${eu}/day` : undefined}
        size="num"
        quietWord={quiet ? 'Energy balance' : undefined}
        label={quiet ? 'Energy balance' : balance !== null ? `${C.difference} ${formatNumber(balance)} ${eu} a day` : C.fewDays}
      />
      <MonoMeta tone="hue">
        {quiet
          ? 'Out is an estimate · intake is logged'
          : bal
            ? `Intake − burn · ${bal.days} complete days`
            : C.fewDays}
      </MonoMeta>
      <LaneChart
        className="lv-prog-act__lane"
        quiet={quiet}
        summary={
          quiet
            ? 'Energy out and logged intake, with gaps where nothing was logged.'
            : C.energySummary(n, both)
        }
        count={n}
        xLabels={labels}
        series={[
          {
            id: 'outBand',
            kind: 'band',
            lo: rows.map((r) => (r.outLo === null ? null : e(r.outLo))),
            hi: rows.map((r) => (r.outHi === null ? null : e(r.outHi))),
            hue: 'var(--lm-hue-energy)',
          },
          {
            id: 'out',
            kind: 'line',
            values: rows.map((r) => (r.out === null ? null : e(r.out))),
            hue: 'var(--lm-hue-energy)',
            endDot: 'pulse',
          },
          {
            id: 'intake',
            kind: 'dots',
            values: rows.map((r) => (r.intake === null ? null : e(r.intake))),
            hue: 'var(--lm-hue-food)',
          },
        ]}
        yFormat={(v) => formatNumber(v)}
        height={148}
      />
    </ProgressCard>
  );
}
