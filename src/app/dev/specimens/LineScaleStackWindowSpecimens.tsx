/**
 * Gallery section "g-lines" (r071 0B): GlowLine, RangeScale, StackBar and WindowBar on real cards, with every state a
 * page meets (normal, stale, none, loading, quiet, a finished series, each domain hue, the phone tile and the wide
 * card). Numbers are synthetic (PRODUCT.md): the ones RESEARCH §0 gave (Energy 1,096 of 2,595, Weight 85.2 kg, HRV
 * 48 ms usual 38-62, Sleep 7 h 56 from 23:12), the rest made up. "Replay motion" remounts the pictures so the
 * draw-in, the sweep and the end-dot pulses can be seen (it needs motion allowed; reduced motion shows the final frame).
 */
import { useMemo, useState } from 'react';
import { Activity, Flame, Footprints, Gauge, HeartPulse, Moon, Scale, Timer } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Key, MonoMeta, type IconComponent } from '@/components';
import { GlowLine, type LinePoint } from '@/components/viz/GlowLine';
import { RangeScale, type RangeBand } from '@/components/viz/RangeScale';
import type { ShareBarRow } from '@/components/viz/ShareBar';
import { StackBar } from '@/components/viz/StackBar';
import { WindowBar } from '@/components/viz/WindowBar';
import { GallerySection, Row, Spec } from './kit';

const TZ = 'UTC';
const DAY = '2026-10-30';
const at = (hh: number, mm = 0, day = DAY) => Date.parse(`${day}T00:00:00Z`) + (hh * 60 + mm) * 60_000;
const NBSP = ' ';

/* ------------------------------------------------------------------ data */

/** Cumulative burn to 14:58 (1,096 kcal), every half hour: a slow night, a faster day. */
function burn(): LinePoint[] {
  const end = 14 * 60 + 58;
  const rate = (min: number) => (min < 7 * 60 ? 0.86 : min < 9 * 60 ? 1.2 : 1.55); // kcal a minute, shaped
  const pts: Array<{ min: number; v: number }> = [];
  let v = 0;
  for (let min = 0; min <= end; min += 30) {
    pts.push({ min, v });
    v += rate(min) * 30;
  }
  const last = pts[pts.length - 1]!;
  const k = 1096 / (last.v + rate(last.min) * (end - last.min));
  const scaled = pts.map((p) => ({ t: at(0, p.min), v: Math.round(p.v * k) }));
  scaled.push({ t: at(14, 58), v: 1096 });
  return scaled;
}
const BURN = burn();
/** The projection to bedtime: the planned lift at 17:30 shows as a steeper stretch. */
const BURN_AHEAD: LinePoint[] = [
  { t: at(18, 0), v: 1480 },
  { t: at(21, 0), v: 2050 },
  { t: at(23, 59), v: 2595 },
];
const ALL = [...BURN, ...BURN_AHEAD];
/** The likely range: tight where it was measured, a widening cone after now. */
const BAND = {
  lo: ALL.map((p, i) => Math.round((p.v ?? 0) * (1 - (i < BURN.length ? 0 : 0.045 * (i - BURN.length + 1))))),
  hi: ALL.map((p, i) => Math.round((p.v ?? 0) * (1 + (i < BURN.length ? 0 : 0.045 * (i - BURN.length + 1))))),
};
const PLAN = ALL.map((p) => Math.round((p.v ?? 0) * 0.97 + 40));

