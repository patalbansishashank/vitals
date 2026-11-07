/**
 * Gallery section "g-layout2" (r071 0B): the day Rail with every node status, the CardGrid with Today's default set
 * (phone and desktop, with and without the ring, live reorder), `packRows` worked through, and the CardLibrary.
 * Numbers are synthetic (PRODUCT.md): the ones RESEARCH §0 gave, as in the prototype.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Activity, Clapperboard, Dumbbell, Flame, Footprints, HeartPulse, ListChecks, Moon, Scale, Target, Timer, Utensils, Waves } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Key, MonoMeta } from '@/components';
import { CardGrid, packRows, type CardGridItem, type CardSize } from '@/components/CardGrid';
import { CardLibrary, defaultSelection, type LibraryItem, type LibrarySelection } from '@/components/CardLibrary';
import { Rail, RailNode, RailRow, type RailStatus } from '@/components/Rail';
import { GallerySection, Row, Spec } from './kit';

/* ------------------------------------------------------------------ the rail */

function RailSpecimen() {
  const [snack, setSnack] = useState<RailStatus>('empty');
  const [sets, setSets] = useState(2);
  return (
    <GradientCard domain="plan" size="card" head={<CardHead icon={ListChecks} title="Plan" />} foot={<CardFoot state={{ word: '2 of 7 done' }} right="Eat 12:00-20:00" />}>
      <Rail label="Today's plan">
        <RailRow time="08:00" node={<RailNode status="done" label="Weigh in: logged" />} title="Weigh in" meta={['Morning', '85.2 kg']} />
        <RailRow time="12:30" node={<RailNode status="done" label="Lunch: logged as planned" onPress={() => {}} />} title="Rajma and rice" meta={['Lunch', '600 kcal', '31 g protein']} onOpen={() => {}} />
        <RailRow
          time="16:30"
          node={<RailNode status={snack} label={snack === 'done' ? 'Snack: logged, undo' : 'Snack: log as planned'} onPress={() => setSnack((s) => (s === 'done' ? 'empty' : 'done'))} />}
          title="Snack"
          meta={['Food', '390 kcal', '29 g protein']}
          onOpen={() => {}}
        />
        <RailRow time="17:30" node={<RailNode status="empty" glyph={Dumbbell} hue="steps" label="Lift: log as planned" onPress={() => {}} />} title="Lift" meta={['Training', '45 min']} onOpen={() => {}} />
        <RailRow time="19:30" node={<RailNode status="partial" glyph={Utensils} hue="food" label="Dinner: partly logged" onPress={() => {}} />} title="Dinner" meta={['Food', '902 kcal']} onOpen={() => {}} trailing={<MonoMeta>Partly</MonoMeta>} />
        <RailRow time="20:00" node={<RailNode status="skipped" label="Walk: skipped" />} title="Walk" meta={['Movement', '25 min']} />
        <RailRow time="21:00" node={<RailNode status="assumed" label="Sleep: filled in for you" />} title="Wind down" meta="Filled in for you" />
      </Rail>
      <Rail label="Squats, by set">
        <RailRow
          node={<RailNode status={sets === 4 ? 'done' : 'empty'} segments={4} lit={sets} number={`${sets}/4`} size={44} label={`Squat: ${sets} of 4 sets`} onPress={() => setSets((n) => (n >= 4 ? 0 : n + 1))} />}
          title="Back squat"
          meta={['4 sets', '8 reps', '60 kg']}
        />
      </Rail>
    </GradientCard>
  );
}

function RailPlain() {
  return (
    <GradientCard domain="food" size="card" head={<CardHead icon={Utensils} title="Meals" />}>
      <Rail label="Meals" timeAt="end">
        <RailRow node={<RailNode status="done" label="Breakfast: logged" />} time="08:10" title="Oats and curd" meta={['Breakfast', '410 kcal']} />
        <RailRow node={<RailNode status="empty" label="Lunch: log as planned" onPress={() => {}} />} time="13:00" title="Rajma and rice" meta={['Lunch', '600 kcal']} onOpen={() => {}} />
        <RailRow node={<RailNode status="empty" label="Dinner: log as planned" onPress={() => {}} />} time="19:30" title="Dinner" meta="For example roasted chana" onOpen={() => {}} />
      </Rail>
    </GradientCard>
  );
}

/* ------------------------------------------------------------------ the grid */

interface Def {
  id: string;
  size: CardSize;
  node: ReactNode;
}

