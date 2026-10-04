/* ==========================================================================
   /dev/charts — every chart view rendered from deterministic fixtures, with a
   control strip (horizon, metric count, theme, textures, run state). The data
   is synthetic and labelled as such.
   ========================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Checkbox, Faceplate, Key, KeyBank, Popover, RunKey, Switch, TextInput } from '@/components';
import './charts.css';
import { ChartFrame } from './components/ChartFrame';
import { CompareView } from './components/CompareView';
import { ConvergenceChart } from './components/ConvergenceChart';
import { DayView } from './components/DayView';
import { PreviewStrip } from './components/PreviewStrip';
import { TdeeStack } from './components/TdeeStack';
import { WeightDecomposition } from './components/WeightDecomposition';
import type { ChartStatus } from './components/LaneStack';
import { FIXTURE_METRICS, makeChartData, makeComparison, makeConvergence } from './fixtures';
import { capacityText, DEFAULT_LANE_IDS, pickerGroups, toggleMetric } from './lib/picker';

type Theme = 'app' | 'light' | 'dark';

function useDemoTheme(theme: Theme) {
  useEffect(() => {
    if (theme === 'app') return; // leave the app's own theme alone
    const html = document.documentElement;
    const prev = html.getAttribute('data-theme');
    html.setAttribute('data-theme', theme);
    return () => {
      if (prev == null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', prev);
    };
  }, [theme]);
}

function initialTheme(): Theme {
  if (typeof location === 'undefined') return 'app';
  const q = new URLSearchParams(location.search).get('theme');
  return q === 'light' || q === 'dark' ? q : 'app';
}

export default function ChartsDemoPage() {
  const [days, setDays] = useState(84);
  const [metricCount, setMetricCount] = useState<'default' | 'all'>('default');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [textures, setTextures] = useState(false);
  const [status, setStatus] = useState<ChartStatus>('idle');
  const [sweep, setSweep] = useState(0);
  const [elapsed, setElapsed] = useState<string | undefined>();
  const [day, setDay] = useState(37);
  useDemoTheme(theme);

  const data = useMemo(() => makeChartData({ days }), [days]);
  const comparison = useMemo(() => makeComparison({ days: 119 }), []);
  const convergence = useMemo(() => makeConvergence(), []);
  const allIds = useMemo(() => data.series.map((s) => s.id), [data.series]);
  const [lanes, setLanes] = useState<string[]>([...DEFAULT_LANE_IDS, 'autophagy', 'insulin_sens', 'ldl']);
  const laneIds = metricCount === 'all' ? allIds : lanes;
  const tdee = data.series.find((s) => s.id === 'tdee');
  const fat = data.series.find((s) => s.id === 'fat_mass');

  const run = () => {
    if (status === 'running') return;
    setStatus('running');
    const t0 = performance.now();
    const tick = setInterval(() => setElapsed(`Running · ${((performance.now() - t0) / 1000).toFixed(1)} s`), 100);
    setTimeout(() => {
      clearInterval(tick);
      setElapsed(undefined);
      setStatus('idle');
      setSweep((k) => k + 1);
    }, 1200);
  };

  return (
    <div className="lmc-demo">
      <header className="lmc-demo__head">
        <div>
          <h1>Charts</h1>
          <p>Every chart view from deterministic fixtures ({FIXTURE_METRICS.length} metrics, hourly data for the fast ones). Synthetic numbers — shapes only.</p>
        </div>
        <RunKey onRun={run} caption={`${days} days`} state={status === 'running' ? 'running' : status === 'stale' ? 'stale' : 'idle'} elapsed={elapsed ? Number(elapsed.replace(/[^0-9.]/g, '')) : undefined} />
      </header>

      <div className="lmc-demo__controls" role="group" aria-label="Demo controls">
        <label className="lmc-demo__ctl">
          <span>horizon</span>
          <KeyBank<string>
            size="sm"
            label="Horizon"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: '84', label: '12 wk' },
              { value: '120', label: '17 wk' },
              { value: '183', label: '6 mo' },
            ]}
          />
        </label>
        <label className="lmc-demo__ctl">
          <span>lanes</span>
          <KeyBank<'default' | 'all'>
            size="sm"
            label="Lanes"
            value={metricCount}
            onChange={setMetricCount}
            options={[
              { value: 'default', label: `picked · ${lanes.length}` },
              { value: 'all', label: `all · ${allIds.length}` },
            ]}
          />
        </label>
        <label className="lmc-demo__ctl">
          <span>theme</span>
          <KeyBank<Theme>
            size="sm"
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'app', label: 'app' },
              { value: 'light', label: 'light' },
              { value: 'dark', label: 'dark' },
            ]}
          />
        </label>
        <label className="lmc-demo__ctl">
          <span>state</span>
          <KeyBank<ChartStatus>
            size="sm"
            label="Result state"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'idle', label: 'done' },
              { value: 'running', label: 'running' },
              { value: 'stale', label: 'stale' },
            ]}
          />
        </label>
        <Switch checked={textures} onChange={setTextures} label="patterns in charts" />
      </div>

      <ChartFrame
        key={days}
        data={data}
        laneIds={laneIds}
        onLaneIdsChange={(ids) => {
          setMetricCount('default');
          setLanes(ids);
        }}
        status={status}
        statusText={elapsed}
        sweepKey={sweep}
        textures={textures}
        toolbarSlot={<DemoPicker series={data.series} selected={laneIds} onChange={(ids) => {
          setMetricCount('default');
          setLanes(ids);
        }} />}
        title="Projection channels (synthetic)"
      />

      <div className="lmc-demo__grid">
        <Faceplate variant="flush" title="How the plans compare" caption="planner · A / B / C · synced crosshair">
          <CompareView data={comparison} selected="A" />
        </Faceplate>

        <Faceplate variant="flush" title="One day, hour by hour" caption="day view · shown when zoomed to ≤ 2 days">
          <DayView data={data} day={Math.min(day, days - 1)} onDayChange={setDay} />
        </Faceplate>

        <div className="lmc-demo__two">
          {tdee ? (
            <Faceplate variant="flush" title="Where the energy goes" caption="TDEE components · kcal/d">
              <TdeeStack series={tdee} time={data.time} phases={data.phases} textures={textures} />
            </Faceplate>
          ) : null}
          {data.composition ? (
            <Faceplate variant="flush" title="Why did the scale move?" caption="weekly change, kg">
              <WeightDecomposition composition={data.composition} time={data.time} />
            </Faceplate>
          ) : null}
        </div>

        <div className="lmc-demo__two">
          <Faceplate variant="flush" title="Optimiser progress" caption="planner · reassurance only">
            <ConvergenceChart traces={convergence} />
          </Faceplate>
          {fat ? (
            <Faceplate variant="flush" title="Schedule preview" caption="coarse · updates while painting">
              <div style={{ padding: '10px 12px 12px' }}>
                <PreviewStrip fat={fat.daily.values} ketosis={data.states?.[0]?.daily} />
              </div>
            </Faceplate>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Demo-only metric picker exercising the picker data logic (grouping, search, caps). */