const INTENSITY: ShareBarRow[] = [
  { id: 'resting', label: 'Resting', valueText: '742', share: 742 / 1096, hue: 'var(--lm-intensity-resting)' },
  { id: 'light', label: 'Light', valueText: '238', share: 238 / 1096, hue: 'var(--lm-intensity-light)' },
  { id: 'active', label: 'Active', valueText: '84', share: 84 / 1096, hue: 'var(--lm-intensity-active)' },
  { id: 'exercise', label: 'Exercise', valueText: '32', share: 32 / 1096, hue: 'var(--lm-intensity-exercise)' },
];
const STAGES: ShareBarRow[] = [
  { id: 'deep', label: 'Deep', valueText: `1${NBSP}h 24`, share: 84 / 476, hue: 'var(--lm-stage-deep)' },
  { id: 'light', label: 'Light', valueText: `4${NBSP}h 34`, share: 274 / 476, hue: 'var(--lm-stage-light)' },
  { id: 'rem', label: 'REM', valueText: `1${NBSP}h 58`, share: 118 / 476, hue: 'var(--lm-stage-rem)' },
  { id: 'awake', label: 'Awake', valueText: '24 min', share: 24 / 476, hue: 'var(--lm-stage-awake)' },
];
const ZONES: ShareBarRow[] = [
  { id: 'z1', label: 'Zone 1', valueText: '12 min', share: 0.3, hue: 'var(--lm-hr-zone-1)' },
  { id: 'z2', label: 'Zone 2', valueText: '14 min', share: 0.35, hue: 'var(--lm-hr-zone-2)' },
  { id: 'z3', label: 'Zone 3', valueText: '9 min', share: 0.225, hue: 'var(--lm-hr-zone-3)' },
  { id: 'z4', label: 'Zone 4', valueText: '4 min', share: 0.1, hue: 'var(--lm-hr-zone-4)' },
  { id: 'z5', label: 'Zone 5', valueText: '1 min', share: 0.025, hue: 'var(--lm-hr-zone-5)' },
];
const MACROS: ShareBarRow[] = [
  { id: 'protein', label: 'Protein', valueText: '32 g', share: 0.26, hue: 'var(--lm-macro-protein)' },
  { id: 'carbs', label: 'Carbs', valueText: '71 g', share: 0.42, hue: 'var(--lm-macro-carbs)' },
  { id: 'fibre', label: 'Fibre', valueText: '9 g', share: 0.07, hue: 'var(--lm-macro-fibre)' },
  { id: 'fat', label: 'Fat', valueText: '22 g', share: 0.2, hue: 'var(--lm-macro-fat)' },
  { id: 'unknown', label: 'Not counted', valueText: '5 g', share: 0.05, hue: 'var(--lm-ink-3)', unknown: true },
];

/** A night of heart rate every five minutes, 23:12 to 07:08: a slow fall to a low near four, two awake breaks. */
function night(): { points: LinePoint[]; low: { t: number; v: number }; awake: Array<{ from: number; to: number; kind: 'awake' }> } {
  const start = at(23, 12, '2026-10-29');
  const pts: LinePoint[] = [];
  const awake = [
    { from: start + 175 * 60_000, to: start + 190 * 60_000, kind: 'awake' as const },
    { from: start + 388 * 60_000, to: start + 398 * 60_000, kind: 'awake' as const },
  ];
  for (let i = 0; i <= 95; i++) {
    const t = start + i * 5 * 60_000;
    const inAwake = awake.some((a) => t >= a.from && t <= a.to);
    const v = 58 - 7 * Math.sin((i / 95) * Math.PI) + 2.2 * Math.sin(i / 2.7) + 1.4 * Math.sin(i / 6.1) + (inAwake ? 13 : 0);
    pts.push({ t, v: Math.round(v) });
  }
  const low = pts.reduce((m, p) => (p.v! < m.v! ? p : m));
  return { points: pts, low: { t: low.t, v: low.v! }, awake };
}
const NIGHT = night();
const NIGHT_FROM = at(23, 12, '2026-10-29');
const NIGHT_TO = at(7, 8);
const clock = (t: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date(t));

/** The 14-day weight trend (an EMA, so a calm line). */
const TREND = [86.4, 86.3, 86.3, 86.1, 86, 86, 85.9, 85.8, 85.8, 85.6, 85.5, 85.4, 85.3, 85.2];
const STEPS_TREND = [6200, 7400, 8100, 5200, 8800, 9400, 7600, 8300, 9100, 6900, 7200, 8600, 9000, 7605];
const HRV_TREND = [44, 47, 52, 41, 49, 55, 50, 46, 43, 48, 51, 53, 45, 48];

const STRESS_BANDS: RangeBand[] = [
  { from: -Infinity, word: 'Calm', severity: 'ok' },
  { from: 34, word: 'Elevated', severity: 'caution' },
  { from: 67, word: 'High', severity: 'danger' },
];

/* ------------------------------------------------------------------ cards */

