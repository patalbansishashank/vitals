/**
 * Gallery section "g-ticks" (r071 0B): RadialTicks, DottedTrack and HighlightBars on real cards, with every state a
 * page meets (normal, over the goal, unknown, provisional, stale, loading, quiet, each domain hue, the phone tile and
 * the wide card). Numbers are synthetic (PRODUCT.md): the ones RESEARCH §0 gave (Steps 7,605 of 9,000, Heart 79 bpm,
 * Eaten 750 of 1,850 kcal, protein 32 of 150 g, Sleep 7 h 56 of 8 h), the rest made up. "Replay motion" remounts the
 * pictures so the sweep, the fill and the bar growth can be seen again (it needs motion allowed; reduced motion shows
 * the final frame at once).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Activity, Flame, Footprints, HeartPulse, Moon, Scale, Utensils, Video, Waves } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Key, MonoMeta, formatNumber, type Domain, type IconComponent } from '@/components';
import { IntakeRing, IntakeTrack } from '@/features/living/components/IntakeViz';
import type { IntakeChannel } from '@/features/living/model/intake';
import { DottedTrack } from '@/components/viz/DottedTrack';
import { HighlightBars } from '@/components/viz/HighlightBars';
import { RadialTicks, type RadialPart } from '@/components/viz/RadialTicks';
import { GallerySection, Row, Spec } from './kit';

const n = (v: number, d = 0) => formatNumber(v, d);

/** Seven ISO dates ending 30 Oct 2026 (a Friday), and the same for any length. */
const daysEnding = (count: number, end = '2026-10-30'): string[] => {
  const t = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(t - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
};
const WEEK = daysEnding(7);
const STEPS = [5260, 7290, 8380, 4810, 7650, 6640, 7605];
const STEPS_30 = Array.from({ length: 30 }, (_, i) => Math.round(6200 + Math.sin(i * 0.9) * 1700 + Math.cos(i * 0.37) * 900 + (i % 7 === 6 ? 1100 : 0)));
const STRENGTH_14 = [0, 45, 0, 40, 0, 0, 55, 0, 45, 0, 35, 0, 0, 45];
const NIGHTS = [452, 410, 498, 465, 380, 476, 436];
const HEART_POINTS = [34, 62, 150, 98, 188, 120, 58];

const PARTS: RadialPart[] = [
  { id: 'recovery', label: 'Recovery', value: 71, hue: 'recovery' },
  { id: 'activity', label: 'Activity', value: 92, hue: 'steps', confidence: 'low' },
  { id: 'sleep', label: 'Sleep', value: 88, hue: 'sleep' },
];
const PARTS_MISSING: RadialPart[] = [PARTS[0]!, PARTS[1]!, { id: 'sleep', label: 'Sleep', value: null, hue: 'sleep', needs: 'needs 3 more nights' }];

const HUES: Array<[Domain, string, IconComponent, number]> = [
  ['heart', 'Heart', HeartPulse, 0.62],
  ['energy', 'Energy', Flame, 0.45],
  ['food', 'Food', Utensils, 0.7],
  ['steps', 'Steps', Footprints, 0.85],
  ['recovery', 'Recovery', Activity, 0.55],
  ['body', 'Body', Scale, 0.4],
  ['sleep', 'Sleep', Moon, 0.9],
  ['videos', 'Videos', Video, 0.3],
];

/** What was eaten, as `intakeModel` returns it (synthetic: Eaten 750 of 1,850 kcal, protein 32 of 150 g). */
const INTAKE: Record<'energy' | 'estimate' | 'over' | 'protein' | 'unknown', IntakeChannel> = {
  energy: { id: 'energy', label: 'Energy', value: 750, target: 1850, kind: 'target', state: 'value', unit: 'kcal', ratio: 750 / 1850, over: false },
  estimate: { id: 'energy', label: 'Energy', value: 1210, lo: 1040, hi: 1390, target: 1850, kind: 'target', state: 'value', unit: 'kcal', ratio: 1210 / 1850, over: false },
  over: { id: 'energy', label: 'Energy', value: 2150, target: 1850, kind: 'target', state: 'value', unit: 'kcal', ratio: 2150 / 1850, over: true },
  protein: { id: 'protein', label: 'Protein', value: 32, target: 150, kind: 'floor', state: 'atLeast', unit: 'g', ratio: 32 / 150, over: false },
  unknown: { id: 'energy', label: 'Energy', value: null, target: 1850, kind: 'target', state: 'unknown', why: 'nothingLogged', unit: 'kcal', ratio: 0, over: false },
};

const STACK: CSSProperties = { display: 'grid', gap: 6 };
const CARDS: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: 'var(--lm-card-gap)', alignItems: 'start' };

