/* ==========================================================================
   Viz gallery: every shared viz module with a state row each (loading,
   empty, stale, provisional or learning, over goal, quiet), on the card
   material. A dev page: the render harness (gallery.html, render.mjs)
   frames it at phone and desktop widths. `?only=<id>` shows one section.
   ========================================================================== */
import { useState, type ReactNode } from 'react';
import { Activity, Droplet, Footprints, Gauge, HeartPulse, Moon, Route, Thermometer, Timer, Waves } from 'lucide-react';
import { Faceplate } from '../../Faceplate';
import { Key } from '../../Key';
import type { IconComponent } from '../../icons/Icon';
import { ArcRuler } from '../ArcRuler';
import { DayDisc } from '../DayDisc';
import { DotFill } from '../DotFill';
import { LevelBar, LEVEL_KNOTS, levelCell, personalKnot, cellOfUnit } from '../LevelBar';
import { LearningLine, ReadingAge } from '../marks';
import { MonitorSheet, type MonitorItem } from '../MonitorSheet';
import { OvernightTrace } from '../OvernightTrace';
import { ShareBar } from '../ShareBar';
import { Stat, StatGroup } from '../Stat';
import { StateStrip } from '../StateStrip';
import { Hypnogram } from '../Hypnogram';
import { TickStrip } from '../TickStrip';
import * as F from './fixtures';

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="vg-row">
      <p className="vg-row__name">{name}</p>
      {children}
    </div>
  );
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-gallery={id} className="vg-cardwrap">
      <Faceplate title={title} titleAs="h2">
        <div className="vg-rows">{children}</div>
      </Faceplate>
    </div>
  );
}

const ICONS: Record<string, IconComponent> = { hrv: Waves, rhr: HeartPulse, temp: Thermometer, spo2: Droplet, sleep: Moon, steps: Footprints, mid: Timer, stress: Gauge, hp: Activity, distance: Route };
const withIcon = (i: MonitorItem): MonitorItem => ({ ...i, icon: ICONS[i.id] });

function Monitor() {
  const [open, setOpen] = useState(true);
  const [ids, setIds] = useState<string[]>(F.MONITOR_DEFAULT);
  const all = F.MONITOR_ALL.map(withIcon);
  const selected = ids.map((id) => all.find((x) => x.id === id)!).filter(Boolean);
  const available = all.filter((x) => !ids.includes(x.id));
  return (
    <Card id="monitor" title="Signals">
      <Row name="Edit key opens the sheet (title · ✕, changes apply at once)">
        <Key variant="text" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Key>
      </Row>
      <MonitorSheet open={open} onOpenChange={setOpen} selected={selected} available={available} defaultIds={F.MONITOR_DEFAULT} max={8} onChange={setIds} onReset={() => setIds(F.MONITOR_DEFAULT)} />
    </Card>
  );
}