function EnergyHero({ quiet = false }: { quiet?: boolean }) {
  return (
    <GradientCard domain="energy" size="hero" head={<CardHead icon={Flame} title="Energy" />} foot={<CardFoot state={{ word: 'On plan' }} right={quiet ? undefined : `By bedtime 2${NBSP}595`} />}>
      <HeroNumber value={1096} unit="kcal" size="hero" label="1,096 kilocalories burned so far" quietWord={quiet ? 'About two fifths of the day' : undefined} />
      {quiet ? null : <MonoMeta tone="hue">Of 2{NBSP}595 today</MonoMeta>}
      <StackBar label="Where it went so far" rows={INTENSITY} total={`1${NBSP}096 kcal`} quiet={quiet} />
      <GlowLine label="Energy burned" unit="kcal" series={BURN} future={BURN_AHEAD} band={BAND} reference={PLAN} from={at(0)} to={at(24)} now={at(14, 58)} tz={TZ} yTicks={0} height={120} quiet={quiet} />
    </GradientCard>
  );
}

function WeightTile({ state, quiet = false, series = TREND }: { state?: 'stale' | 'none' | 'loading'; quiet?: boolean; series?: number[] }) {
  return (
    <GradientCard domain="body" size="tile" head={<CardHead icon={Scale} title="Weight" />}>
      <HeroNumber value={state === 'none' ? null : 85.2} decimals={1} unit="kg" size="num" label="Weight, 85.2 kilograms" quietWord={quiet ? 'Down a little' : undefined} />
      <GlowLine label="Weight trend, last 14 days" unit="kg" series={state === 'none' ? [] : series} variant="spark" decimals={1} state={state} quiet={quiet} endDot="static" height={64} />
    </GradientCard>
  );
}

function HueTile({ domain, icon, title, value, unit, series, decimals = 0 }: { domain: 'steps' | 'recovery' | 'sleep' | 'heart'; icon: IconComponent; title: string; value: number; unit: string; series: number[]; decimals?: number }) {
  return (
    <GradientCard domain={domain} size="tile" head={<CardHead icon={icon} title={title} />}>
      <HeroNumber value={value} decimals={decimals} unit={unit} size="num" label={`${title}, ${value} ${unit}`} />
      <GlowLine label={`${title}, last 14 days`} series={series} variant="spark" decimals={decimals} endDot="static" height={64} />
    </GradientCard>
  );
}

function OvernightCard({ quiet = false }: { quiet?: boolean }) {
  return (
    <GradientCard domain="heart" size="card" head={<CardHead icon={HeartPulse} title="Sleeping heart rate" />} foot={<CardFoot state={{ word: 'Settled' }} right={quiet ? undefined : 'Usual 52-60'} />}>
      <HeroNumber value={NIGHT.low.v} unit="bpm" size="num-l" label={`Lowest ${NIGHT.low.v} beats per minute`} quietWord={quiet ? 'Settled by morning' : undefined} />
      <GlowLine
        label="Heart rate overnight"
        unit="bpm"
        series={NIGHT.points}
        from={NIGHT_FROM}
        to={NIGHT_TO}
        spans={NIGHT.awake}
        marks={[{ t: NIGHT.low.t, v: NIGHT.low.v, label: `Lowest ${NIGHT.low.v} · ${clock(NIGHT.low.t)}` }]}
        band="iqr"
        smoothing="night"
        yTicks={3}
        xTicks="hours"
        endDot="static"
        tz={TZ}
        height={132}
        quiet={quiet}
      />
    </GradientCard>
  );
}

function HrvTile({ state, quiet = false }: { state?: 'stale' | 'calibrating' | 'none'; quiet?: boolean }) {
  return (
    <GradientCard
      domain="recovery"
      size="tile"
      head={<CardHead icon={Activity} title="HRV" />}
      foot={<CardFoot state={{ word: state === 'calibrating' ? 'Calibrating' : state === 'none' ? 'No reading' : 'Balanced' }} right={quiet ? undefined : '38-62'} />}
    >
      <HeroNumber value={state === 'none' ? null : 48} unit="ms" size="num" label="HRV, 48 milliseconds" quietWord={quiet ? 'In your usual range' : undefined} />
      <RangeScale label="HRV" value={state === 'none' ? null : 48} min={20} max={80} usual={[38, 62]} unit="ms" spokenUnit="milliseconds" state={state} ageText="3 h ago" quiet={quiet} />
    </GradientCard>
  );
}

