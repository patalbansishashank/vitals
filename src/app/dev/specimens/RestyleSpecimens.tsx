/**
 * Gallery section "g-restyled": the five restyled shared pictures (Hypnogram, StateStrip, Stat, ShareBar, TwinTable and
 * its key) on real cards, with the states a page meets: a full night, a night with a long stretch no stage was given
 * for, a night in parts, quiet, the texture for chartPatterns, stress and heart-rate ramps by hue, the labelled day
 * strip, stat tiles (hue dot, chips, stale, loading, quiet), share rows (hue dots, zero, unknown) and the twin with its
 * text key. Synthetic numbers (PRODUCT.md): the sleep night is RESEARCH's, the rest are made up.
 */
import { useState, type ReactNode } from 'react';
import { Activity, HeartPulse, Moon, Scale, Utensils } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  GradientCard,
  HeroNumber,
  Hypnogram,
  MonoMeta,
  ShareBar,
  Stat,
  StatGroup,
  StateStrip,
  TwinKey,
  VizTwinTable,
  type RawStageSpan,
  type ShareBarRow,
} from '@/components';
import { GallerySection, Spec } from './kit';

const DAY = '2026-10-29';
const at = (hhmm: string, day = DAY) => Date.parse(`${day}T${hhmm}:00Z`);
const TZ = 'UTC';

type Run = [state: number | 'mixed' | null, minutes: number];
/** Runs of (stage, minutes) from a start as raw spans: 0 Awake, 1 REM, 2 Light, 3 Deep, null no stage. */
function spans(list: Run[], start: number): RawStageSpan[] {
  let t = start;
  return list.map(([state, mins]) => {
    const from = t;
    t += mins * 60_000;
    return { from, to: t, state };
  });
}
const total = (list: Run[]) => list.reduce((n, [, m]) => n + m, 0) * 60_000;

/** 7 h 56 in bed from 23:12: awake 18 min, REM 1 h 48, light 4 h 32, deep 1 h 18. */
const NIGHT: Run[] = [[2, 16], [3, 30], [2, 24], [1, 10], [2, 20], [3, 36], [2, 28], [1, 16], [0, 4], [2, 32], [3, 12], [2, 26], [1, 24], [2, 20], [0, 6], [1, 28], [2, 28], [0, 8], [2, 22], [1, 30], [2, 56]];
const NIGHT_START = at('23:12', '2026-10-28');
const NIGHT_END = NIGHT_START + total(NIGHT);

/** The same night with 70 minutes the device gave no stage for in the middle (one hatched band, the line breaks). */
const GAPPED: Run[] = [[2, 16], [3, 30], [2, 24], [1, 10], [2, 20], [3, 36], [null, 70], [1, 16], [0, 4], [2, 32], [3, 12], [2, 26], [1, 24], [2, 20], [0, 6], [1, 28], [2, 28], [0, 8], [2, 22], [1, 30], [2, 56]];

/** A night in two parts: 23:12 to 03:10, then 04:05 to 07:08. */
const PART_A: Run[] = [[2, 16], [3, 30], [2, 24], [1, 10], [2, 20], [3, 36], [2, 28], [1, 16], [0, 4], [2, 54]];
const PART_B: Run[] = [[2, 12], [3, 24], [1, 22], [2, 30], [0, 6], [1, 26], [2, 38], [2, 25]];
const PART_B_START = at('04:05');

const night = { from: NIGHT_START, to: NIGHT_END, segments: spans(NIGHT, NIGHT_START), tz: TZ };

function SleepCard({ children, foot, quiet = false }: { children: ReactNode; foot?: ReactNode; quiet?: boolean }) {
  return (
    <GradientCard
      domain="sleep"
      size="card"
      head={<CardHead icon={Moon} title="Sleep" info={{ body: 'Stages come from your ring’s night record: awake, REM, light and deep. The totals add up from the raw record; the picture smooths short flickers.' }} />}
      foot={foot ?? <CardFoot state={{ word: 'Goal met' }} right="Goal 7 h 30" />}
    >
      {quiet ? (
        <HeroNumber size="num-l" label="A full night" value={null} quietWord="A full night" />
      ) : (
        <HeroNumber size="num-l" label="7 hours 56 minutes" parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} />
      )}
      <MonoMeta>{quiet ? 'Fell asleep late evening' : '23:12 – 07:08'}</MonoMeta>
      {children}
    </GradientCard>
  );
}

