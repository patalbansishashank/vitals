/**
 * /dev/components — the living component gallery. Every primitive in its
 * variants and states, in both themes (side by side ≥ 1280 px, or switch).
 * Lazy-loaded, built, never linked from navigation.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Copy, Download, Ellipsis, Lock, Metrics, Pencil, Plus, Repeat, Table, Trash2 } from './galleryIcons';
import {
  Checkbox,
  Chip,
  Dialog,
  EmptyStage,
  Engraved,
  Faceplate,
  Field,
  GradeBadge,
  Glyphs,
  Icon,
  IconKey,
  InlineWarning,
  Key,
  KeyBank,
  KeyLink,
  KeyValueList,
  LinkBank,
  MeasureStepper,
  Menu,
  Meter,
  Notice,
  NumberField,
  Page,
  Popover,
  ProgressRule,
  RadioGroup,
  RangeBar,
  Readout,
  ReadoutInline,
  ReadoutStrip,
  ResponsivePanel,
  RunKey,
  Rule,
  ScaleRange,
  ScaleSlider,
  ScrollRail,
  Section,
  Select,
  Sheet,
  SidePanel,
  Skeleton,
  Spinner,
  Stage,
  StatusMark,
  Stepper,
  Switch,
  Swatch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextInput,
  Tooltip,
  CATEGORY_LABEL,
  toast,
  formatNumber,
  useMediaQuery,
  MQ,
  type MetricCategory,
  type RunKeyState,
  type SheetDetent,
} from '@/components';
import { TopBar } from '@/app/shell';

type Scope = 'split' | 'light' | 'dark' | 'app';

const CATS: MetricCategory[] = ['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones'];

/* -------------------------------------------------------------------------- */

