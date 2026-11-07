/* ==========================================================================
   /dev/charts — every chart view rendered from deterministic fixtures, with a
   control strip (horizon, metric count, textures, run state). Dark only (the
   one Ember palette). The data is synthetic and labelled as such.
   ========================================================================== */
import { useMemo, useRef, useState } from 'react';
import { TopBar } from '@/app/shell';
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

export default function ChartsDemoPage() {
  const [days, setDays] = useState(84);
  const [metricCount, setMetricCount] = useState<'default' | 'all'>('default');
  const [textures, setTextures] = useState(false);
  const [status, setStatus] = useState<ChartStatus>('idle');
  const [sweep, setSweep] = useState(0);
  const [elapsed, setElapsed] = useState<string | undefined>();
  const [day, setDay] = useState(37);

  const data = useMemo(() => makeChartData({ days }), [days]);
  const comparison = useMemo(() => makeComparison({ days: 119 }), []);
  const convergence = useMemo(() => makeConvergence(), []);
  const allIds = useMemo(() => data.series.map((s) => s.id), [data.series]);
  const [lanes, setLanes] = useState<string[]>([...DEFAULT_LANE_IDS, 'autophagy', 'insulin_sens', 'ldl']);
  const laneIds = metricCount === 'all' ? allIds : lanes;
  const tdee = data.series.find((s) => s.id === 'tdee');
  const fat = data.series.find((s) => s.id === 'fat_mass');
  // the skin's single-series area only shows where there is no likely range: the same series with their bands removed
  const noRange = useMemo(
    () => ({ ...data, series: data.series.map((s) => ({ ...s, daily: { ...s.daily, band: undefined }, hourly: s.hourly ? { ...s.hourly, band: undefined } : s.hourly })) }),
    [data],
  );

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
      <TopBar title="Charts" subtitle={`${FIXTURE_METRICS.length} metrics · synthetic data`} />
      <header className="lmc-demo__head">
        <RunKey onRun={run} caption={`${days} days`} state={status === 'running' ? 'running' : status === 'stale' ? 'stale' : 'idle'} elapsed={elapsed ? Number(elapsed.replace(/[^0-9.]/g, '')) : undefined} />
      </header>

      <div className="lmc-demo__controls" role="group" aria-label="Demo controls">
        <label className="lmc-demo__ctl">
          <span>Horizon</span>
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
          <span>Lanes</span>
          <KeyBank<'default' | 'all'>
            size="sm"
            label="Lanes"
            value={metricCount}
            onChange={setMetricCount}
            options={[
              { value: 'default', label: `Picked · ${lanes.length}` },
              { value: 'all', label: `All · ${allIds.length}` },
            ]}
          />
        </label>
        <label className="lmc-demo__ctl">
          <span>State</span>
          <KeyBank<ChartStatus>
            size="sm"
            label="Result state"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'idle', label: 'Done' },
              { value: 'running', label: 'Running' },
              { value: 'stale', label: 'Stale' },
            ]}
          />
        </label>
        <Switch checked={textures} onChange={setTextures} label="Patterns in charts" />
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
        <Faceplate variant="flush" title="One series, no range" caption="area and end dot">
          <ChartFrame key={`nr-${days}`} data={noRange} defaultLaneIds={['scale_weight', 'insulin_sens', 'sleep_quality']} textures={textures} title="Single series without a range (synthetic)" />
        </Faceplate>

        <Faceplate variant="flush" title="How the plans compare" caption="A · B · C">
          <CompareView data={comparison} selected="A" />
        </Faceplate>

        <Faceplate variant="flush" title="One day, hour by hour">
          <DayView data={data} day={Math.min(day, days - 1)} onDayChange={setDay} />
        </Faceplate>

        <div className="lmc-demo__two">
          {tdee ? (
            <Faceplate variant="flush" title="Where the energy goes" caption="kcal/d">
              <TdeeStack series={tdee} time={data.time} phases={data.phases} textures={textures} />
            </Faceplate>
          ) : null}
          {data.composition ? (
            <Faceplate variant="flush" title="Why did the scale move?" caption="kg a week">
              <WeightDecomposition composition={data.composition} time={data.time} />
            </Faceplate>
          ) : null}
        </div>

        <div className="lmc-demo__two">
          <Faceplate variant="flush" title="Optimiser progress">
            <ConvergenceChart traces={convergence} />
          </Faceplate>
          {fat ? (
            <Faceplate variant="flush" title="Schedule preview">
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
