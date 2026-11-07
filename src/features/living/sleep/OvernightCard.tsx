/**
 * Overnight (r071, AUDIT card 25): what the night did to three signals, each against where it usually sits. A row is a
 * link to the signal's page: its name in mono caps, the number in the light face, its word, and the signal's own scale
 * (`RangeScale`, inline): HRV against the usual stretch, skin temperature as the difference from the usual night, blood
 * oxygen on its fixed bands. A baseline still forming draws dashed ticks, never a usual that is not there. Quiet: the word
 * and the place on the scale stay, the numbers go.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Waves } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Icon, MonoMeta, RangeScale, StateWord, formatNumber, type Domain } from '@/components';
import { ringPaths } from '@/features/ring/paths';
import { personal } from '@/features/ring/monitor/values';
import { useUnitPrefs } from '@/features/ring/components/parts';
import { hrvUsualMs, signed, statusOf, unitOf, usualStatus, valueText, type RingMetric, type Status } from '@/features/ring/model';
import { metricScale, type MetricScale } from '@/features/ring/scales';
import type { GaugeBaselines } from '@/features/ring/types';
import { SLEEP_COPY as C } from './copy';
import { overnightInfo } from './info';
import type { NightView } from './model';
import { CalibratingChip } from './parts';
import './sleep.css';

interface RowProps {
  kind: RingMetric;
  domain: Domain;
  label: string;
  to: string;
  /** The number as drawn (a count-up for a plain number, a string as it is: "+0.4"). */
  value: number | string | null;
  unit: string;
  spoken: string;
  decimals?: number;
  word: Status | null;
  scale: MetricScale;
  /** One more fact under the number ("+1 ms vs usual", "Lowest 92 %"). */
  fact?: string | null;
  quiet: boolean;
}

function OvernightRow({ domain, label, to, value, unit, spoken, decimals = 0, word, scale, fact, quiet }: RowProps) {
  return (
    <li>
      <Link to={to} className="sl-orow" data-hue={domain}>
        <span className="sl-orow__main">
          <MonoMeta>{label}</MonoMeta>
          <HeroNumber value={value} unit={unit} size="time" numerals="proportional" decimals={decimals} label={spoken} quietWord={quiet ? null : undefined} />
          {fact && !quiet ? <MonoMeta tone="hue">{fact}</MonoMeta> : null}
        </span>
        <span className="sl-orow__side">
          {word ? <StateWord word={word.word} tone={word.severity === 'caution' ? 'caution' : word.severity === 'danger' ? 'danger' : 'neutral'} /> : null}
          <RangeScale
            label={label}
            value={scale.value}
            min={scale.min}
            max={scale.max}
            bands={scale.bands}
            usual={scale.usual}
            unit={scale.unit}
            spokenUnit={scale.spokenUnit}
            decimals={scale.decimals}
            ticks={scale.ticks}
            size="inline"
            state={scale.state}
            quiet={quiet}
          />
        </span>
        <Icon icon={ChevronRight} size={18} className="sl-orow__chev" />
      </Link>
    </li>
  );
}

export function OvernightCard({ v, baselines, date, quiet, infoFooter }: { v: NightView; baselines: GaugeBaselines | null; date: string; quiet: boolean; infoFooter?: ReactNode }) {
  const prefs = useUnitPrefs();
  const m = v.metrics;
  if (!m) return null;
  const u = v.joined?.vsUsual;
  const pb = personal(baselines);
  const usualHrv = hrvUsualMs(pb);
  const hrv = m.hrvNightlyMs ?? null;
  const hrvWord = hrv === null || v.learning ? null : usualStatus('hrv', u, usualHrv);
  const temp = m.skinTempNightC ?? null;
  const tempScale = metricScale('temp', temp, pb, prefs);
  const tempWord = temp === null || v.learning ? null : usualStatus('temp', u);
  const spo2 = m.spo2Night ?? null;
  const spo2Word = spo2 ? statusOf('spo2', spo2.meanPct) : null;
  const hrvScale = metricScale('hrv', hrv, pb, prefs);
  const spo2Scale = metricScale('spo2', spo2 ? spo2.meanPct : null, pb, prefs);
  const to = (k: RingMetric) => ringPaths.signal(k, date);
  return (
    <GradientCard
      as="section"
      domain="recovery"
      head={<CardHead as="h2" icon={Waves} title={C.overnight} info={overnightInfo({ quiet, footer: infoFooter })} />}
      foot={
        <CardFoot
          state={hrvWord ? { word: `HRV ${hrvWord.word.toLowerCase()}`, tone: hrvWord.severity === 'caution' ? 'caution' : 'neutral' } : undefined}
          right={quiet || usualHrv === null || v.learning ? undefined : C.usualWord(`HRV ${formatNumber(Math.round(usualHrv), 0)} ms`)}
        />
      }
    >
      {v.learning ? <CalibratingChip learning={v.learning} quiet={quiet} /> : null}
      <ul className="sl-orows">
        {hrv !== null ? (
          <OvernightRow
            kind="hrv"
            domain="recovery"
            label={C.hrv}
            to={to('hrv')}
            value={hrv}
            unit="ms"
            spoken={`${C.hrv} ${formatNumber(hrv, 0)} milliseconds`}
            word={hrvWord}
            scale={hrvScale}
            fact={u && u.hrvMs !== null ? `${signed(u.hrvMs)} ms vs usual` : null}
            quiet={quiet}
          />
        ) : null}
        {temp !== null ? (
          <OvernightRow
            kind="temp"
            domain="recovery"
            label={u && u.tempC !== null ? C.tempVsUsual : C.temp}
            to={to('temp')}
            value={tempScale.delta && tempScale.value !== null ? signed(tempScale.value, 1) : valueText('temp', temp, prefs)}
            unit={unitOf('temp', prefs)}
            spoken={tempScale.delta && tempScale.value !== null ? `${C.tempVsUsual} ${signed(tempScale.value, 1)} ${tempScale.spokenUnit}` : `${C.temp} ${valueText('temp', temp, prefs)} ${tempScale.spokenUnit}`}
            word={tempWord}
            scale={tempScale}
            quiet={quiet}
          />
        ) : null}
        {spo2 ? (
          <OvernightRow
            kind="spo2"
            domain="heart"
            label={C.spo2}
            to={to('spo2')}
            value={spo2.meanPct}
            unit="%"
            spoken={`${C.spo2} ${formatNumber(spo2.meanPct, 0)} percent`}
            word={spo2Word}
            scale={spo2Scale}
            fact={C.lowest(formatNumber(spo2.minPct, 0))}
            quiet={quiet}
          />
        ) : null}
      </ul>
      {hrv === null && temp === null && !spo2 ? <p className="rg-none">Nothing recorded overnight.</p> : null}
    </GradientCard>
  );
}