function DemoPicker({ series, selected, onChange }: { series: Parameters<typeof pickerGroups>[0]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | undefined>();
  const anchor = useRef<HTMLButtonElement>(null);
  const groups = pickerGroups(series, selected, { query });
  return (
    <>
      <Key ref={anchor} size="sm" icon={SlidersHorizontal} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Metrics <span style={{ color: 'var(--lm-ink-2)', fontVariantNumeric: 'tabular-nums' }}>{selected.length}</span>
      </Key>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} label="Metrics" placement="bottom-end">
        <div className="lmc-demo__picker">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search metrics" aria-label="Search metrics" />
          {note ? <p className="lmc-hint">{note}</p> : null}
          {groups.map((g) => (
            <fieldset key={g.category}>
              <legend>
                {g.label} <span>{g.selectedCount}/{g.total}</span>
              </legend>
              {g.items.map((it) => (
                <Checkbox
                  key={it.id}
                  checked={it.selected}
                  label={`${it.label} · ${it.unit}`}
                  onChange={() => {
                    const r = toggleMetric(series, selected, it.id, 'lanes');
                    setNote(r.refused);
                    onChange(r.selected);
                  }}
                />
              ))}
            </fieldset>
          ))}
          <p className="lmc-hint">{capacityText(selected.length, Math.min(5, selected.length))}</p>
        </div>
      </Popover>
    </>
  );
}