/** A day of stress readings: calm early, elevated late morning, high mid-afternoon; none after 14:10. */
const STRESS = [
  { from: at('02:20'), to: at('10:50'), state: 0 },
  { from: at('11:15'), to: at('12:40'), state: 2 },
  { from: at('13:00'), to: at('14:10'), state: 3 },
];

/** The 24 h plan: sleep, fast, eating with a session in it, fast, sleep. */
const PLAN = [
  { from: at('00:00'), to: at('06:30'), state: 0 },
  { from: at('06:30'), to: at('12:00'), state: 1 },
  { from: at('12:00'), to: at('17:30'), state: 2 },
  { from: at('17:30'), to: at('18:15'), state: 3 },
  { from: at('18:15'), to: at('20:00'), state: 2 },
  { from: at('20:00'), to: at('22:30'), state: 1 },
  { from: at('22:30'), to: at('23:59'), state: 0 },
];

/** A 45 minute session in five heart-rate zones. */
const ZONES = [
  { from: at('17:30'), to: at('17:36'), state: 0 },
  { from: at('17:36'), to: at('17:46'), state: 1 },
  { from: at('17:46'), to: at('18:02'), state: 2 },
  { from: at('18:02'), to: at('18:09'), state: 3 },
  { from: at('18:09'), to: at('18:12'), state: 4 },
  { from: at('18:12'), to: at('18:15'), state: 1 },
];

const MACROS: ShareBarRow[] = [
  { id: 'protein', label: 'Protein', valueText: '32 of 150 g', share: 0.21, hue: 'var(--lm-macro-protein)' },
  { id: 'carbs', label: 'Carbs', valueText: '80 of 180 g', share: 0.44, hue: 'var(--lm-macro-carbs)' },
  { id: 'fat', label: 'Fat', valueText: '20 of 60 g', share: 0.33, hue: 'var(--lm-macro-fat)' },
  { id: 'fibre', label: 'Fibre', valueText: '6 of 30 g', share: 0.2, hue: 'var(--lm-macro-fibre)' },
  { id: 'alcohol', label: 'Alcohol', valueText: '0 g', share: 0, hue: 'var(--lm-macro-alcohol)' },
  { id: 'other', label: 'Not named', valueText: '14 g', share: 0.12, hue: 'var(--lm-ink-3)', unknown: true },
];

const WEIGHT = [
  ['Mon 26 Oct', '86.4'],
  ['Tue 27 Oct', '86.1'],
  ['Wed 28 Oct', '85.9'],
  ['Thu 29 Oct', '85.2'],
];