function todayCards(): Record<string, Def> {
  return {
    hero: {
      id: 'hero',
      size: 'hero',
      node: (
        <GradientCard domain="plan" size="hero" head={<CardHead icon={ListChecks} title="Today" />} foot={<CardFoot state={{ word: '2 of 7 done' }} right="Eat 12:00-20:00" />}>
          <MonoMeta tone="ink">Next up · in 3 h 10</MonoMeta>
          <HeroNumber value="16:30" size="time" numerals="tabular" label="Snack at 16:30" />
        </GradientCard>
      ),
    },
    eaten: {
      id: 'eaten',
      size: 'card',
      node: (
        <GradientCard domain="food" size="card" head={<CardHead icon={Utensils} title="Eaten so far" />} foot={<CardFoot state={{ word: 'On plan' }} right="Target 1,850" />}>
          <HeroNumber value={750} unit="kcal" size="num-l" label="750 kilocalories eaten so far" />
        </GradientCard>
      ),
    },
    energy: {
      id: 'energy',
      size: 'card',
      node: (
        <GradientCard domain="energy" size="card" head={<CardHead icon={Flame} title="Energy" />} foot={<CardFoot state={{ word: 'On plan' }} right="By bedtime 2,595" />}>
          <HeroNumber value={1096} unit="kcal" size="num-l" label="1,096 kilocalories burned so far" range="Likely 983-1,209" />
        </GradientCard>
      ),
    },
    sleep: {
      id: 'sleep',
      size: 'card',
      node: (
        <GradientCard domain="sleep" size="card" head={<CardHead icon={Moon} title="Sleep" />} foot={<CardFoot state={{ word: 'Goal met' }} right="Goal 7 h 30" />}>
          <HeroNumber
            parts={[
              { value: 7, unit: 'h' },
              { value: 56, unit: 'm' },
            ]}
            size="num-l"
            label="7 hours 56 minutes asleep"
          />
        </GradientCard>
      ),
    },
    steps: {
      id: 'steps',
      size: 'tile',
      node: (
        <GradientCard domain="steps" size="tile" head={<CardHead icon={Footprints} title="Steps" />} foot={<CardFoot state={{ word: 'On course' }} />}>
          <HeroNumber value={7605} size="num" label="7,605 steps" />
          <MonoMeta>Of 9,000</MonoMeta>
        </GradientCard>
      ),
    },
    weight: {
      id: 'weight',
      size: 'tile',
      node: (
        <GradientCard domain="body" size="tile" head={<CardHead icon={Scale} title="Weight" />} foot={<CardFoot state={{ word: 'Behind' }} />}>
          <HeroNumber value={85.2} decimals={1} unit="kg" size="num" label="85.2 kilograms, trend" />
          <MonoMeta>−1.2 kg · 30 d</MonoMeta>
        </GradientCard>
      ),
    },
    heart: {
      id: 'heart',
      size: 'tile',
      node: (
        <GradientCard domain="heart" size="tile" head={<CardHead icon={HeartPulse} title="Heart points" />} foot={<CardFoot state={{ word: 'Goal met' }} />}>
          <HeroNumber value={58} size="num" label="58 heart points" />
          <MonoMeta>Of 150</MonoMeta>
        </GradientCard>
      ),
    },
  };
}

const DEFAULT_ORDER = ['hero', 'eaten', 'energy', 'sleep', 'steps', 'weight'];

function GridSpecimen() {
  const defs = useMemo(() => todayCards(), []);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [ring, setRing] = useState(true);
  const shown = order.filter((id) => ring || id !== 'sleep');
  const items: CardGridItem[] = shown.map((id) => defs[id]!);
  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const weightFirst = () => setOrder((o) => ['hero', 'weight', ...o.filter((x) => x !== 'hero' && x !== 'weight')]);
  return (
    <>
      <Row>
        <Key size="sm" variant="outlined" pressed={!ring} onClick={() => setRing((r) => !r)}>
          {ring ? 'Take the ring away' : 'Give the ring back'}
        </Key>
        <Key size="sm" variant="outlined" onClick={weightFirst}>
          Move Weight up
        </Key>
        <Key size="sm" variant="outlined" onClick={() => toggle('heart')}>
          {order.includes('heart') ? 'Remove Heart points' : 'Add Heart points'}
        </Key>
        <Key size="sm" variant="text" onClick={() => setOrder(DEFAULT_ORDER)}>
          Reset
        </Key>
      </Row>
      <Spec name="Phone, 2 columns" note="hero, card and slim are a full row; two tiles share one; a lone tile widens">
        <div style={{ width: '100%', maxWidth: 390 }}>
          <CardGrid cols={2} items={items} label="Today's cards, phone" />
        </div>
      </Spec>
      <Spec name="Desktop, 12 columns" note="card 6 · tile 3; a row that ends with free columns widens its cards (scrolls sideways on a phone)">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1000 }}>
            <CardGrid cols={12} items={items} label="Today's cards, desktop" />
          </div>
        </div>
      </Spec>
    </>
  );
}