function Specimen({ name, note, children }: { name: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-ink">{name}</span>
        {note ? <span className="lm-eng">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-3 ${className}`}>{children}</div>;
}

function Sheetlet({ id, title, caption, children }: { id?: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <Faceplate as="section" id={id} title={title} caption={caption} className="scroll-mt-[124px] lg:scroll-mt-[80px]">
      <div className="grid gap-5 [&>*]:min-w-0">{children}</div>
    </Faceplate>
  );
}

function Chipline({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="h-10 w-16 rounded-sm border border-line-strong" style={{ background: value }} />
      <span className="text-2xs text-ink-2">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TokensSheet({ anchor }: { anchor: boolean }) {
  const surfaces: Array<[string, string]> = [
    ['chassis', 'var(--lm-chassis)'],
    ['chassis-2', 'var(--lm-chassis-2)'],
    ['face', 'var(--lm-face)'],
    ['well', 'var(--lm-well)'],
    ['raised', 'var(--lm-raised)'],
    ['line', 'var(--lm-line)'],
    ['line-strong', 'var(--lm-line-strong)'],
    ['edge', 'var(--lm-edge)'],
  ];
  const inks: Array<[string, string]> = [
    ['ink', 'var(--lm-ink)'],
    ['ink-2', 'var(--lm-ink-2)'],
    ['ink-3', 'var(--lm-ink-3)'],
    ['ink-faint', 'var(--lm-ink-faint)'],
    ['signal', 'var(--lm-signal)'],
  ];
  return (
    <Sheetlet id={anchor ? 'g-tokens' : undefined} title="Tokens" caption="chrome is achromatic; colour belongs to data">
      <Specimen name="surfaces + lines">
        <Row>{surfaces.map(([l, v]) => <Chipline key={l} label={l} value={v} />)}</Row>
      </Specimen>
      <Specimen name="ink + signal" note="yellow: run key, now-hand, indicator lights — never text, never warnings">
        <Row>{inks.map(([l, v]) => <Chipline key={l} label={l} value={v} />)}</Row>
      </Specimen>
      <Specimen name="category hues" note="one per metric family, fixed forever">
        <Row>
          {CATS.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <Swatch category={c} shape="square" />
              {c}
            </span>
          ))}
        </Row>
      </Specimen>
      <Specimen name="energy balance" note="deficit ↔ maintenance ↔ surplus; neither side is good">
        <div className="flex h-8 overflow-hidden rounded-sm border border-line-strong">
          {['deficit-4', 'deficit-3', 'deficit-2', 'deficit-1', 'neutral', 'surplus-1', 'surplus-2', 'surplus-3', 'surplus-4'].map((t) => (
            <span key={t} className="flex-1" style={{ background: `var(--lm-energy-${t})` }} title={t} />
          ))}
          <span className="flex-1" style={{ background: 'var(--lm-energy-fast)' }} title="fast" />
        </div>
      </Specimen>
      <Specimen name="type" note="Archivo — condensed 84 · normal 100 · wide 112 · display 120">
        <div className="grid gap-2">
          <span className="lm-title" style={{ fontSize: 'var(--lm-text-2xl)', lineHeight: 'var(--lm-text-2xl--lh)' }}>
            Your body
          </span>
          <span className="lm-title">Spring cut</span>
          <span className="text-lg font-semibold">Section title 20</span>
          <span className="text-base">UI body 15 — Paint a block across days.</span>
          <span className="text-sm text-ink-2">Dense UI 13 — likely 18.6–21.0 kg</span>
          <span className="lm-eng">engraved label 12 — energy · window · protein</span>
          <span className="text-2xs text-ink-3" style={{ fontStretch: '84%' }}>
            axis ticks 11 condensed — wk 6 · 12 · 18
          </span>
          <span className="lm-num" style={{ fontSize: 'var(--lm-readout-md)', lineHeight: 1.1, fontWeight: 500 }}>
            23.4<span className="lm-unit">%</span> 2{'\u2009'}540<span className="lm-unit">kcal</span>
          </span>
        </div>
      </Specimen>
    </Sheetlet>
  );
}

function KeysSheet({ anchor }: { anchor: boolean }) {
  const [run, setRun] = useState<RunKeyState>('stale');
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    setRun('running');
    setElapsed(0);
    const t0 = performance.now();
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      setElapsed(s);
      if (s > 1.6) {
        window.clearInterval(timer.current);
        setRun('idle');
      }
    }, 100);
  };
  const [pressed, setPressed] = useState(true);
  return (
    <Sheetlet id={anchor ? 'g-keys' : undefined} title="Keys" caption="Key · IconKey · RunKey">
      <Specimen name="<Key variant>" note="default · solid · quiet · danger · signal (Run / Find plans only)">
        <Row>
          <Key>Copy week</Key>
          <Key variant="solid">Open in Simulator</Key>
          <Key variant="quiet">Reset to program B</Key>
          <Key variant="danger">Reset everything</Key>
          <Key variant="signal" shape="pill" size="lg">
            Find plans
          </Key>
        </Row>
      </Specimen>
      <Specimen name="size · icon · indicator · shortcut">
        <Row>
          <Key size="sm" icon={Copy}>
            Copy
          </Key>
          <Key icon={Repeat}>Repeat to end</Key>
          <Key size="lg" icon={Download}>
            Export data
          </Key>
          <Key indicator={false}>armed off</Key>
          <Key indicator>armed</Key>
          <Key shortcut="⌘Z" variant="quiet">
            Undo
          </Key>
        </Row>
      </Specimen>
      <Specimen name="states" note="pressed · disabled (with reason, focusable) · disabled · loading">
        <Row>
          <Key pressed={pressed} indicator={pressed} onClick={() => setPressed((p) => !p)}>
            B · rest day
          </Key>
          <Key disabledReason="Select at least two days first.">Paste</Key>
          <Key disabled>Disabled</Key>
          <Key loading icon={Download}>
            Exporting
          </Key>
          <Key loading variant="solid">
            Importing
          </Key>
        </Row>
      </Specimen>
      <Specimen name="<IconKey>" note="32 / 40 / 48 · label required (tooltip)">
        <Row>
          <IconKey icon={Table} label="Table view" size="sm" />
          <IconKey icon={Metrics} label="Metrics" />
          <IconKey icon={Pencil} label="Edit program" variant="default" />
          <IconKey icon={Plus} label="New program" variant="default" size="lg" />
          <IconKey icon={Trash2} label="Delete scenario" variant="danger" />
          <IconKey icon={Lock} label="Locked" disabledReason="Unlock another macro to go further." />
        </Row>
      </Specimen>
      <Specimen name="<KeyLink>">
        <Row>
          <KeyLink to="/settings#data" icon={Download}>
            Settings › Your data
          </KeyLink>
          <KeyLink to="/evidence" variant="quiet" size="sm">
            Open in Evidence
          </KeyLink>
        </Row>
      </Specimen>
      <Specimen name="<RunKey>" note="idle · stale (ink dot, 1 o'clock) · running (elapsed, arc) · disabled · lg for the mobile action bar">
        <Row className="gap-6">
          <RunKey state={run} elapsed={elapsed} caption="84 days" onRun={start} />
          <RunKey state="idle" onRun={() => undefined} />
          <RunKey state="stale" onRun={() => undefined} />
          <RunKey state="running" elapsed={1.2} onRun={() => undefined} />
          <RunKey disabledReason="Paint at least one week first." onRun={() => undefined} />
          <RunKey size="lg" state="stale" onRun={() => undefined} />
        </Row>
      </Specimen>
    </Sheetlet>
  );
}

function ChoiceSheet({ anchor }: { anchor: boolean }) {
  const [units, setUnits] = useState('metric');
  const [view, setView] = useState('lanes');
  const [zoom, setZoom] = useState('84');
  const [sex, setSex] = useState('male');
  const [pos, setPos] = useState('flush');
  const [sw1, setSw1] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [c1, setC1] = useState(true);
  const [c2, setC2] = useState(false);
  const [radio, setRadio] = useState('merge');
  const [strength, setStrength] = useState<string | undefined>('should');
  const [horizon, setHorizon] = useState('3');
  return (
    <Sheetlet id={anchor ? 'g-choice' : undefined} title="Choice controls" caption="KeyBank · LinkBank · Tabs · Switch · Checkbox · Radio · Select">
      <Specimen name="<KeyBank>" note="radio group; arrows move + select; yellow light on the pressed key">
        <Row>
          <KeyBank label="Units" size="sm" value={units} onChange={setUnits} options={[{ value: 'metric', label: 'metric' }, { value: 'imperial', label: 'imperial' }]} />
          <KeyBank label="Chart view" size="sm" value={view} onChange={setView} options={[{ value: 'lanes', label: 'lanes' }, { value: 'overlay', label: 'overlay' }, { value: 'focus', label: 'focus' }]} />
          <KeyBank label="Zoom" size="sm" value={zoom} onChange={setZoom} options={[{ value: '84', label: '12 wk' }, { value: '28', label: '4 wk' }, { value: '7', label: '1 wk' }]} />
        </Row>
        <Row>
          <KeyBank
            label="Horizon"
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '1', label: '1 mo' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
              { value: '6', label: '6', disabled: true },
            ]}
          />
          <KeyBank label="Views" value="results" options={[{ value: 'schedule', label: 'schedule' }, { value: 'results', label: 'results', badge: true }]} />
          <KeyBank
            label="Figure view"
            value={pos}
            onChange={setPos}
            options={[
              { value: 'flush', label: 'front', icon: Glyphs.AvatarFront },
              { value: 'side', label: 'side', icon: Glyphs.AvatarSide },
            ]}
          />
        </Row>
        <KeyBank
          label="Sex for the physiology equations"
          size="lg"
          block
          value={sex}
          onChange={setSex}
          options={[
            { value: 'female', label: 'female' },
            { value: 'male', label: 'male' },
            { value: 'unspecified', label: 'prefer not to say' },
          ]}
        />
      </Specimen>
      <Specimen name="<LinkBank>" note="route sub-navigation; aria-current page">
        <LinkBank
          label="Gallery demo"
          items={[
            { to: '/dev/components', label: 'components', end: true },
            { to: '/settings', label: 'settings' },
            { to: '/simulate', label: 'results', badge: true, badgeLabel: 'results out of date' },
          ]}
        />
      </Specimen>
      <Specimen name="<Tabs>">
        <Tabs defaultValue="overview">
          <TabList label="Plan detail" size="sm">
            <Tab value="overview">overview</Tab>
            <Tab value="days">days</Tab>
            <Tab value="curves">curves</Tab>
            <Tab value="safety" badge>
              safety
            </Tab>
          </TabList>
          <TabPanel value="overview" className="pt-3 text-sm text-ink-2">
            This plan holds a 22 % deficit for 12 weeks with a diet break in week 5.
          </TabPanel>
          <TabPanel value="days" className="pt-3 text-sm text-ink-2">
            84 days · 3 programs.
          </TabPanel>
          <TabPanel value="curves" className="pt-3 text-sm text-ink-2">
            Curves render here.
          </TabPanel>
          <TabPanel value="safety" className="pt-3 text-sm text-ink-2">
            No flags.
          </TabPanel>
        </Tabs>
      </Specimen>
      <Specimen name="<Switch>" note="on = ink track + yellow light">
        <Row className="gap-6">
          <Switch checked={sw1} onChange={setSw1} label="visceral" />
          <Switch checked={sw2} onChange={setSw2} label="use measurement" />
          <Switch checked label="disabled on" disabled onChange={() => undefined} />
          <Switch checked={false} label="Sentence-case label" labelStyle="sentence" onChange={() => undefined} />
        </Row>
      </Specimen>
      <Specimen name="<Checkbox> · <RadioGroup>">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Checkbox checked={c1} onChange={setC1} label="No fasting days" />
            <Checkbox checked={c2} onChange={setC2} label="Keep weekends at maintenance" help="Plans hold 100 % on Saturday and Sunday." />
            <Checkbox checked={false} indeterminate onChange={() => undefined} label="Some supplements" />
            <Checkbox checked disabled onChange={() => undefined} label="Evidence minimum protein" />
          </div>
          <RadioGroup
            label="how to import"
            value={radio}
            onChange={setRadio}
            options={[
              { value: 'merge', label: 'Merge', help: 'Keep everything.' },
              { value: 'replace', label: 'Replace everything', help: 'Your current data is removed first.' },
            ]}
          />
        </div>
      </Specimen>
      <Specimen name="<Select>" note="popover list on desktop pointers · native picker on touch">
        <div className="grid max-w-md gap-3 sm:grid-cols-2">
          <Field label="priority">
            <Select
              value={strength}
              onChange={setStrength}
              options={[
                { value: 'must', label: 'must' },
                { value: 'should', label: 'should' },
                { value: 'nice', label: 'nice to have' },
              ]}
            />
          </Field>
          <Field label="native">
            <Select native value={strength} onChange={setStrength} options={[{ value: 'must', label: 'must' }, { value: 'should', label: 'should' }, { value: 'nice', label: 'nice to have' }]} />
          </Field>
          <Field label="empty">
            <Select value={undefined} placeholder="Choose a metric" onChange={() => undefined} options={[{ value: 'a', label: 'Fat mass' }]} />
          </Field>
          <Field label="disabled">
            <Select value="should" disabled onChange={() => undefined} options={[{ value: 'should', label: 'should' }]} />
          </Field>
        </div>
      </Specimen>
    </Sheetlet>
  );
}

function NumericSheet({ anchor }: { anchor: boolean }) {
  const [bf, setBf] = useState(28.4);
  const [belly, setBelly] = useState(0.2);
  const [muscle, setMuscle] = useState(0.42);
  const [energy, setEnergy] = useState(78);
  const [win, setWin] = useState<[number, number]>([6, 8]);
  const [age, setAge] = useState<number | null>(36);
  const [grams, setGrams] = useState<number | null>(150);
  const [weight, setWeight] = useState<number | null>(84.9);
  const [height, setHeight] = useState<number | null>(178);
  const [waist, setWaist] = useState(96);
  const word = (v: number) => (v < 0.2 ? 'untrained' : v < 0.45 ? 'some training' : v < 0.7 ? 'trained' : v < 0.9 ? 'very trained' : 'exceptional');
  const M = 2540;
  return (
    <Sheetlet id={anchor ? 'g-numeric' : undefined} title="Numeric controls" caption="ScaleSlider · ScaleRange · Stepper · NumberField">
      <Specimen name="<ScaleSlider>" note="drag, ←/→, ⇧ ×10, PgUp/PgDn, Home/End, Enter or double-click the readout to type">
        <ScaleSlider
          label="body fat"
          value={bf}
          onChange={setBf}
          min={4}
          max={60}
          step={0.1}
          minorStep={1}
          majorStep={5}
          labels={[5, 15, 25, 35, 45, 55]}
          unit="%"
          likelyRange={[bf - 6, bf + 6]}
          valueText={(v) => `${v.toFixed(1)} percent body fat, likely ${(v - 6).toFixed(0)} to ${(v + 6).toFixed(0)}`}
        />
      </Specimen>
      <Specimen name="size sm · word readout · locked">
        <Section label="Where it sits">
          <ScaleSlider
            size="sm"
            label="belly & waist"
            value={belly}
            onChange={setBelly}
            min={-1}
            max={1}
            step={0.01}
            minorStep={0.1}
            majorStep={0.5}
            labels={[{ value: -1, label: 'less' }, { value: 0, label: 'typical' }, { value: 1, label: 'more' }]}
            format={(v) => Math.round(34 + v * 12)}
            unit="% of fat"
          />
          <ScaleSlider
            size="sm"
            label="upper body"
            value={muscle}
            onChange={setMuscle}
            min={0}
            max={1}
            step={0.01}
            minorStep={0.05}
            majorStep={0.25}
            labels={[{ value: 0, label: 'untrained' }, { value: 0.5, label: 'trained' }, { value: 1, label: 'very muscular' }]}
            format={word}
            valueText={(v) => `upper body muscle: ${word(v)}`}
          />
        </Section>
        <Section label="Waist" aside={<Engraved>locked by measurement</Engraved>}>
          <ScaleSlider
            size="sm"
            label="waist at the navel"
            value={waist}
            onChange={setWaist}
            min={55}
            max={160}
            step={0.5}
            minorStep={5}
            majorStep={25}
            labels={[55, 80, 105, 130, 155]}
            unit="cm"
            locked
            lockedReason="Set by your measurement. Turn off “use measurement” to adjust."
            note="Optional. A tape measure at the navel narrows the body-fat range and sets where fat sits."
          />
        </Section>
      </Specimen>
      <Specimen name="energy scale: zones + reference tick" note="deficit tints · caution < 50 % · maintenance at 100">
        <ScaleSlider
          label="energy"
          value={energy}
          onChange={setEnergy}
          min={0}
          max={140}
          step={1}
          minorStep={5}
          majorStep={20}
          labels={[0, 40, 60, 80, 120, 140]}
          unit="%"
          reference={{ value: 100, label: 'maintenance' }}
          zones={[
            { from: 0, to: 50, tone: 'caution', label: 'Under 50 %: large deficit' },
            { from: 50, to: 65, tone: 'deficit-4' },
            { from: 65, to: 80, tone: 'deficit-3' },
            { from: 80, to: 90, tone: 'deficit-2' },
            { from: 90, to: 99, tone: 'deficit-1' },
            { from: 101, to: 110, tone: 'surplus-1' },
            { from: 110, to: 120, tone: 'surplus-2' },
            { from: 120, to: 135, tone: 'surplus-3' },
            { from: 135, to: 140, tone: 'surplus-4' },
          ]}
          note={
            <span className="lm-num">
              {formatNumber(((energy - 100) / 100) * M, 0)} kcal · {formatNumber((energy / 100) * M, 0)} kcal/day
            </span>
          }
        />
        <ScaleSlider label="disabled" value={40} onChange={() => undefined} min={0} max={100} disabled size="sm" />
      </Specimen>
      <Specimen name="<ScaleRange>" note="two needles; the pushed thumb stops (no swap)">
        <ScaleRange label="eating window length" value={win} onChange={setWin} min={2} max={16} step={0.5} minorStep={1} majorStep={2} unit="h" thumbLabels={['shortest', 'longest']} minGap={1} />
      </Specimen>
      <Specimen name="<Stepper> · <NumberField> · <MeasureStepper>" note="hold ± to repeat; typed values out of range show the error">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="age">
            <Stepper name="age" value={age} onChange={setAge} min={18} max={90} unit="yrs" inputMode="numeric" />
          </Field>
          <Field label="protein" help="Grams per day.">
            <NumberField name="protein" value={grams} onChange={setGrams} min={0} max={400} unit="g" />
          </Field>
          <Field label="weight">
            <MeasureStepper quantity="mass" name="weight" value={weight} onChange={setWeight} min={30} max={300} unitToggle />
          </Field>
          <Field label="height">
            <MeasureStepper quantity="height" name="height" value={height} onChange={setHeight} min={120} max={230} />
          </Field>
          <Field label="height (imperial)">
            <MeasureStepper quantity="height" system="imperial" name="height" value={height} onChange={setHeight} min={120} max={230} />
          </Field>
          <Field label="with field error" error="Weight must be 30–300 kg.">
            <Stepper name="weight" value={320} onChange={() => undefined} min={30} max={300} step={0.1} unit="kg" />
          </Field>
        </div>
      </Specimen>
    </Sheetlet>
  );
}

function ReadoutSheet({ anchor }: { anchor: boolean }) {
  const [bf, setBf] = useState(23.4);
  return (
    <Sheetlet id={anchor ? 'g-readouts' : undefined} title="Readouts + evidence" caption="Readout · RangeBar · ReadoutStrip · Chip · GradeBadge">
      <Specimen name="<Readout>" note="md live estimate with likely-range gauge (printed ticks) · digits roll on change">
        <div className="grid gap-6 sm:grid-cols-2">
          <Readout
            label="body fat"
            value={bf}
            unit="%"
            range={[bf - 3.4, bf + 3.6]}
            animate
            caption="From your figure and weight. Add a waist measurement to narrow the range."
          />
          <Readout label="maintenance" value={2540} decimals={0} unit="kcal/day" range={[2310, 2770]} caption="Resting energy from lean mass × your activity." />
          <Readout label="visceral fat" value={null} unit="L" unknownCaption="needs waist" />
          <Readout label="fat mass" value={19.7} unit="kg" size="lg" range={[18.6, 20.9]} />
        </div>
        <Row>
          <Key size="sm" onClick={() => setBf((v) => Math.round((v + 1.3) * 10) / 10)}>
            Roll digits
          </Key>
          <span className="text-sm">
            Your maintenance is about <ReadoutInline value={2540} unit="kcal" />.
          </span>
        </Row>
      </Specimen>
      <Specimen name="<RangeBar>" note="likely range · point · ghost (start)">
        <Row className="gap-6">
          <RangeBar low={18.6} high={20.9} value={19.7}>
            likely 18.6–20.9
          </RangeBar>
          <RangeBar low={58.9} high={60.7} value={59.8} ghost={60.8} width={72}>
            with start
          </RangeBar>
        </Row>
      </Specimen>
      <Specimen name="<ReadoutStrip>" note="one faceplate, hairline dividers; mobile snap rail with a peeking next item">
        <ReadoutStrip
          label="Start to end"
          items={[
            { id: 'fat', label: 'fat mass', category: 'body', from: 24.1, value: 19.7, unit: 'kg', range: [18.6, 20.9] },
            { id: 'lean', label: 'lean mass', category: 'body', from: 60.8, value: 59.8, unit: 'kg', range: [58.9, 60.7] },
            { id: 'weight', label: 'scale weight', category: 'body', from: 84.9, value: 79.6, unit: 'kg', range: [78.0, 81.1] },
            { id: 'maint', label: 'maintenance', category: 'energy', from: 2540, value: 2378, unit: 'kcal', decimals: 0, range: [2242, 2515] },
          ]}
        />
      </Specimen>
      <Specimen name="<Chip>" note="plain · metric · filter · status (colour on the mark only) · removable">
        <Row>
          <Chip>plain</Chip>
          {CATS.slice(0, 4).map((c) => (
            <Chip key={c} kind="metric" category={c}>
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
          <Chip kind="metric" category="fuel" swatch="square">
            net carbs
          </Chip>
          <Chip kind="metric" category="body" swatch="dash">
            lean mass
          </Chip>
        </Row>
        <FilterChips />
        <Row>
          <Chip kind="status" severity="info">
            Safety mode: pregnancy
          </Chip>
          <Chip kind="status" severity="caution">
            1 caution
          </Chip>
          <Chip kind="status" severity="danger">
            Under 800 kcal
          </Chip>
          <Chip kind="status" severity="ok">
            reached
          </Chip>
          <Chip kind="metric" category="hormones" onRemove={() => toast('Removed hunger pressure')} removeLabel="Remove hunger pressure">
            hunger pressure
          </Chip>
        </Row>
      </Specimen>
      <Specimen name="<GradeBadge>" note="achromatic by rule: A solid · B grey · C outlined · D dashed">
        <Row>
          {(['A', 'B', 'C', 'D'] as const).map((g) => (
            <GradeBadge key={g} grade={g} />
          ))}
          <span className="w-4" />
          {(['A', 'B', 'C', 'D'] as const).map((g) => (
            <GradeBadge key={g} grade={g} size="sm" onClick={() => toast(`Explain: grade ${g}`)} />
          ))}
        </Row>
      </Specimen>
    </Sheetlet>
  );
}

function FilterChips() {
  const [on, setOn] = useState<Record<string, boolean>>({ A: true, B: true, C: false, D: false, target: false });
  return (
    <Row>
      {Object.keys(on).map((k) => (
        <Chip key={k} kind="filter" pressed={Boolean(on[k])} onPressedChange={(p) => setOn((s) => ({ ...s, [k]: p }))}>
          {k.length === 1 ? `grade ${k}` : 'has target'}
        </Chip>
      ))}
    </Row>
  );
}

function FeedbackSheet({ anchor }: { anchor: boolean }) {
  const [shown, setShown] = useState(true);
  return (
    <Sheetlet id={anchor ? 'g-feedback' : undefined} title="Feedback" caption="Notice · InlineWarning · Toast · Tooltip · ProgressRule · Spinner · Meter · Skeleton · EmptyStage">
      <Specimen name="<Notice>" note="REVIEW_FINDINGS #5 — faceplate text, drawn status mark, colour on the mark only">
        <div className="grid gap-3">
          <Notice
            severity="caution"
            title="Your deficit is 31 % of maintenance."
            actions={
              <>
                <Key size="sm">Set energy to 75 %</Key>
                <Key size="sm" variant="quiet">
                  Keep as is
                </Key>
              </>
            }
          >
            Above about 25 % the model shows more muscle loss and stronger hunger and hormone effects. Real-world results vary.
          </Notice>
          <Notice severity="danger" title="Under 800 kcal a day for 28 days." collapsible>
            Very-low-energy diets this long need medical supervision: risks include gallstones, electrolyte problems and heart rhythm changes. Vitals shows the projection so you can see it, but the Planner will never prescribe it.
          </Notice>
          {shown ? (
            <Notice severity="info" title="Schedule changed since this run." onDismiss={() => setShown(false)} actions={<Key size="sm">Run again</Key>} />
          ) : (
            <Key size="sm" variant="quiet" onClick={() => setShown(true)}>
              Show the info notice again
            </Key>
          )}
          <Notice severity="ok" title="Lose 10 kg fat — reached in plan A." />
        </div>
      </Specimen>
      <Specimen name="layout=ruled" note="inside a faceplate: hairlines, no box">
        <div>
          <Notice layout="ruled" severity="caution" title="36 h fasts follow lifting days in weeks 6–10.">
            Fasting straight after resistance training cuts the protein available for repair.
          </Notice>
          <Notice layout="ruled" severity="info" title="Protein below 1.6 g/kg on 12 days." />
        </div>
      </Specimen>
      <Specimen name="<InlineWarning> · <StatusMark>">
        <div className="grid gap-2">
          <InlineWarning severity="caution" action={<a className="lm-link" href="#g-feedback">Fix</a>}>
            Protein 2.0 g/kg needs at least 600 kcal.
          </InlineWarning>
          <InlineWarning severity="danger">This file isn't a Vitals export.</InlineWarning>
          <InlineWarning severity="info">Based on averages — add waist for a tighter estimate.</InlineWarning>
          <Row>
            {(['info', 'caution', 'danger', 'ok'] as const).map((s) => (
              <StatusMark key={s} severity={s} label={s} />
            ))}
          </Row>
        </div>
      </Specimen>
      <Specimen name="toast() · <Tooltip>" note="toasts confirm background work and undoable actions; tooltips never hold essential info">
        <Row>
          <Key size="sm" onClick={() => toast('Week 3 copied to weeks 4–6', { action: { label: 'Undo', onClick: () => toast('Copy undone') } })}>
            Show toast with Undo
          </Key>
          <Key size="sm" onClick={() => toast('Exported vitals-2026-09-30.json · 1.1 MB')}>
            Show toast
          </Key>
          <Tooltip content="80 % of people like you would land in this range.">
            <Key size="sm" variant="quiet">
              Hover or focus me
            </Key>
          </Tooltip>
        </Row>
      </Specimen>
      <Specimen name="<ProgressRule> · <Spinner>" note="2 px working rule at the top of a region; reduced motion shows text">
        <div className="relative h-16 rounded-sm border border-line bg-well">
          <ProgressRule label="Running 84 days" />
          <span className="absolute bottom-2 left-3 text-xs text-ink-2">Running 84 days · 41 channels… 1.2 s</span>
        </div>
        <div className="relative h-10 rounded-sm border border-line bg-well">
          <ProgressRule value={0.4} label="Optimiser" />
          <span className="absolute bottom-2 left-3 text-xs text-ink-2">determinate 40 %</span>
        </div>
        <Row>
          <Spinner size={12} />
          <Spinner size={16} />
          <Spinner size={20} label="Loading" />
        </Row>
      </Specimen>
      <Specimen name="<Meter>" note="ok · caution ≥ 80 % · danger ≥ 95 %">
        <div className="grid max-w-md gap-3">
          <Meter label="Storage" value={1.8} max={5} valueText="1.8 of 5 MB used" />
          <Meter label="Storage" value={4.2} max={5} valueText="4.2 of 5 MB used" advice="Storage is nearly full. Export and delete old scenarios to make room." />
          <Meter label="Storage" value={4.9} max={5} valueText="4.9 of 5 MB used" advice="Vitals can't save more. Export and remove scenarios." />
        </div>
      </Specimen>
      <Specimen name="<Skeleton>" note="static, no shimmer; lists only — charts keep their frame">
        <div className="grid max-w-sm gap-3">
          <Skeleton lines={3} />
          <Skeleton height={32} width={160} />
        </div>
      </Specimen>
      <Specimen name="<EmptyStage>">
        <EmptyStage
          title="Paint your first weeks."
          action={
            <>
              <Key variant="solid">Use a starter: 12 weeks, moderate deficit</Key>
              <Key variant="quiet">Blank</Key>
            </>
          }
        >
          Pick a program key, then drag across days. Start with one and refine later.
        </EmptyStage>
      </Specimen>
    </Sheetlet>
  );
}

function OverlaySheet({ anchor }: { anchor: boolean }) {
  const [dialog, setDialog] = useState<null | 'plain' | 'danger'>(null);
  const [typed, setTyped] = useState('');
  const [sheet, setSheet] = useState(false);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const [panel, setPanel] = useState(false);
  const [responsive, setResponsive] = useState(false);
  const [pop, setPop] = useState(false);
  const popRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheetlet id={anchor ? 'g-overlays' : undefined} title="Overlays" caption="Dialog · Sheet · SidePanel · ResponsivePanel · Popover · Menu (portaled: they follow the app theme)">
      <Specimen name="open one">
        <Row>
          <Key onClick={() => setDialog('plain')}>Dialog</Key>
          <Key variant="danger" onClick={() => setDialog('danger')}>
            Destructive dialog
          </Key>
          <Key onClick={() => setSheet(true)}>Bottom sheet</Key>
          <Key onClick={() => setPanel(true)}>Side panel</Key>
          <Key onClick={() => setResponsive(true)}>Responsive panel</Key>
          <Key ref={popRef} onClick={() => setPop((p) => !p)} aria-expanded={pop}>
            Popover
          </Key>
          <Menu
            label="Scenario actions"
            items={[
              { id: 'new', label: 'New scenario', icon: Plus, onSelect: () => toast('New scenario') },
              { id: 'dup', label: 'Duplicate', icon: Copy, onSelect: () => toast('Duplicated') },
              { id: 'ren', label: 'Rename', icon: Pencil, onSelect: () => toast('Rename') },
              { id: 'del', label: 'Delete', icon: Trash2, tone: 'danger', separatorBefore: true, onSelect: () => toast('Deleted') },
            ]}
            trigger={(p) => <IconKey {...p} icon={Ellipsis} label="More actions" variant="default" />}
          />
        </Row>
      </Specimen>
      <Dialog
        open={dialog === 'plain'}
        onClose={() => setDialog(null)}
        title="Import vitals-2026-08-12.json?"
        footer={
          <>
            <Key onClick={() => setDialog(null)}>Cancel</Key>
            <Key variant="solid" onClick={() => setDialog(null)}>
              Import
            </Key>
          </>
        }
      >
        <p className="m-0">Exported 12 Aug 2026 from Vitals 1.0 · 2 scenarios · 1 plan run · body · settings.</p>
        <Field label="note" help="Focus stays inside; Esc closes.">
          <TextInput placeholder="Optional" />
        </Field>
      </Dialog>
      <Dialog
        open={dialog === 'danger'}
        role="alertdialog"
        onClose={() => {
          setDialog(null);
          setTyped('');
        }}
        title="Delete scenario “Spring cut”?"
        footer={
          <>
            <Key onClick={() => setDialog(null)}>Cancel</Key>
            <Key variant="danger" disabledReason={typed === 'delete' ? undefined : 'Type “delete” to confirm.'} onClick={() => setDialog(null)}>
              Delete scenario
            </Key>
          </>
        }
      >
        <p className="m-0">This removes 84 painted days and the last projection. It can't be undone.</p>
        <Field label="type delete to confirm">
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Dialog>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Tue 14 Oct · day 14 of 84"
        detent={detent}
        onDetentChange={setDetent}
        detents={['peek', 'half', 'full']}
        footer={
          <>
            <Key variant="quiet" size="sm">
              Reset to program B
            </Key>
            <span className="flex-1" />
            <Key size="sm" variant="solid" onClick={() => setSheet(false)}>
              Done
            </Key>
          </>
        }
      >
        <div className="grid gap-4 p-4">
          <KeyBank label="Detent" size="sm" value={detent} onChange={(d) => setDetent(d)} options={[{ value: 'peek', label: 'peek 35 %' }, { value: 'half', label: 'half 60 %' }, { value: 'full', label: 'full 92 %' }]} />
          <p className="m-0 text-sm text-ink-2">Drag the handle down to step down or close. Content scrolls inside; the header stays.</p>
          <Skeleton lines={8} />
        </div>
      </Sheet>
      <SidePanel open={panel} onClose={() => setPanel(false)} title="Fat mass" footer={<KeyLink to="/evidence" size="sm">Open in Evidence</KeyLink>}>
        <div className="grid gap-3 p-4 text-sm leading-[1.55]">
          <Row>
            <GradeBadge grade="A" />
            <Engraved>body composition</Engraved>
          </Row>
          <p className="m-0">Stored body fat, in kilograms. It changes with the energy you don't cover from food, less the share taken from lean tissue.</p>
          <Readout label="day 84" value={19.7} unit="kg" range={[18.6, 20.9]} size="sm" />
        </div>
      </SidePanel>
      <ResponsivePanel open={responsive} onClose={() => setResponsive(false)} title="Explain · ketones">
        <div className="p-4 text-sm leading-[1.55] text-ink-2">Bottom sheet below 1024 px, overlay side panel above. Resize to see it switch.</div>
      </ResponsivePanel>
      <Popover open={pop} onOpenChange={setPop} anchorRef={popRef} label="Conflict" padding="roomy">
        <p className="m-0 max-w-[32ch] text-sm leading-[1.5]">
          <strong>Muscle gain and the autophagy signal pull in opposite directions.</strong> Your ranking puts muscle first, so plans keep fasts under 20 h.
        </p>
      </Popover>
    </Sheetlet>
  );
}

function LayoutSheet({ anchor }: { anchor: boolean }) {
  return (
    <Sheetlet id={anchor ? 'g-layout' : undefined} title="Surfaces + layout" caption="Faceplate · Section · Rule · Stage · KeyValueList · ScrollRail">
      <Specimen name="<Faceplate variant>" note="plain · inset · flush — never nested; this sheet is itself a faceplate">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stage className="grid min-h-[96px] place-items-center rounded-md border border-line-strong text-xs text-ink-2">stage-dots (perforated)</Stage>
          <div className="rounded-md bg-well p-3 text-xs text-ink-2" style={{ boxShadow: 'var(--lm-shadow-well)' }}>
            inset / well
          </div>
          <div className="rounded-md border border-line-strong bg-face p-3 text-xs text-ink-2" style={{ boxShadow: 'var(--lm-shadow-face)' }}>
            plain faceplate surface
          </div>
        </div>
      </Specimen>
      <Specimen name="<Section> · <Rule> · <KeyValueList>">
        <Section label="Habits" aside={<Key size="sm" variant="quiet">Edit</Key>}>
          <KeyValueList
            items={[
              { key: 'training history', value: '3 years · 4 sessions/week' },
              { key: 'typical steps', value: '8 400 / day' },
              { key: 'sleep', value: '23:30 → 07:00 · good' },
            ]}
          />
        </Section>
        <Rule />
      </Specimen>
      <Specimen name="<ScrollRail>" note="snap rail, scroll-padding = gutter, the next cell peeks">
        <ScrollRail bleed={false} padding={0}>
          {['A', 'B', 'C', 'D', 'E', 'F'].map((l, i) => (
            <div key={l} className="grid w-[142px] gap-1 rounded-sm border border-edge bg-raised p-2.5" style={{ boxShadow: 'var(--lm-shadow-key)' }}>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span style={{ fontStretch: '112%', fontWeight: 700 }}>{l}</span>
                <span className="size-1.5 rounded-full border border-edge" style={i === 0 ? { background: 'var(--lm-signal)', borderColor: 'var(--lm-signal-edge)' } : undefined} />
                program
              </span>
              <span className="text-2xs text-ink-2">{75 + i * 5} % · P2.0 C60</span>
            </div>
          ))}
        </ScrollRail>
      </Specimen>
    </Sheetlet>
  );
}

function IconSheet({ anchor }: { anchor: boolean }) {
  const glyphs = Object.entries(Glyphs) as Array<[string, typeof Glyphs.AvatarFront]>;
  return (
    <Sheetlet id={anchor ? 'g-icons' : undefined} title="Icons" caption="Lucide + authored glyphs · 1.5 px stroke at every size">
      <Specimen name="authored glyphs" note="import { Glyphs } from '@/components'">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {glyphs.map(([name, G]) => (
            <div key={name} className="grid justify-items-center gap-1.5 rounded-sm border border-line p-2.5">
              <span className="flex items-end gap-2">
                <Icon icon={G} size={20} />
                <Icon icon={G} size={16} />
              </span>
              <span className="text-2xs text-ink-2">{name}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen name="Lucide via <Icon>">
        <Row>
          {[Copy, Download, Repeat, Table, Metrics, Pencil, Lock, Trash2, Plus, Ellipsis].map((I, i) => (
            <Icon key={i} icon={I} />
          ))}
        </Row>
      </Specimen>
    </Sheetlet>
  );
}

function Gallery({ anchor }: { anchor: boolean }) {
  return (
    <div className="grid min-w-0 gap-4">
      <TokensSheet anchor={anchor} />
      <KeysSheet anchor={anchor} />
      <ChoiceSheet anchor={anchor} />
      <NumericSheet anchor={anchor} />
      <ReadoutSheet anchor={anchor} />
      <FeedbackSheet anchor={anchor} />
      <OverlaySheet anchor={anchor} />
      <LayoutSheet anchor={anchor} />
      <IconSheet anchor={anchor} />
    </div>
  );
}

const JUMP: Array<[string, string]> = [
  ['g-tokens', 'tokens'],
  ['g-keys', 'keys'],
  ['g-choice', 'choice'],
  ['g-numeric', 'numeric'],
  ['g-readouts', 'readouts'],
  ['g-feedback', 'feedback'],
  ['g-overlays', 'overlays'],
  ['g-layout', 'layout'],
  ['g-icons', 'icons'],
];

export default function ComponentGalleryPage() {
  const wide = useMediaQuery(MQ.xl);
  const [scope, setScope] = useState<Scope>('split');
  const effective: Scope = scope === 'split' && !wide ? 'app' : scope;
  return (
    <>
      <TopBar
        title="Components"
        documentTitle="Component gallery"
        actions={
          <KeyBank
            label="Theme in the gallery"
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'split', label: wide ? 'side by side' : 'app theme' },
              { value: 'light', label: 'light' },
              { value: 'dark', label: 'dark' },
            ]}
          />
        }
      />
      <Page>
        <nav aria-label="Gallery sections" className="mb-4">
          <ScrollRail gap={6}>
            {JUMP.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="lm-chip" style={{ height: 32, paddingInline: 12 }}>
                {label}
              </a>
            ))}
          </ScrollRail>
        </nav>
        {effective === 'split' ? (
          <div className="grid grid-cols-2 gap-4">
            <div data-theme-scope="light" className="min-w-0 rounded-lg p-3" style={{ background: 'var(--lm-chassis)', color: 'var(--lm-ink)' }}>
              <p className="lm-eng mb-3 mt-0">light</p>
              <Gallery anchor />
            </div>
            <div data-theme-scope="dark" className="min-w-0 rounded-lg p-3" style={{ background: 'var(--lm-chassis)', color: 'var(--lm-ink)' }}>
              <p className="lm-eng mb-3 mt-0">dark</p>
              <Gallery anchor={false} />
            </div>
          </div>
        ) : effective === 'app' ? (
          <Gallery anchor />
        ) : (
          <div data-theme-scope={effective} className="min-w-0 rounded-lg p-3" style={{ background: 'var(--lm-chassis)', color: 'var(--lm-ink)' }}>
            <Gallery anchor />
          </div>
        )}
      </Page>
    </>
  );
}