function TwinSpecimen() {
  const [open, setOpen] = useState(true);
  return (
    <GradientCard domain="body" size="card" head={<CardHead icon={Scale} title="Weight" />} foot={<CardFoot state={{ word: 'Behind' }} right="Goal 1 Jan" />}>
      <HeroNumber size="num" label="85.2 kilograms" value={85.2} decimals={1} unit="kg" />
      <div>
        <TwinKey open={open} onToggle={() => setOpen((o) => !o)} controls="g-restyled-twin" />
        {open ? (
          <VizTwinTable id="g-restyled-twin" title="Weight trend table" caption="Weight, last four days" rows={WEIGHT.length} fileName="vitals-weight.csv" csv={() => WEIGHT.map((r) => r.join(',')).join('\n')}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Trend (kg)</th>
              </tr>
            </thead>
            <tbody>
              {WEIGHT.map(([d, v]) => (
                <tr key={d}>
                  <th scope="row">{d}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </VizTwinTable>
        ) : null}
      </div>
    </GradientCard>
  );
}

/** Card-sized specimens: one column on a phone, two or more from there (auto-fit collapses the unused tracks). */
function Cards({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 'var(--lm-card-gap)', alignItems: 'start' }}>{children}</div>;
}

export default function RestyleSpecimens() {
  return (
    <GallerySection id="g-restyled" title="Restyled pictures" caption="Hypnogram · StateStrip · Stat · ShareBar · TwinTable">
      <Spec name="<Hypnogram>" note="four rows, 10 to 12 px blocks, mono caps row words, legend of name and duration (RAW totals), blocks wipe in on first view">
        <Cards>
          <SleepCard>
            <Hypnogram label="Sleep stages" {...night} legend twin={false} />
          </SleepCard>
          <SleepCard foot={<CardFoot state={{ word: 'Goal met' }} right="Goal 7 h 30" />}>
            <Hypnogram label="Sleep stages" {...night} legend hatch twin={false} />
          </SleepCard>
        </Cards>
      </Spec>

      <Spec name="<Hypnogram> gaps and parts" note="a stretch with no stage is one hatched band and the line breaks; a night in parts shares one axis">
        <Cards>
          <SleepCard>
            <Hypnogram label="Sleep stages" from={NIGHT_START} to={NIGHT_END} segments={spans(GAPPED, NIGHT_START)} tz={TZ} legend />
          </SleepCard>
          <SleepCard foot={<CardFoot state={{ word: 'In two parts' }} right="23:12 – 03:10 · 04:05 – 07:08" />}>
            <Hypnogram
              label="Sleep stages"
              sessions={[
                { from: NIGHT_START, to: NIGHT_START + total(PART_A), segments: spans(PART_A, NIGHT_START) },
                { from: PART_B_START, to: PART_B_START + total(PART_B), segments: spans(PART_B, PART_B_START) },
              ]}
              tz={TZ}
              legend
            />
          </SleepCard>
        </Cards>
      </Spec>

      <Spec name="<Hypnogram> quiet" note="words only: no clock, no figures, no table">
        <Cards>
          <SleepCard quiet foot={<CardFoot state={{ word: 'Goal met' }} />}>
            <Hypnogram label="Sleep stages" {...night} legend quiet />
          </SleepCard>
        </Cards>
      </Spec>

      <Spec name="<StateStrip> ordinal ramps by hue" note="four lightness steps of the domain hue, the top state hatched; the default dusk ramp stays for anything without one">
        <Cards>
          <GradientCard domain="recovery" size="card" head={<CardHead icon={Activity} title="Stress" />} foot={<CardFoot state={{ word: 'Mostly calm' }} right="No readings after 14:10" />}>
            <StateStrip label="Stress today" from={at('00:00')} to={at('00:00', '2026-10-30')} now={at('14:58')} segments={STRESS} stateLabels={['Calm', 'Normal', 'Elevated', 'High']} hue="recovery" tz={TZ} twin={false} />
          </GradientCard>
          <GradientCard domain="heart" size="card" head={<CardHead icon={HeartPulse} title="Zones over time" />} foot={<CardFoot state={{ word: 'Mostly zone 3' }} right="45 min" />}>
            <StateStrip label="Heart-rate zones" from={at('17:30')} to={at('18:15')} segments={ZONES} stateLabels={['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5']} hue="heart" ticks="span" tz={TZ} twin={false} />
          </GradientCard>
          <GradientCard domain="neutral" size="card" head={<CardHead icon={Activity} title="The default ramp" />}>
            <StateStrip label="Stress today" from={at('00:00')} to={at('00:00', '2026-10-30')} now={at('14:58')} segments={STRESS} stateLabels={['Calm', 'Normal', 'Elevated', 'High']} tz={TZ} twin={false} />
          </GradientCard>
        </Cards>
      </Spec>

      <Spec name="<StateStrip> your day, labelled" note="category mode on the domain hues: the word inside each segment wide enough, so no legend and nothing by colour alone; the now tick pulses twice">
        <Cards>
          <GradientCard domain="plan" size="card" head={<CardHead icon={Utensils} title="Your day" />} foot={<CardFoot state={{ word: '2 of 7 done' }} right="Eat 12:00 – 20:00" />}>
            <StateStrip label="Your day" from={at('00:00')} to={at('00:00', '2026-10-30')} now={at('14:58')} segments={PLAN} stateLabels={['Sleep', 'Fast', 'Eating', 'Train']} stateHues={['sleep', 'energy', 'food', 'steps']} mode="category" labels tz={TZ} twin={false} />
          </GradientCard>
          <GradientCard domain="plan" size="card" head={<CardHead icon={Utensils} title="Your day, quiet" />}>
            <StateStrip label="Your day" from={at('00:00')} to={at('00:00', '2026-10-30')} now={at('14:58')} segments={PLAN} stateLabels={['Sleep', 'Fast', 'Eating', 'Train']} stateHues={['sleep', 'energy', 'food', 'steps']} mode="category" labels quiet tz={TZ} twin={false} />
          </GradientCard>
        </Cards>
      </Spec>

      <Spec name="<Stat> tiles" note="mono caps label with a hue dot, 22 px value with a small muted unit, the chip one fact line; no rules between cells">
        <Cards>
          <GradientCard domain="recovery" size="card" head={<CardHead icon={Activity} title="Last night" />}>
            <StatGroup label="Last night" columns={3}>
              <Stat label="HRV" value="48" unit="ms" hue="recovery" chip={{ kind: 'delta', dir: 'down', text: '−6 ms vs usual', caution: true }} />
              <Stat label="Resting HR" value="52" unit="bpm" hue="heart" chip={{ kind: 'status', severity: 'ok', word: 'Usual' }} />
              <Stat label="Skin temperature" value={null} hue="recovery" chip={{ kind: 'provisional', text: 'Calibrating · night 3 of 7' }} />
              <Stat label="SpO2" value="95" unit="%" state="stale" chip={{ kind: 'qualifier', text: '3 h ago' }} info={{ text: 'The lowest stable reading of the night.', method: 'sleep-metrics/1' }} />
              <Stat label="Respiration" value="14.2" unit="br/min" state="loading" />
              <Stat label="Steps" value="8 412" chip={{ kind: 'qualifier', text: 'a day' }} />
            </StatGroup>
          </GradientCard>
          <GradientCard domain="recovery" size="card" head={<CardHead icon={Activity} title="Last night, quiet" />}>
            <StatGroup label="Last night" columns={3}>
              <Stat label="HRV" value="48" unit="ms" hue="recovery" quiet chip={{ kind: 'status', severity: 'ok', word: 'Balanced' }} />
              <Stat label="Resting HR" value="52" unit="bpm" hue="heart" quiet chip={{ kind: 'status', severity: 'ok', word: 'Usual' }} />
              <Stat label="SpO2" value="95" unit="%" quiet chip={{ kind: 'status', severity: 'ok', word: 'Normal' }} />
            </StatGroup>
          </GradientCard>
        </Cards>
      </Spec>

      <Spec name="<ShareBar> rows" note="a hue dot, name 14/500, value 15/500 tabular, share in mono caps; zero is an empty track, unknown an outlined dot; fills grow from the left, 60 ms apart">
        <Cards>
          <GradientCard domain="food" size="card" head={<CardHead icon={Utensils} title="Macros" />} foot={<CardFoot state={{ word: 'Partial' }} right="Target 2 050 kcal" />}>
            <ShareBar label="Macros" rows={MACROS} size="sm" shareOf="of the target" note="Not named: food with no figure for that nutrient." />
          </GradientCard>
          <GradientCard domain="heart" size="card" head={<CardHead icon={HeartPulse} title="Zones" />}>
            <ShareBar
              label="Heart-rate zones"
              shareOf="of the session"
              rows={[
                { id: 'z1', label: 'Zone 1', valueText: '10 min', share: 0.22, hue: 'var(--lm-hr-zone-1)' },
                { id: 'z2', label: 'Zone 2', valueText: '13 min', share: 0.29, hue: 'var(--lm-hr-zone-2)' },
                { id: 'z3', label: 'Zone 3', valueText: '16 min', share: 0.36, hue: 'var(--lm-hr-zone-3)' },
                { id: 'z4', label: 'Zone 4', valueText: '5 min', share: 0.11, hue: 'var(--lm-hr-zone-4)' },
                { id: 'z5', label: 'Zone 5', valueText: '1 min', share: 0.02, hue: 'var(--lm-hr-zone-5)' },
              ]}
            />
          </GradientCard>
        </Cards>
      </Spec>

      <Spec name="<TwinTable> and its key" note="the Table key is a text key with the table icon in both states; the table keeps its markup and gets a calmer type">
        <TwinSpecimen />
      </Spec>
    </GallerySection>
  );
}
