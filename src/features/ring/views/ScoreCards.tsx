/** Score cards share their source, scale and history across Day and period views. */
import { useState } from 'react';
import { Activity, Gauge, HeartPulse, Moon, Waves } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, DottedTrack, GlowLine, GradientCard, HeroNumber, HighlightBars, InfoPanel, MonoMeta, RangeScale, formatNumber, type Domain, type InfoSpec, type TwinData } from '@/components';
import { fmtDateRange, fmtDay } from '@/features/living/format';
import { periodStats } from '@/features/living/period';
import type { LocalDate } from '@/living';
import type { VitalsIndexHistory } from '../history';
import type { RingScores, IndexId } from '../indices';
import type { GaugeScores } from '../types';
import { INDEX_DOMAIN } from '../domains';
import { INDEX_KEYS, SCORE_KEYS, sleepBand } from '../model';
import { RING_COPY as C } from '../copy';
import { Contributors } from '../components/Contributors';
import { scoreInfo } from '../info/scores';
import './scores.css';

const ICON = { recovery: HeartPulse, sleep: Moon, activity: Activity, workout: Activity };
const INDEX_IDS: IndexId[] = ['recovery', 'sleep', 'activity'];

/** Raw values, missing days and the named method stay in the card's information panel. */
function historyTwin(title: string, dates: string[], values: number[], methods: string[] = []): TwinData {
  return { title: `${title} table`, caption: `${title}, by day`, head: ['Date', 'Score', ...(methods.length ? ['Method'] : [])], rows: dates.map((d, i) => [d, Number.isFinite(values[i]) ? formatNumber(values[i]!, 0) : '—', ...(methods.length ? [methods.join(', ')] : [])]), fileName: `vitals-${title.toLowerCase().replace(/[^a-z]+/g, '-')}.csv` };
}

function ScorePicture({ title, dates, values, hue, period = false }: { title: string; dates: string[]; values: number[]; hue: Domain; period?: boolean }) {
  if (!values.some(Number.isFinite)) return null;
  return period ? (
    <HighlightBars name={title} dates={dates} values={values} hue={hue} variant="spark" height={64} showAxis={false} max={100} twin={false} />
  ) : (
    <GlowLine label={title} unit="/ 100" series={values.map((v) => Number.isFinite(v) ? v : null)} hue={hue} variant="spark" smoothing="spark" yTicks={0} xTicks="none" height={64} area endDot="static" twin={false} />
  );
}

/** The three Day-score parts: one hero each, with its source visible in the heading. */
export function VitalsScoreCards({ scores, history, quiet, period = false }: { scores: RingScores | null; history: VitalsIndexHistory | null; quiet: boolean; period?: boolean }) {
  const [opened, setOpened] = useState<IndexId | null>(null);
  return <div className="rgs-indexgrid">
    {INDEX_IDS.map((id) => {
      const part = scores?.[id];
      const legacy = !period && scores?.source === 'legacy';
      const source = legacy ? 'On-device (legacy)' : 'Vitals';
      const name = id === 'recovery' ? 'Recovery' : id === 'sleep' ? 'Sleep' : 'Activity';
      const title = `${source} ${name}`;
      const hue = INDEX_DOMAIN[id];
      const dates = history?.dates ?? [];
      const values = legacy ? [] : history?.[id] ?? [];
      const st = periodStats(values);
      const value = period ? (st.n ? st.mean : null) : part?.value ?? null;
      const band = value === null ? 'No score yet' : sleepBand(value);
      const needs = part?.needs ?? 'Not worked out yet';
      const missingWord = quiet ? 'Not enough data yet' : needs;
      const versions = legacy ? (part?.version ? [part.version] : []) : history?.versions[id] ?? [];
      const info: InfoSpec = {
        ...scoreInfo({ id, source, quiet, period }),
        title: `What went into ${name}`,
        explain: part?.contributors.length ? <><MonoMeta>{period ? 'Latest day contributors' : 'Contributors'}</MonoMeta><Contributors parts={part.contributors} version={part.version} quiet={quiet} expanded hue={hue} /></> : undefined,
        twin: !quiet && dates.length ? <ChartTwin data={historyTwin(title, dates, values, versions)} /> : undefined,
      };
      const span = dates.length ? fmtDateRange(dates[0] as LocalDate, dates[dates.length - 1] as LocalDate) : null;
      return <GradientCard key={id} as="section" domain={hue} size="tile" className="rgs-index" onOpen={() => setOpened(id)} openLabel={`What went into ${name}`} head={<CardHead as="h2" title={title} icon={ICON[id]} info={info} />} foot={<CardFoot state={{ word: band }} right={quiet ? undefined : st.n ? `Avg ${formatNumber(st.mean, 0)} · ${st.n} d` : undefined} />}>
        <div className="rgs-index__value" data-missing={value === null || undefined}>
          {value === null ? <span className="rgs-index__missing"><MonoMeta>{missingWord}</MonoMeta></span> : <HeroNumber value={value} size="num-l" unit="/ 100" label={quiet ? `${title}, ${band.toLowerCase()}` : `${title} ${formatNumber(value, 0)} of 100`} quietWord={quiet ? band : undefined} />}
          {!period && part?.confidence === 'low' ? <MonoMeta className="rgs-part__low">{C.lowConfidence}</MonoMeta> : null}
          {!quiet && period ? <MonoMeta>Average · {span}</MonoMeta> : null}
          {quiet ? <DottedTrack label={title} value={value} goal={100} valueText={band} quiet quietWord={band} hue={hue} thumb={false} /> : <ScorePicture title={title} dates={dates} values={values} hue={hue} period={period} />}
        </div>
        {opened === id ? <InfoPanel {...info} open onClose={() => setOpened(null)} /> : null}
      </GradientCard>;
    })}
  </div>;
}

