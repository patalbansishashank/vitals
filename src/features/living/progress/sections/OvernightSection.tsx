/** One card per sleeping signal; the personal baseline stays achromatic and a missing night stays a gap. */
import { useMemo } from 'react';
import { Activity, HeartPulse, TriangleAlert } from 'lucide-react';
import { CardFoot, ChartTwin, HeroNumber, MonoMeta, formatNumber, formatRange } from '@/components';
import { topicHref } from '@/features/evidence/links';
import type { LocalDate } from '@/living';
import { addDays } from '@/living/dates';
import { useQuietMode } from '@/state/settingsStore';
import { fmtDayMonth } from '../../format';
import { ACTIVITY_COPY as C } from '../copy';
import {
  TREND_DAYS,
  nightRows,
  recentMedian,
  usualBands,
  usualWord,
  type NightRow,
  type UsualBand,
} from '../activityModel';
import { LaneChart } from '../components/LaneChart';
import { ProgressCard } from '../components/ProgressCard';
import { useReportGaugeFreshness } from '../components/GaugeFreshness';
import { useProgressGauge } from '../data/gauge';
import type { GaugeBaselines } from '@/net/gauge';

export interface OvernightSectionProps {
  today: LocalDate;
  quiet?: boolean;
}

function NightCard({
  rows,
  k,
  band,
  learning,
  quiet,
}: {
  rows: NightRow[];
  k: 'lowHr' | 'hrv';
  band: UsualBand | null;
  learning: GaugeBaselines['learning'] | null;
  quiet: boolean;
}) {
  const hr = k === 'lowHr';
  const label = hr ? C.lowHr : C.hrv;
  const unit = hr ? 'bpm' : 'ms';
  const hue = hr ? 'var(--lm-hue-heart)' : 'var(--lm-hue-recovery)';
  const med = recentMedian(rows, k);
  const calibrating = learning?.learning ?? !band;
  const word = calibrating ? 'Calibrating' : (usualWord(med, band) ?? 'Not enough nights');
  const usualText =
    band && !calibrating
      ? `${formatRange(band.lo, band.hi)} ${unit}`
      : '';
  const range = calibrating
    ? quiet
      ? 'Calibrating'
      : learning
        ? C.calibrating(Math.min(learning.nights, learning.needed), learning.needed)
        : 'Calibrating'
    : quiet
      ? 'Your usual range'
      : usualText;
  const vals = rows.map((r) => r[k]);
  const labels = rows.map((r, i) => (i % 7 === 0 || i === rows.length - 1 ? fmtDayMonth(r.date) : null));
  const twin = quiet ? (
    <p>Numbers stay hidden in quiet mode.</p>
  ) : (
    <ChartTwin
      data={{
        title: `${label} table`,
        caption: `${label} by night`,
        head: [C.nightCols.date, `${label} (${unit})`],
        rows: rows.map((r) => [r.date, r[k] === null ? '—' : formatNumber(Math.round(r[k]!))]),
        fileName: `${hr ? 'sleeping-low-hr' : 'hrv'}.csv`,
        rowNoun: ['night', 'nights'],
      }}
    />
  );
  return (
    <ProgressCard
      id={hr ? 'overnight' : 'hrv'}
      domain={hr ? 'heart' : 'recovery'}
      title={label}
      icon={hr ? HeartPulse : Activity}
      info={{
        title: label,
        body: hr
          ? "Your ring's low sleeping heart rate is the tenth percentile of heart rate while asleep, one value per night. It is not a waking resting heart rate. 'Usual' is your own recent range; the band appears after a week of nights. Missing nights stay gaps."
          : quiet
            ? "Your ring's heart rate variability while you sleep, one value per night. 'Usual' is your own recent range. The comparison uses the median of recent nights, so one odd night doesn't change the word. Missing nights stay gaps, and the baseline needs time to form."
            : "Your ring's heart rate variability while you sleep, one value per night. 'Usual' is your own recent range: your typical night, give or take 3 ms or 10 %, whichever is larger. It compares the median of your last 7 nights with that range, so one odd night doesn't change the word.",
        source: { kind: 'ring', words: 'The main sleep session for each waking date.' },
        range: quiet
          ? 'Your personal range stays hidden in quiet mode.'
          : usualText || 'The personal range appears after seven nights.',
        evidence: { to: topicHref('sleep-sex-age'), label: 'Sleep and your signals' },
        twin,
      }}
      foot={
        <CardFoot
          state={{
            word,
            ...(k === 'hrv' && word === 'Below usual'
              ? { icon: TriangleAlert, tone: 'caution' as const }
              : {}),
          }}
          right={range}
          link={{ to: `/ring/signals/${hr ? 'hr' : 'hrv'}`, label: 'Open in Ring' }}
        />
      }
    >
      <HeroNumber
        value={med === null ? null : Math.round(med)}
        unit={unit}
        size="num"
        quietWord={quiet ? word : undefined}
        label={
          quiet
            ? `${label}: ${word}`
            : `${label}, median of last seven nights: ${med === null ? 'not enough nights' : `${formatNumber(Math.round(med))} ${unit}`}`
        }
      />
      <MonoMeta tone="hue">{quiet ? 'Recent nights' : C.last7Nights}</MonoMeta>
      <LaneChart
        className="lv-prog-act__lane"
        quiet={quiet}
        summary={
          quiet
            ? `${label} by night: ${word}. Missing nights are gaps.`
            : C.nightSummary(
                label,
                rows.length,
                med === null ? '—' : `${formatNumber(Math.round(med))} ${unit}`,
                usualText ? `Usual ${usualText}.` : '',
              )
        }
        count={rows.length}
        xLabels={labels}
        series={[
          { id: `${k}-line`, kind: 'line', values: vals, hue, area: true, endDot: 'pulse' },
          { id: `${k}-dots`, kind: 'dots', values: vals, hue },
        ]}
        usual={
          band && !calibrating
            ? {
                lo: band.lo,
                hi: band.hi,
                label: C.usual,
                hue: 'var(--lm-usual-wash, rgb(198 171 124 / 0.12))',
              }
            : null
        }
        yFormat={(v) => formatNumber(v)}
        height={112}
      />
    </ProgressCard>
  );
}

export function OvernightSection({ today, quiet: quietProp }: OvernightSectionProps) {
  const quietSetting = useQuietMode();
  const quiet = quietProp ?? quietSetting.on;
  const from = addDays(today, -(TREND_DAYS - 1));
  const sleep = useProgressGauge(`sleep:${from}:${today}`, (api) => api.sleep(from, today));
  const base = useProgressGauge(`baselines:${today}`, (api) => api.baselines(today));
  const rows = useMemo(
    () => (sleep.status === 'ready' ? nightRows(sleep.data.sessions, from, today) : []),
    [sleep, from, today],
  );
  const bands = useMemo(() => usualBands(base.status === 'ready' ? base.data : null), [base]);
  useReportGaugeFreshness(sleep.status === 'ready' && base.status !== 'loading' && rows.some((r) => r.lowHr !== null || r.hrv !== null), sleep, base);
  if (sleep.status !== 'ready' || base.status === 'loading') return null;
  return (
    <>
      {rows.some((r) => r.lowHr !== null) ? (
        <NightCard rows={rows} k="lowHr" band={bands.lowHr} learning={bands.learning} quiet={quiet} />
      ) : null}
      {rows.some((r) => r.hrv !== null) ? (
        <NightCard rows={rows} k="hrv" band={bands.hrv} learning={bands.learning} quiet={quiet} />
      ) : null}
    </>
  );
}