function StressCard({ quiet = false }: { quiet?: boolean }) {
  return (
    <GradientCard domain="recovery" size="card" head={<CardHead icon={Gauge} title="Stress today" />} foot={<CardFoot state={{ word: 'Elevated' }} right={quiet ? undefined : 'Ring index'} />}>
      <HeroNumber value={59} size="num-l" label="Stress 59" quietWord={quiet ? 'A little raised' : undefined} />
      <RangeScale label="Stress" value={59} min={0} max={100} bands={STRESS_BANDS} ticks="bands" unit="ring index" quiet={quiet} />
    </GradientCard>
  );
}

function SleepTimingCard({ quiet = false, late = false, none = false, clipped = false }: { quiet?: boolean; late?: boolean; none?: boolean; clipped?: boolean }) {
  const from = late ? at(0, 40) : at(23, 12, '2026-10-29');
  const to = late ? at(8, 22) : at(7, 8);
  return (
    <GradientCard domain="sleep" size="card" head={<CardHead icon={Moon} title="Sleep timing" />} foot={<CardFoot state={{ word: late ? 'Later than usual' : 'Close to usual' }} right={quiet ? undefined : 'Usual 23:00-07:00'} />}>
      <WindowBar
        label="Sleep timing"
        axis={[at(20, 0, '2026-10-29'), at(12, 0)]}
        usual={{ from: at(23, 0, '2026-10-29'), to: at(7, 0) }}
        actual={none ? undefined : clipped ? { from: at(18, 30, '2026-10-29'), to: at(7, 8) } : { from, to }}
        marks={none ? [] : clipped ? [{ t: to, label: `Woke ${clock(to)}` }] : [{ t: from, label: `Fell asleep ${clock(from)}` }, { t: to, label: `Woke ${clock(to)}` }]}
        quiet={quiet}
        tz={TZ}
      />
    </GradientCard>
  );
}

/* ------------------------------------------------------------------ the section */