const SECTIONS: Record<string, () => ReactNode> = {
  tick: () => (
    <Card id="tick" title="Tick strip">
      <Row name="Goal met">
        <TickStrip label="Sleep" value={476} goal={420} valueText="7 h 56" goalText="of 7 h" statusText="Goal met" spokenValue="7 h 56 asleep" />
      </Row>
      <Row name="Short of the goal">
        <TickStrip label="Sleep" value={382} goal={420} valueText="6 h 22" goalText="of 7 h" statusText="38 min short" />
      </Row>
      <Row name="Limit, over (hatched beyond; never rose)">
        <TickStrip label="Eaten" value={2450} goal={2100} goalKind="limit" valueText="2 450 kcal" goalText="of 2 100 kcal" statusText="350 kcal over" />
      </Row>
      <Row name="Floor">
        <TickStrip label="Protein" value={96} goal={120} goalKind="floor" valueText="96 g" goalText="of 120 g" statusText="24 g to go" />
      </Row>
      <Row name="Plan day 16 of 90 (a tick per day, major each week)">
        <TickStrip label="Plan" value={16} goal={90} domain={[0, 90]} ticks={{ count: 90, majorEvery: 7 }} valueText="Day 16" goalText="of 90" statusText="74 days left" />
      </Row>
      <Row name="Learning (dashed), value 0, no goal">
        <TickStrip label="Fast" value={0} goal={960} state="learning" valueText="0 h" goalText="of 16 h" statusText="Not started" />
        <TickStrip label="Steps" value={6120} valueText="6 120 steps" />
      </Row>
      <Row name="Meter variant">
        <TickStrip label="Same stimulus" value={84} domain={[0, 100]} goal={90} variant="meter" scale={[0, 60, 90, 100]} valueText="84 %" goalText="of 90 %" statusText="Partly: add 1 set" />
      </Row>
      <Row name="Future day, loading, quiet">
        <TickStrip label="Sleep" value={null} goal={420} state="future" valueText="" goalText="of 7 h" />
        <TickStrip label="Sleep" value={null} goal={420} state="loading" valueText="" goalText="of 7 h" />
        <TickStrip label="Eaten" value={1900} goal={2100} valueText="1 900 kcal" goalText="of 2 100 kcal" quiet quietText="A little short" />
      </Row>
    </Card>
  ),
  dots: () => (
    <Card id="dots" title="Dotted fill">
      <Row name="Under the goal">
        <DotFill label="Steps" value={9664} goal={10000} valueText="9 664" goalText="of 10 000 steps" />
      </Row>
      <Row name="Over the goal (head pinned, the excess said)">
        <DotFill label="Ring energy" value={1644} goal={630} valueText="1 644" goalText="of 630 kcal" overText="+1 014 kcal over" />
      </Row>
      <Row name="Zero (hollow head)">
        <DotFill label="Distance" value={0} goal={8} valueText="0" goalText="of 8 km" state="zero" />
      </Row>
      <Row name="Provisional (dashed dots, chip)">
        <DotFill label="Active energy" value={410} goal={500} valueText="410" goalText="of 500 kcal" state="provisional" chip="Ring estimate" />
      </Row>
      <Row name="Quiet, loading">
        <DotFill label="Heart Points" value={96} goal={150} valueText="96" goalText="of 150 this week" quiet />
        <DotFill label="Steps" value={null} goal={10000} valueText="" goalText="of 10 000 steps" state="loading" />
      </Row>
      <Row name="Learning line (P11)">
        <LearningLine nights={3} of={7} />
      </Row>
    </Card>
  ),
  stat: () => (
    <Card id="stat" title="Stat tiles">
      <Row name="Status, delta and qualifier chips">
        <StatGroup label="Sleep heart rate" columns={3}>
          <Stat label="Sleeping low HR" value="53" unit="bpm" chip={{ kind: 'status', severity: 'ok', word: 'Normal' }} info={{ text: 'The 10th percentile of your heart rate while asleep, not a waking resting heart rate.', method: 'sleep-metrics/1' }} />
          <Stat label="Average sleep HR" value="56" unit="bpm" chip={{ kind: 'status', severity: 'caution', word: 'Above usual' }} />
          <Stat label="Time to lowest" value="7 h 28" chip={{ kind: 'qualifier', text: 'After onset' }} />
          <Stat label="HRV" value="70" unit="ms" chip={{ kind: 'delta', dir: 'down', text: '−14 ms vs usual', caution: true }} />
          <Stat label="Skin temperature" value="+0.3" unit="°C" chip={{ kind: 'delta', dir: 'up', text: '+0.3 °C vs usual' }} />
          <Stat label="Settle time" value="12" unit="min" chip={{ kind: 'delta', dir: 'flat', text: 'Steady' }} />
        </StatGroup>
      </Row>
      <Row name="Calibrating, missing, stale, loading, unavailable">
        <StatGroup label="States" columns={3}>
          <Stat label="Skin temperature" value={null} unit="°C" chip={{ kind: 'provisional', text: 'Calibrating · night 3 of 7' }} />
          <Stat label="Restorative" value={null} state="missing" chip={{ kind: 'unavailable', text: 'Not measured by this ring' }} />
          <Stat label="SpO2" value="95" unit="%" state="stale" chip={{ kind: 'status', severity: 'ok', word: 'Normal' }} />
          <Stat label="Midpoint" value={null} state="loading" />
          <Stat label="Recovery" value="71" quiet chip={{ kind: 'status', severity: 'ok', word: 'Good' }} />
        </StatGroup>
      </Row>
    </Card>
  ),
  trace: () => (
    <Card id="trace" title="Sleep heart rate">
      <Row name="Night with a low point, a gap and an awake block">
        <OvernightTrace label="Heart rate" unit="bpm" from={F.NIGHT.from} to={F.NIGHT.to} points={F.nightHr()} low={F.NIGHT_LOW} awake={F.NIGHT_AWAKE} trend={{ word: 'Rising', magnitude: 'Slight' }} tz={F.TZ} />
      </Row>
      <Row name="Sparse (dots only, no trend, no low)">
        <OvernightTrace label="Heart rate" unit="bpm" from={F.NIGHT.from} to={F.NIGHT.to} points={F.SPARSE_HR} state="sparse" tz={F.TZ} />
      </Row>
      <Row name="Quiet, empty">
        <OvernightTrace label="Heart rate" unit="bpm" from={F.NIGHT.from} to={F.NIGHT.to} points={F.nightHr()} low={F.NIGHT_LOW} trend={{ word: 'Steady' }} tz={F.TZ} quiet />
        <OvernightTrace label="Heart rate" unit="bpm" from={F.NIGHT.from} to={F.NIGHT.to} points={[]} state="empty" tz={F.TZ} />
      </Row>
    </Card>
  ),
  hypno: () => (
    <Card id="hypno" title="Hypnogram">
      <Row name="Four levels from a raw night (Mixed absorbed, short hole bridged, long hole hatched; display only)">
        <Hypnogram label="Sleep stages" from={F.RAW_NIGHT.from} to={F.RAW_NIGHT.to} segments={F.RAW_NIGHT.spans} tz={F.TZ} />
      </Row>
      <Row name="Compact card, quiet">
        <Hypnogram label="Sleep stages" from={F.RAW_NIGHT.from} to={F.RAW_NIGHT.to} segments={F.RAW_NIGHT.spans} tz={F.TZ} height={104} quiet />
      </Row>
    </Card>
  ),
  strip: () => (
    <Card id="strip" title="State strip">
      <Row name="Stress today (ordinal, top hatched, tiny spans merge, no reading dotted, now)">
        <StateStrip label="Stress today" from={F.DAY.from} to={F.DAY.to} now={F.DAY.now} segments={F.STRESS} stateLabels={F.STRESS_LABELS} summary="2 h 25 min elevated or high" tz={F.TZ} />
      </Row>
      <Row name="Today's day (category)">
        <StateStrip label="The day" from={F.DAY.from} to={F.DAY.to} now={F.DAY.now} segments={F.PLAN_DAY} stateLabels={F.DAY_LABELS} mode="category" tz={F.TZ} twin={false} />
      </Row>
      <Row name="Quiet, loading">
        <StateStrip label="Stress today" from={F.DAY.from} to={F.DAY.to} now={F.DAY.now} segments={F.STRESS} stateLabels={F.STRESS_LABELS} tz={F.TZ} quiet twin={false} />
        <StateStrip label="Stress today" from={F.DAY.from} to={F.DAY.to} segments={[]} stateLabels={F.STRESS_LABELS} state="loading" tz={F.TZ} twin={false} />
      </Row>
    </Card>
  ),
  share: () => (
    <Card id="share" title="Share bar">
      <Row name="Sleep stages (md, unclassified row)">
        <ShareBar
          label="Sleep stages"
          shareOf="of the night"
          rows={[
            { id: 'deep', label: 'Deep', valueText: '1 h 08', share: 0.14, hue: 'var(--lm-hr-zone-1)' },
            { id: 'light', label: 'Light', valueText: '4 h 02', share: 0.53, hue: 'var(--lm-hr-zone-3)' },
            { id: 'rem', label: 'REM', valueText: '1 h 41', share: 0.22, hue: 'var(--lm-hr-zone-5)' },
            { id: 'awake', label: 'Awake', valueText: '0 min', share: 0, hue: 'var(--lm-ink-3)' },
            { id: 'unk', label: 'Unclassified', valueText: '41 min', share: 0.09, hue: 'var(--lm-ink-3)', unknown: true },
          ]}
          note="Incomplete night: 91 % of the window named"
        />
      </Row>
      <Row name="Macros (sm), quiet">
        <ShareBar
          label="Macros"
          size="sm"
          rows={[
            { id: 'p', label: 'Protein', valueText: '96 of 120 g', share: 0.8, hue: 'var(--lm-macro-protein)' },
            { id: 'c', label: 'Net carbs', valueText: '140 of 180 g', share: 0.78, hue: 'var(--lm-macro-carbs)' },
            { id: 'f', label: 'Fat', valueText: '48 of 70 g', share: 0.69, hue: 'var(--lm-macro-fat)' },
          ]}
        />
        <ShareBar
          label="Zones"
          quiet
          rows={[
            { id: 'z2', label: 'Zone 2', valueText: '32 min', share: 0.55, hue: 'var(--lm-hr-zone-2)' },
            { id: 'z4', label: 'Zone 4', valueText: '9 min', share: 0.15, hue: 'var(--lm-hr-zone-4)' },
          ]}
        />
      </Row>
    </Card>
  ),
  level: () => {
    const hr = levelCell(71, LEVEL_KNOTS.hr, 7);
    const hrHigh = levelCell(128, LEVEL_KNOTS.hr, 7);
    const spo2 = levelCell(97, LEVEL_KNOTS.spo2, 7);
    const stress = levelCell(22, LEVEL_KNOTS.stress, 7);
    const hrv = cellOfUnit(personalKnot(-1.2, 7), 7);
    const line = (name: string, value: string, unit: string, bar: ReactNode, word: string, age: ReactNode) => (
      <div className="vg-signal">
        <span className="vg-signal__name">{name}</span>
        <span className="vg-signal__value">
          {value}
          <span className="lmv-unit"> {unit}</span>
        </span>
        {bar}
        <span className="vg-signal__word">{word}</span>
        {age}
      </div>
    );
    return (
      <Card id="level" title="Level bar">
        <Row name="Signals rows (7 columns, usual range lighter)">
          {line('Heart rate', '71', 'bpm', <LevelBar cell={hr} usual={[1, 3]} severity="ok" />, 'Normal', <ReadingAge ageText="3 min ago" />)}
          {line('Heart rate', '128', 'bpm', <LevelBar cell={hrHigh} usual={[1, 3]} severity="danger" />, 'High', <ReadingAge ageText="1 min ago" />)}
          {line('SpO2', '97', '%', <LevelBar cell={spo2} severity="ok" />, 'Normal', <ReadingAge ageText="18 h ago" stale />)}
          {line('Stress', '22', '/ 100', <LevelBar cell={stress} severity="ok" />, 'Calm', <ReadingAge ageText="3 min ago" />)}
          {line('HRV', '58', 'ms', <LevelBar cell={hrv} usual={[2, 4]} severity="caution" />, 'Below baseline', <ReadingAge ageText="6 h ago" />)}
        </Row>
        <Row name="Stale, calibrating, no reading, 10 columns, alone as a meter">
          {line('SpO2', '95', '%', <LevelBar cell={spo2} severity="ok" state="stale" />, 'Normal', <ReadingAge ageText="2 d ago" />)}
          {line('Skin temp', '—', '°C', <LevelBar cell={null} state="calibrating" />, 'Calibrating · night 3 of 7', null)}
          {line('Heart rate', '—', 'bpm', <LevelBar cell={null} state="none" />, 'No reading', null)}
          <LevelBar cell={levelCell(71, [[40, 0], [50, 2], [90, 6], [120, 8], [160, 10]], 10)} columns={10} usual={[2, 4]} severity="ok" asMeter label="Heart rate" wordText="Normal" />
        </Row>
      </Card>
    );
  },
  arc: () => (
    <Card id="arc" title="Arc ruler">
      <Row name="Stress 89, hero">
        <ArcRuler label="Stress" value={89} unit="/ 100" bands={F.STRESS_BANDS} scaleNote="Ring index, not validated" />
      </Row>
      <Row name="HRV against baseline (personal, ±1 SD)">
        <ArcRuler label="HRV" value={70} unit="ms" center={78} spread={9} window={18} wordText="Below baseline" wordSeverity="caution" />
      </Row>
      <Row name="Calibrating, stale">
        <ArcRuler label="Skin temperature" value={0.2} unit="°C" decimals={1} center={0} window={1.2} state="calibrating" />
        <ArcRuler label="Stress" value={41} unit="/ 100" bands={F.STRESS_BANDS} state="stale" ageText="3 h ago" />
      </Row>
      <Row name="Straight tile form, arc tile, quiet">
        <div className="vg-tiles">
          <ArcRuler label="Stress" value={41} unit="/ 100" bands={F.STRESS_BANDS} variant="straight" size="tile" />
          <ArcRuler label="Stress" value={41} unit="/ 100" bands={F.STRESS_BANDS} size="tile" />
        </div>
        <ArcRuler label="Stress" value={89} unit="/ 100" bands={F.STRESS_BANDS} quiet />
      </Row>
    </Card>
  ),
  disc: () => (
    <Card id="disc" title="Day score">
      <Row name="Full, with the target">
        <DayDisc label="Day score" score={84} band="Good" arcs={F.DAY_ARCS} target={70} />
      </Row>
      <Row name="Learning (based on 2 of 3, low confidence)">
        <DayDisc label="Day score" score={78} band="Fair" arcs={F.DAY_ARCS_LEARNING} target={70} state="learning" />
      </Row>
      <Row name="Quiet, compact, none">
        <DayDisc label="Day score" score={84} band="Good" arcs={F.DAY_ARCS} target={70} quiet />
        <div className="vg-tiles">
          <DayDisc label="Day score" score={84} arcs={F.DAY_ARCS} size="compact" />
          <DayDisc label="Day score" score={84} arcs={F.DAY_ARCS} size="compact" state="stale" />
          <DayDisc label="Day score" score={null} arcs={F.DAY_ARCS.map((a) => ({ ...a, score: null }))} size="compact" state="none" />
        </div>
      </Row>
    </Card>
  ),
  monitor: () => <Monitor />,
};

export const GALLERY_IDS = Object.keys(SECTIONS);

export function VizGallery({ only }: { only?: string | null }) {
  const ids = only && SECTIONS[only] ? [only] : GALLERY_IDS.filter((id) => id !== 'monitor' || only === 'monitor');
  return (
    <main className="vg">
      <h1 className="vg-title">Viz modules</h1>
      <div className="vg-grid">
        {ids.map((id) => (
          <div key={id}>{SECTIONS[id]!()}</div>
        ))}
      </div>
    </main>
  );
}