/* ----------------------------------------------------------- packRows, worked */

const CASES: Array<{ name: string; sizes: CardSize[] }> = [
  { name: 'Two tiles', sizes: ['tile', 'tile'] },
  { name: 'A card and a tile', sizes: ['card', 'tile'] },
  { name: 'One tile', sizes: ['tile'] },
  { name: 'Three tiles', sizes: ['tile', 'tile', 'tile'] },
  { name: 'Today, default', sizes: ['hero', 'card', 'card', 'card', 'tile', 'tile'] },
  { name: 'Today, no ring', sizes: ['hero', 'card', 'card', 'tile', 'tile'] },
  { name: 'A tile before a hero', sizes: ['tile', 'hero', 'slim'] },
];

const PACK_ROW: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.5fr)', alignItems: 'baseline', columnGap: 16, padding: '10px 0', borderTop: 'var(--lm-hairline) solid var(--lm-line)' };
const PACK_SPANS: CSSProperties = { fontFamily: 'var(--lm-font-mono)', fontSize: '0.75rem', lineHeight: '1rem', color: 'var(--lm-ink-2)', overflowWrap: 'anywhere' };

function PackTable() {
  const rowsText = (sizes: CardSize[], cols: 2 | 12) =>
    packRows(
      sizes.map((size, id) => ({ id: String(id), size })),
      cols,
    )
      .map((r) => r.map((p) => p.span).join(' + '))
      .join('   |   ');
  return (
    <div role="table" aria-label="packRows, worked" style={{ display: 'grid' }}>
      <div role="row" style={{ ...PACK_ROW, borderTop: 0, paddingTop: 0 }}>
        <MonoMeta role="columnheader">Cards</MonoMeta>
        <MonoMeta role="columnheader">Phone (2)</MonoMeta>
        <MonoMeta role="columnheader">Desktop (12)</MonoMeta>
      </div>
      {CASES.map((c) => (
        <div key={c.name} role="row" style={PACK_ROW}>
          <span role="cell" style={{ display: 'grid', gap: 2, fontSize: '0.875rem', lineHeight: '1.25rem', color: 'var(--lm-ink)' }}>
            {c.name}
            <MonoMeta as="span">{c.sizes.join(' ')}</MonoMeta>
          </span>
          <span role="cell" style={PACK_SPANS}>
            {rowsText(c.sizes, 2)}
          </span>
          <span role="cell" style={PACK_SPANS}>
            {rowsText(c.sizes, 12)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ the library */

const LIBRARY: LibraryItem[] = [
  { id: 'hero', label: 'Today', icon: ListChecks, hue: 'plan', group: 'Plan', locked: true, description: 'Next up, the day and the next rows' },
  { id: 'eaten', label: 'Eaten so far', icon: Utensils, hue: 'food', group: 'Food', default: true, description: 'Energy and protein against today’s targets', valueText: '750 kcal' },
  { id: 'energy', label: 'Energy', icon: Flame, hue: 'energy', group: 'Energy', default: true, description: 'Burned so far, and where the day is heading', valueText: '1,096 kcal' },
  { id: 'sleep', label: 'Sleep', icon: Moon, hue: 'sleep', group: 'Sleep', default: true, unavailable: 'Needs a ring', description: 'Last night, in stages', valueText: '7 h 56' },
  { id: 'steps', label: 'Steps', icon: Footprints, hue: 'steps', group: 'Move', default: true, sizes: ['tile', 'card'], description: 'Steps today against your goal', valueText: '7,605' },
  { id: 'weight', label: 'Weight', icon: Scale, hue: 'body', group: 'Body', default: true, sizes: ['tile', 'card'], description: 'The 14-day trend', valueText: '85.2 kg' },
  { id: 'plan', label: 'Whole-day plan', icon: ListChecks, hue: 'plan', group: 'Plan', description: 'Every stop of the day' },
  { id: 'plan-score', label: 'Plan score', icon: Target, hue: 'plan', group: 'Plan', sizes: ['tile'], description: 'How closely you followed it' },
  { id: 'fast', label: 'Fast', icon: Timer, hue: 'energy', group: 'Energy', sizes: ['tile'], description: 'The fast, live while one runs' },
  { id: 'energy-kinds', label: 'Energy by kind', icon: Flame, hue: 'energy', group: 'Energy', description: 'Resting, light, active, exercise' },
  { id: 'heart-points', label: 'Heart points', icon: HeartPulse, hue: 'heart', group: 'Heart', sizes: ['tile', 'card'], description: 'Counted against 150' },
  { id: 'heart-rate', label: 'Heart rate', icon: HeartPulse, hue: 'heart', group: 'Heart', unavailable: 'Needs a ring', description: 'Now and resting' },
  { id: 'hrv', label: 'HRV vs usual', icon: Activity, hue: 'recovery', group: 'Recovery', unavailable: 'Needs a ring', description: 'Against your own range' },
  { id: 'stress', label: 'Stress today', icon: Waves, hue: 'recovery', group: 'Recovery', unavailable: 'Needs a ring', description: 'How calm the day has been' },
  { id: 'activities', label: 'Today’s activities', icon: Dumbbell, hue: 'steps', group: 'Move', description: 'What you did, and for how long' },
  { id: 'groceries', label: 'Groceries', icon: Utensils, hue: 'food', group: 'Food', description: 'What is left to buy' },
  { id: 'videos', label: 'Short videos', icon: Clapperboard, hue: 'videos', group: 'Recovery', description: 'Today’s count against the limit' },
];

function LibrarySpecimen() {
  const [open, setOpen] = useState(false);
  const [startAt, setStartAt] = useState<'shown' | 'add'>('shown');
  const [sel, setSel] = useState<LibrarySelection[]>(() => defaultSelection(LIBRARY));
  const stored = sel.map((s) => (s.size ? `${s.id}:${s.size}` : s.id));
  const launch = (at: 'shown' | 'add') => {
    setStartAt(at);
    setOpen(true);
  };
  return (
    <>
      <Row>
        <Key size="sm" variant="outlined" onClick={() => launch('shown')}>
          Edit cards
        </Key>
        <Key size="sm" variant="outlined" onClick={() => launch('add')}>
          Add a card
        </Key>
      </Row>
      <div style={{ display: 'grid', gap: 4 }}>
        <MonoMeta>Stored · today cards</MonoMeta>
        <code style={{ fontFamily: 'var(--lm-font-mono)', fontSize: '0.75rem', color: 'var(--lm-ink-2)', overflowWrap: 'anywhere' }}>{JSON.stringify(stored)}</code>
      </div>
      <CardLibrary
        open={open}
        onOpenChange={setOpen}
        title="Today’s cards"
        items={LIBRARY}
        selected={sel}
        onChange={setSel}
        onReset={() => setSel(defaultSelection(LIBRARY))}
        startAt={startAt}
        renderRowAction={(item) => (item.locked || item.unavailable ? null : <MonoMeta size="sm">{item.sizes ? item.sizes.join(' · ') : ''}</MonoMeta>)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ the section */

export default function LayoutSpecimens() {
  return (
    <GallerySection id="g-layout2" title="Rail, card grid, card library" caption="Rail · RailNode · CardGrid · packRows · CardLibrary">
      <Spec name="Rail: every status" note="empty ring · done gold with a check that draws · partial half · skipped struck · filled in for you dashed · a segment per set · tap the Snack tick and the squat ring">
        <RailSpecimen />
      </Spec>
      <Spec name="Rail: times at the end, and no times" note="the list-card form (the time closes the row); a rail where no stop has a time drops the column">
        <RailPlain />
      </Spec>
      <GridSpecimen />
      <Spec name="packRows, worked" note="spans per row; every row is full, nothing leaves a hole">
        <PackTable />
      </Spec>
      <Spec name="Card library" note="a sheet on a phone (60 and 92 %), a 392 px side panel from 1024; the hero is locked; Sleep, Heart rate and the signals need a ring; a search appears above ten cards">
        <LibrarySpecimen />
      </Spec>
    </GallerySection>
  );
}