export default function LineScaleStackWindowSpecimens() {
  const [run, setRun] = useState(0);
  // the key remounts every picture, so its draw-in can be seen again
  const k = useMemo(() => `run-${run}`, [run]);
  return (
    <GallerySection id="g-lines" title="Lines, scales, stacks, windows" caption="GlowLine · RangeScale · StackBar · WindowBar">
      <Row>
        <Key size="sm" variant="outlined" onClick={() => setRun((n) => n + 1)}>
          Replay motion
        </Key>
        <MonoMeta>Draw-in, sweep and the end-dot pulses; reduced motion shows the final frame</MonoMeta>
      </Row>

      <Spec name="GlowLine · hero card" note="line, likely range to bedtime, dotted projection, plan line, live end dot with its now label; the stack above is StackBar">
        <EnergyHero key={k} />
      </Spec>
      <Spec name="GlowLine · quiet" note="the line still draws; no digit anywhere, in the DOM or the name">
        <EnergyHero key={`${k}-q`} quiet />
      </Spec>
      <Spec name="GlowLine · overnight" note="night smoothing, interquartile band, awake spans (hatched), the lowest reading marked, y and x labels; a finished series, so a static end dot">
        <OvernightCard key={k} />
        <OvernightCard key={`${k}-q`} quiet />
      </Spec>
      <Spec name="GlowLine · spark tiles" note="weight trend: normal, stale (hollow dot), no readings, loading, quiet" cols="tiles">
        <WeightTile key={k} />
        <WeightTile key={`${k}-s`} state="stale" />
        <WeightTile key={`${k}-n`} state="none" />
        <WeightTile key={`${k}-l`} state="loading" />
        <WeightTile key={`${k}-q`} quiet />
      </Spec>
      <Spec name="GlowLine · domain hues" note="the line and the dot are ivory in every hue; the hue is the card's glow" cols="tiles">
        <HueTile key={k} domain="steps" icon={Footprints} title="Steps" value={7605} unit="" series={STEPS_TREND} />
        <HueTile key={`${k}-r`} domain="recovery" icon={Activity} title="HRV" value={48} unit="ms" series={HRV_TREND} />
        <HueTile key={`${k}-s`} domain="sleep" icon={Moon} title="Sleep" value={7.9} decimals={1} unit="h" series={[7.2, 6.8, 7.5, 8.1, 7.0, 6.5, 7.8, 8.0, 7.4, 7.1, 7.7, 8.2, 7.6, 7.9]} />
        <HueTile key={`${k}-h`} domain="heart" icon={HeartPulse} title="Resting rate" value={56} unit="bpm" series={[58, 57, 57, 59, 58, 56, 57, 56, 55, 57, 56, 56, 55, 56]} />
      </Spec>

      <Spec name="RangeScale · tiles" note="41 ticks, the usual range lit in the hue, a 3 px ivory marker; normal, stale (hollow marker, age, gold dot), calibrating (dashed), no reading, quiet" cols="tiles">
        <HrvTile key={k} />
        <HrvTile key={`${k}-s`} state="stale" />
        <HrvTile key={`${k}-c`} state="calibrating" />
        <HrvTile key={`${k}-n`} state="none" />
        <HrvTile key={`${k}-q`} quiet />
      </Spec>
      <Spec name="RangeScale · bands" note="long ticks at the band edges, each band named with a mark and its word (never colour alone); the current band in ivory. In a tile too narrow for every word, the current band is named once">
        <StressCard key={k} />
        <StressCard key={`${k}-q`} quiet />
        <div style={{ maxWidth: 190 }}>
          <StressCard key={`${k}-n`} />
        </div>
      </Spec>
      <Spec name="RangeScale · end labels and inline" note="a scale with words at its ends (reference 2's Light); the 96 px glyph of a list row">
        <GradientCard domain="neutral" size="card" head={<CardHead icon={Timer} title="Light" />}>
          <HeroNumber value={3400} unit="K" size="num" label="Light, 3400 kelvin" />
          <RangeScale key={k} label="Light" value={3400} min={2000} max={6500} endLabels={['Warm', '6500 K']} unit="K" spokenUnit="kelvin" hue="energy" />
        </GradientCard>
        <GradientCard domain="recovery" size="card" head={<CardHead icon={Activity} title="Signals" />}>
          {[
            { name: 'HRV', v: 48, lo: 20, hi: 80, u: [38, 62] as const },
            { name: 'Skin temperature', v: 0.4, lo: -2, hi: 2, u: [-0.6, 0.6] as const },
            { name: 'Resting load', v: 71, lo: 0, hi: 100, u: [35, 65] as const },
          ].map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span className="lm-mono">{s.name}</span>
              <RangeScale key={k} label={s.name} value={s.v} min={s.lo} max={s.hi} usual={s.u} size="inline" decimals={s.name === 'Skin temperature' ? 1 : 0} />
            </div>
          ))}
          <RangeScale label="Blood oxygen" value={96} min={90} max={100} usual={[95, 100]} size="inline" state="stale" ageText="1 h ago" />
        </GradientCard>
      </Spec>

      <Spec name="StackBar · compositions" note="one bar, 2 px card-colour gaps, every part named in the legend (2 x 2 on a phone, four columns from 1024); stage hues, heart-rate zones, macros with an uncounted part" cols={2}>
        <GradientCard domain="sleep" size="card" head={<CardHead icon={Moon} title="Sleep stages" />}>
          <StackBar key={k} label="Sleep stages" rows={STAGES} total={`7${NBSP}h 56`} />
        </GradientCard>
        <GradientCard domain="heart" size="card" head={<CardHead icon={HeartPulse} title="Time in zones" />}>
          <StackBar key={k} label="Heart-rate zones" rows={ZONES} legend="inline" />
        </GradientCard>
        <GradientCard domain="food" size="card" head={<CardHead icon={Flame} title="Macros" />}>
          <StackBar key={k} label="Macros so far" rows={MACROS} size="sm" legend="inline" />
        </GradientCard>
        <GradientCard domain="sleep" size="card" head={<CardHead icon={Moon} title="Sleep stages, quiet" />}>
          <StackBar key={k} label="Sleep stages" rows={STAGES} quiet />
        </GradientCard>
      </Spec>

      <Spec name="WindowBar · timing" note="the usual window a hairline band, the night a solid bar, marks with their words, round hours on the axis; later than usual, no night recorded, past the axis, quiet">
        <SleepTimingCard key={k} />
        <SleepTimingCard key={`${k}-l`} late />
        <SleepTimingCard key={`${k}-n`} none />
        <SleepTimingCard key={`${k}-c`} clipped />
        <SleepTimingCard key={`${k}-q`} quiet late />
      </Spec>
    </GallerySection>
  );
}