/** Gauge uses its own method: its scores have separate cards and never share a trend with Vitals. */
export function GaugeScoreCards({ data, dates, quiet, period = false }: { data: GaugeScores; dates: string[]; quiet: boolean; period?: boolean }) {
  const from = dates[0] ?? '';
  const to = dates[dates.length - 1] ?? '';
  const charts = SCORE_KEYS.flatMap((k) => {
    const list = (data.scores[k.key] ?? []).filter((e) => e.date >= from && e.date <= to);
    const last = [...list].reverse().find((e) => e.value !== null);
    if (!last) return [];
    const byDate = new Map(list.map((e) => [e.date, e.value]));
    const values = dates.map((d) => byDate.get(d) ?? NaN);
    return [{ k, last, values, st: periodStats(values) }];
  });
  const indices = INDEX_KEYS.flatMap((k) => {
    const list = (data.scores[k.key] ?? []).filter((e) => e.date >= from && e.date <= to);
    const last = [...list].reverse().find((e) => e.value !== null);
    if (!last) return [];
    const st = periodStats(list.map((e) => e.value));
    return [{ k, value: period ? st.mean : last.value!, unit: last.unit }];
  });
  const info: InfoSpec = { title: C.gaugeScores, body: "The phone works these out with its own methods. Vitals uses different ones, so the numbers may differ: compare each with its own history. Load uses arbitrary on-device units. VO₂ max is an estimate.", source: { kind: 'phone', words: 'Worked out on the phone.' }, range: quiet ? undefined : 'Scores run from 0 to 100; HRV balance and resting load are centred on 50, your usual.' };
  return <section className="rgs-gauge" aria-label={C.gaugeScores}>
    <h2 className="rgs-heading">{C.gaugeScores}</h2>
    {quiet ? <MonoMeta>Score history is hidden in quiet mode.</MonoMeta> : null}
    <div className="rgs-gauge__cards">
      {charts.map(({ k, last, values, st }) => {
        const id = k.key.replace('_score', '') as IndexId | 'workout';
        const hue = id === 'workout' ? 'steps' : INDEX_DOMAIN[id];
        const title = `Phone ${k.label}`;
        const value = period ? st.mean : last.value!;
        const band = sleepBand(value);
        const cardInfo: InfoSpec = { ...info, title, twin: !quiet ? <ChartTwin data={historyTwin(title, dates, values, [...new Set((data.scores[k.key] ?? []).map((e) => e.algorithmVersion).filter((v): v is string => !!v))])} /> : undefined };
        return <GradientCard key={k.key} as="section" domain={hue} size="card" className="rgs-gauge__card" head={<CardHead title={title} icon={ICON[id]} info={cardInfo} />} foot={<CardFoot state={{ word: band }} right={quiet ? undefined : period ? `Average ${formatNumber(st.mean, 0)}` : fmtDay(last.date as LocalDate)} />}>
          <div className="rgs-gauge__row">
            <HeroNumber size="num" value={value} unit="/ 100" label={quiet ? `${title}, ${band.toLowerCase()}` : `${title} ${formatNumber(value, 0)} of 100`} quietWord={quiet ? band : undefined} />
            {quiet ? null : <ScorePicture title={title} dates={dates} values={values} hue={hue} period={period} />}
          </div>
          {last.confidence === 'low' ? <MonoMeta className="rgs-part__low">{C.lowConfidence}</MonoMeta> : null}
        </GradientCard>;
      })}
    </div>
    {indices.length ? <GradientCard as="section" domain="recovery" head={<CardHead as="h3" title={C.gaugeIndices} icon={Waves} info={info} />} foot={<CardFoot state={{ word: period ? 'Period averages' : 'Phone estimates' }} />}>
      <dl className="rgs-indices">
        {indices.map(({ k, value, unit }) => <div key={k.key} className="rgs-indices__row">
          <dt>{k.label}</dt>
          <dd>{quiet ? <MonoMeta>Hidden in quiet mode</MonoMeta> : <MonoMeta>{formatNumber(value, k.key === 'vo2max_estimate' ? 1 : 0)} {unit === 'AU' ? '' : unit === 'score' ? '/ 100' : unit}</MonoMeta>}</dd>
          {k.key === 'hrv_balance' || k.key === 'resting_load' ? <RangeScale label={`Phone ${k.label}`} value={value} min={0} max={100} usual={[50, 50]} endLabels={['0', '100']} quiet={quiet} twin={false} hue="recovery" /> : k.key === 'vo2max_estimate' ? <MonoMeta>Estimate</MonoMeta> : <MonoMeta>On-device units</MonoMeta>}
        </div>)}
      </dl>
    </GradientCard> : null}
    {!charts.length && !indices.length ? <GradientCard as="section" domain="neutral" head={<CardHead title="On-device scores" icon={Gauge} info={info} />}><p className="rg-none">{C.noScores}</p></GradientCard> : null}
  </section>;
}