/** Cards at their real size: the whole width on a phone, side by side when there is room (Today's `card`). */
function Cards({ children }: { children: ReactNode }) {
  return <div style={CARDS}>{children}</div>;
}

/** A card the way Today draws a tile: icon, title and a picture, nothing else. */
function Tile({ domain, icon, title, children, foot }: { domain: Domain; icon: IconComponent; title: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <GradientCard domain={domain} size="tile" head={<CardHead icon={icon} title={title} />} foot={foot}>
      {children}
    </GradientCard>
  );
}

export default function RingTrackBarsSpecimens() {
  const [run, setRun] = useState(0);
  return (
    <GallerySection id="g-ticks" title="Ticks, tracks and bars" caption="RadialTicks · DottedTrack · HighlightBars">
      <Row>
        <Key size="sm" variant="outlined" onClick={() => setRun((r) => r + 1)}>
          Replay motion
        </Key>
        <MonoMeta>The sweep, the fill and the growth run once, on first view</MonoMeta>
      </Row>

      {/* ---------------------------------------------------------------- RadialTicks */}
      <Spec name="RadialTicks · tiles" note="the page’s one ring: 72 ticks, ivory lit, the hue in the glow; the number sits inside when it is short, above when it is long" cols="tiles">
        <GradientCard
          key={`hr-${run}`}
          domain="heart"
          size="tile"
          head={<CardHead icon={HeartPulse} title="Heart rate" />}
          foot={<CardFoot state={{ word: 'Resting' }} right="60–100" />}
        >
          <RadialTicks label="Heart rate" value={79} max={160} band={[60, 100]} unit="bpm" size="md" centre={<HeroNumber value={79} size="num" unit="bpm" unitPlacement="below" label="79 beats per minute" />} />
        </GradientCard>
        <GradientCard key={`steps-${run}`} domain="steps" size="tile" head={<CardHead icon={Footprints} title="Steps" />} foot={<CardFoot state={{ word: 'On course' }} right="9,000" />}>
          <HeroNumber value={7605} size="num" label="7,605 steps" />
          <RadialTicks label="Steps" value={7605} goal={9000} unit="steps" size="md" centre={<MonoMeta tone="hue">Of 9,000</MonoMeta>} />
        </GradientCard>
        <GradientCard key={`hp-${run}`} domain="heart" size="tile" head={<CardHead icon={Activity} title="Heart Points" />} foot={<CardFoot state={{ word: 'Not all counted' }} />}>
          <RadialTicks label="Heart Points" value={58} goal={150} unit="points" size="md" pending={92} centre={<HeroNumber value={58} size="num" label="58 points" />} />
        </GradientCard>
        <GradientCard key={`eaten-${run}`} domain="food" size="tile" head={<CardHead icon={Utensils} title="Eaten" />} foot={<CardFoot state={{ word: 'On plan' }} right="1,850" />}>
          <RadialTicks label="Energy eaten" value={750} goal={1850} unit="kcal" size="md" band={[640, 860]} centre={<HeroNumber value={750} size="stat" unit="kcal" unitPlacement="below" label="750 kilocalories" />} />
        </GradientCard>
      </Spec>

      <Spec name="RadialTicks · sizes" note="xs 28 · sm 72 · md 120 · lg 160; a count from 6 up (Train: one tick per set)">
        <GradientCard domain="neutral" size="card" head={<CardHead icon={Activity} title="Sizes" />}>
          <Row>
            {(
              [
                ['xs', 28, { value: 4, max: 6, count: 6 }],
                ['sm', 72, { value: 7605, goal: 9000 }],
                ['md', 120, { value: 7605, goal: 9000 }],
                ['lg', 160, { value: 7605, goal: 9000 }],
              ] as const
            ).map(([size, px, p]) => (
              <div key={`${size}-${run}`} style={{ width: px }}>
                <RadialTicks label={size === 'xs' ? 'Sets' : 'Steps'} size={size} {...p} />
              </div>
            ))}
          </Row>
        </GradientCard>
      </Spec>

      <Spec name="RadialTicks · states" note="unknown is not zero; provisional and learning are dashed ticks; stale is dimmed; loading is bare" cols="tiles">
        {(
          [
            ['Normal', { value: 7605, goal: 9000 }],
            ['Zero', { value: 0, goal: 9000 }],
            ['Unknown', { value: null, goal: 9000 }],
            ['Provisional', { value: 7605, goal: 9000, state: 'provisional' }],
            ['Learning', { value: 48, max: 100, state: 'learning' }],
            ['Stale', { value: 7605, goal: 9000, state: 'stale' }],
            ['Loading', { value: 7605, goal: 9000, state: 'loading' }],
            ['Fractional', { value: 7605, goal: 9000, fractional: true }],
          ] as const
        ).map(([name, p]) => (
          <Tile key={`${name}-${run}`} domain="steps" icon={Footprints} title={name}>
            <RadialTicks label={`${name} steps`} unit="steps" size="sm" {...p} />
          </Tile>
        ))}
      </Spec>

      <Spec name="RadialTicks · past the goal and a limit" note="a second lap lights an inner ring of dashes in the ink tint, never rose; a limit has no second lap" cols="tiles">
        <Tile domain="heart" icon={Activity} title="Heart Points">
          <RadialTicks key={`l1-${run}`} label="Heart Points" value={194} goal={150} unit="points" size="md" centre={<HeroNumber value={194} size="stat" label="194 points" />} />
        </Tile>
        <Tile domain="heart" icon={Activity} title="Twice the goal">
          <RadialTicks key={`l2-${run}`} label="Heart Points" value={300} goal={150} unit="points" size="md" centre={<HeroNumber value={300} size="stat" label="300 points" />} />
        </Tile>
        <Tile domain="energy" icon={Flame} title="Over a limit">
          <RadialTicks key={`l3-${run}`} label="Eaten" value={2450} goal={2100} goalKind="limit" unit="kcal" size="md" centre={<HeroNumber value={2450} size="stat" label="2,450 kilocalories" />} />
        </Tile>
        <Tile domain="food" icon={Utensils} title="Protein, a floor">
          <RadialTicks key={`l4-${run}`} label="Protein" value={96} goal={150} goalKind="floor" unit="g" size="md" centre={<HeroNumber value={96} size="stat" unit="g" label="96 grams" />} />
        </Tile>
      </Spec>

      <Spec name="RadialTicks · quiet" note="no numeral anywhere, in the markup or to a screen reader; the fill is three steps, or the ratio when asked" cols="tiles">
        <Tile domain="steps" icon={Footprints} title="Steps">
          <RadialTicks key={`q1-${run}`} label="Steps" value={7605} goal={9000} quiet size="md" centre={<MonoMeta tone="hue">Most of it</MonoMeta>} />
        </Tile>
        <Tile domain="steps" icon={Footprints} title="Steps, ratio">
          <RadialTicks key={`q2-${run}`} label="Steps" value={7605} goal={9000} quiet quietFill="ratio" quietWord="about three quarters" size="md" centre={<MonoMeta tone="hue">About three quarters</MonoMeta>} />
        </Tile>
      </Spec>

      <Spec name="RadialTicks · parts (the Day score)" note="three arcs with 8° gaps, 24 ticks each; a missing part is a dashed outline that says what it needs; a low-confidence part is dashed">
        <Cards>
        <GradientCard key={`d1-${run}`} domain="recovery" size="card" head={<CardHead icon={Waves} title="Day score" />} foot={<CardFoot state={{ word: 'Good' }} right="Target 70" />}>
          <RadialTicks label="Day score" value={84} parts={PARTS} size="lg" centre={<HeroNumber value={84} size="num" label="84 of 100" />} />
        </GradientCard>
        <GradientCard key={`d2-${run}`} domain="recovery" size="card" head={<CardHead icon={Waves} title="Day score" />} foot={<CardFoot state={{ word: 'Based on 2 of 3' }} />}>
          <RadialTicks label="Day score" value={82} parts={PARTS_MISSING} size="lg" centre={<HeroNumber value={82} size="num" label="82 of 100" />} />
        </GradientCard>
        <GradientCard key={`d3-${run}`} domain="recovery" size="card" head={<CardHead icon={Waves} title="Day score, quiet" />}>
          <RadialTicks label="Day score" value={84} parts={PARTS_MISSING} quiet size="lg" quietWord="good" centre={<MonoMeta tone="hue">Good</MonoMeta>} />
        </GradientCard>
        </Cards>
      </Spec>

      <Spec name="RadialTicks · every hue" note="the same ring on each domain’s glow: lit ticks stay ivory, the hue is the card’s" cols="tiles">
        {HUES.map(([domain, name, Icon, share]) => (
          <Tile key={`${domain}-${run}`} domain={domain} icon={Icon} title={name}>
            <RadialTicks label={name} value={share * 100} max={100} size="sm" centre={<MonoMeta tone="hue">{n(share * 100)}%</MonoMeta>} />
          </Tile>
        ))}
      </Spec>

      {/* ---------------------------------------------------------------- DottedTrack */}
      <Spec name="DottedTrack · Eaten so far" note="energy against its target, protein against its floor (lit dots in the food green); the name and the value are the card’s own row">
        <Cards>
        <GradientCard
          key={`eaten-card-${run}`}
          domain="food"
          size="card"
          head={<CardHead icon={Utensils} title="Eaten so far" />}
          foot={<CardFoot state={{ word: 'On plan' }} right="Target 1,850 kcal" />}
        >
          <HeroNumber value={750} unit="kcal" size="num-l" label="750 kilocalories" range="of 1,850" />
          <DottedTrack key={`k-${run}`} label="Energy eaten" value={750} goal={1850} valueText="750 kcal" goalText="of 1,850 kcal" />
          <Row>
            <MonoMeta tone="ink">Protein</MonoMeta>
            <MonoMeta>32 / 150 g</MonoMeta>
          </Row>
          <DottedTrack key={`p-${run}`} label="Protein" value={32} goal={150} goalKind="floor" valueText="32 g" goalText="of 150 g" hue="food" />
        </GradientCard>
        <GradientCard key={`eaten2-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten, over a limit" />} foot={<CardFoot state={{ word: 'Over the limit' }} right="Limit 2,100 kcal" />}>
          <HeroNumber value={2450} unit="kcal" size="num-l" label="2,450 kilocalories" />
          <DottedTrack label="Energy eaten" value={2450} goal={2100} goalKind="limit" valueText="2,450 kcal" goalText="of 2,100 kcal" />
          <Row>
            <MonoMeta tone="ink">Carbs</MonoMeta>
            <MonoMeta>At the goal</MonoMeta>
          </Row>
          <DottedTrack label="Carbs" value={180} goal={180} valueText="180 g" goalText="of 180 g" />
        </GradientCard>
        </Cards>
      </Spec>

      <Spec name="DottedTrack · states" note="unknown draws no thumb and says why; provisional is dotted rings; loading is the bare dots; quiet has no digit">
        <Cards>
        <GradientCard domain="neutral" size="card" head={<CardHead icon={Utensils} title="States" />}>
          {(
            [
              ['Normal', { value: 5000, valueText: '5,000 steps' }],
              ['Unknown', { value: null, valueText: 'Nothing logged yet' }],
              ['Unknown, not in the food', { value: null, valueText: 'Not known for what was logged' }],
              ['Provisional', { value: 5000, valueText: '5,000 steps', state: 'provisional' }],
              ['Loading', { value: 5000, valueText: '5,000 steps', state: 'loading' }],
              ['Quiet', { value: 5000, valueText: '5,000 steps', quiet: true }],
              ['No thumb', { value: 5000, valueText: '5,000 steps', thumb: false }],
            ] as const
          ).map(([name, p]) => (
            <div key={`${name}-${run}`} style={STACK}>
              <MonoMeta>{name}</MonoMeta>
              <DottedTrack label={name} goal={9000} goalText="of 9,000 steps" {...p} />
            </div>
          ))}
        </GradientCard>
        <GradientCard domain="neutral" size="card" head={<CardHead icon={Footprints} title="Goal kinds" />}>
          {(
            [
              ['Target, short', { value: 6400, goalKind: 'target' }],
              ['Target, reached', { value: 9000, goalKind: 'target' }],
              ['Target, passed', { value: 11_200, goalKind: 'target' }],
              ['Floor, at least', { value: 6400, goalKind: 'floor' }],
              ['Limit, inside', { value: 6400, goalKind: 'limit' }],
              ['Limit, over', { value: 11_200, goalKind: 'limit' }],
            ] as const
          ).map(([name, p]) => (
            <div key={`${name}-${run}`} style={STACK}>
              <MonoMeta>{name}</MonoMeta>
              <DottedTrack label={name} goal={9000} valueText={`${n(p.value)} steps`} goalText="of 9,000 steps" {...p} />
            </div>
          ))}
        </GradientCard>
        </Cards>
      </Spec>

      <Spec name="DottedTrack · a plan, a range, a second tone" note="day 15 of 84 with week marks, a planned position, the likely range and end labels; groceries bought versus at home">
        <Cards>
        <GradientCard key={`plan-${run}`} domain="plan" size="card" head={<CardHead icon={Scale} title="Plan day" />} foot={<CardFoot state={{ word: 'On course' }} right="Day 15 of 84" />}>
          <DottedTrack
            label="Plan day"
            value={15}
            goal={84}
            from={0}
            to={84}
            unit="days"
            valueText="Day 15"
            goalText="of 84"
            dots={72}
            ticks={{ majorEvery: 6 }}
            ghost={17}
            band={[13, 19]}
            marks={[{ at: 28, label: 'Week 4' }, { at: 56, label: 'Check-in', tone: 'caution' }]}
            endLabels={['Start 1 Oct', 'Goal 23 Dec']}
          />
        </GradientCard>
        <GradientCard key={`gro-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Groceries" />} foot={<CardFoot state={{ word: '9 of 14 got' }} />}>
          <DottedTrack label="Groceries" value={9} goal={14} valueText="9 items" goalText="of 14" litB="steps" valueB={4} endLabels={['At home 4', 'Bought 5']} />
        </GradientCard>
        </Cards>
      </Spec>

      {/* ---------------------------------------------------------------- IntakeRing, IntakeTrack */}
      <Spec name="IntakeRing and IntakeTrack · what was eaten" note="over one intakeModel channel: an estimate says its range, a second lap past the goal (never rose), a floor says at least, an unknown draws no figure, quiet draws a word and no digit">
        <Cards>
          <GradientCard key={`intake-a-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten so far" />} foot={<CardFoot state={{ word: 'On plan' }} right="Target 1,850 kcal" />}>
            <IntakeRing channel={INTAKE.estimate} />
            <IntakeTrack channel={INTAKE.protein} />
          </GradientCard>
          <GradientCard key={`intake-b-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten, past the target" />} foot={<CardFoot state={{ word: 'Over' }} right="Target 1,850 kcal" />}>
            <IntakeRing channel={INTAKE.over} />
          </GradientCard>
          <GradientCard key={`intake-c-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten, not logged" />} foot={<CardFoot state={{ word: 'Not logged' }} right="Target 1,850 kcal" />}>
            <IntakeRing channel={INTAKE.unknown} />
          </GradientCard>
          <GradientCard key={`intake-d-${run}`} domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten, quiet" />}>
            <IntakeRing channel={INTAKE.energy} quiet />
            <IntakeTrack channel={INTAKE.protein} quiet />
          </GradientCard>
        </Cards>
      </Spec>

      {/* ---------------------------------------------------------------- HighlightBars */}
      <Spec name="HighlightBars · tiles" note="today highlighted, the others the ink tint at 40 %; the goal a hairline; never coloured by goal met" cols="tiles">
        <GradientCard key={`bars-steps-${run}`} domain="steps" size="tile" head={<CardHead icon={Footprints} title="Steps" />} foot={<CardFoot state={{ word: 'On course' }} right="Of 9,000" />}>
          <HeroNumber value={7605} size="num" label="7,605 steps" />
          <HighlightBars dates={WEEK} values={STEPS} goal={9000} unit="steps" name="Steps, last week" />
        </GradientCard>
        <GradientCard key={`bars-hp-${run}`} domain="heart" size="tile" head={<CardHead icon={HeartPulse} title="Heart Points" />}>
          <HeroNumber value={58} size="num" label="58 points" />
          <HighlightBars dates={WEEK} values={HEART_POINTS} goal={150} unit="points" name="Heart Points, last week" highlight={4} />
        </GradientCard>
        <GradientCard key={`bars-sleep-${run}`} domain="sleep" size="tile" head={<CardHead icon={Moon} title="Sleep" />}>
          <HeroNumber parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} size="num" label="7 hours 56 minutes" />
          <HighlightBars
            dates={WEEK}
            values={NIGHTS}
            goal={480}
            unit="min"
            name="Sleep, last week"
            format={(v) => `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')}`}
            outline={[false, false, false, false, false, false, true]}
          />
        </GradientCard>
        <GradientCard key={`bars-active-${run}`} domain="body" size="tile" head={<CardHead icon={Scale} title="Strength" />}>
          <HeroNumber value={45} unit="min" size="num" label="45 minutes" />
          <HighlightBars dates={daysEnding(14)} values={STRENGTH_14} variant="spark" height={32} name="Strength minutes, last 14 days" unit="min" />
        </GradientCard>
      </Spec>

      <Spec name="HighlightBars · the wide card" note="a month with its average (the word in the margin, never over a bar), a goal, stacks per app with a limit, and a day with no reading">
        <Cards>
        <GradientCard key={`bars-30-${run}`} domain="steps" size="card" head={<CardHead icon={Footprints} title="Steps, 30 days" />} foot={<CardFoot state={{ word: 'Steady' }} right="Average 6,900" />}>
          <HighlightBars dates={daysEnding(30)} values={STEPS_30.map((v, i) => (i === 12 ? null : v))} goal={9000} average={6900} height={96} unit="steps" name="Steps, last 30 days" />
        </GradientCard>
        <GradientCard key={`bars-vid-${run}`} domain="videos" size="card" head={<CardHead icon={Video} title="Short videos" />} foot={<CardFoot state={{ word: 'Under the limit' }} right="Limit 40 a day" />}>
          <HighlightBars
            dates={WEEK}
            values={[]}
            name="Short videos, last week"
            limit={40}
            height={96}
            stacks={[
              { id: 'reels', label: 'Reels', hue: 'videos', values: [10, 0, 5, 20, 8, 9, 30] },
              { id: 'shorts', label: 'Shorts', hue: 'recovery', values: [5, 5, 0, 10, 2, 1, 15] },
            ]}
          />
        </GradientCard>
        </Cards>
      </Spec>

      <Spec name="HighlightBars · quiet, no highlight, empty" note="quiet reads weekdays and words against the goal; `highlight={null}` makes every bar the solid; no days is an honest empty picture">
        <Cards>
        <GradientCard domain="steps" size="card" head={<CardHead icon={Footprints} title="Quiet" />}>
          <HighlightBars key={`bq-${run}`} dates={WEEK} values={STEPS} goal={9000} quiet name="Steps, last week" />
        </GradientCard>
        <GradientCard domain="steps" size="card" head={<CardHead icon={Footprints} title="No highlight" />}>
          <HighlightBars key={`bn-${run}`} dates={WEEK} values={STEPS} highlight={null} name="Steps, last week" unit="steps" />
        </GradientCard>
        <GradientCard domain="steps" size="card" head={<CardHead icon={Footprints} title="Empty" />}>
          <HighlightBars dates={[]} values={[]} name="Steps" />
        </GradientCard>
        </Cards>
      </Spec>
    </GallerySection>
  );
}
