/**
 * Simulator · Results (design/screens/simulator-results.md, CHART_SPEC, REVIEW_FINDINGS): the readout strip, the
 * figure-over-time + warnings band, the channel stack, and the energy & weight breakdown — for one scenario's run.
 *
 * Pure with respect to the app stores except the small results UI store and the safety acknowledgement store:
 * `ResultsView` connects it to the simulation / schedule / profile / settings stores; tests feed it directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { ClipboardCopy, PanelTopClose, PanelTopOpen, SlidersHorizontal } from 'lucide-react';
import {
  Chip,
  EmptyStage,
  Faceplate,
  IconKey,
  Key,
  Notice,
  ProgressRule,
  RunKey,
  StatusMark,
  toast,
  useMediaQuery,
  useReducedMotion,
  MQ,
} from '@/components';
import { compileSchedule, resolveProfile, type CompiledSchedule, type PersonProfile, type ResolvedProfile, type Schedule, type SimulationResult } from '@/engine';
import { ChartFrame, useChartController, type ChartStatus, type ChartView } from '@/features/charts';
import { AcknowledgeDialog, DANGER_ACK_VERSION, DisclaimerLine, SimulationStrip, isDangerAcknowledged } from '@/features/onboarding';
import { useSafetyStore } from '@/state/safetyStore';
import { buildResultsData, compositionTracks, scaleBreakdown, type BandsLike } from './lib/adapt';
import { bodyTimeline, type BodyTimeline } from './lib/bodyState';
import { dateRange } from './lib/format';
import { CORE_METRIC_IDS, HEADLINE_METRIC_IDS, displayCatalogue, type UnitPrefs } from './lib/metrics';
import { computeReadouts, summaryText } from './lib/readouts';
import { resultsState, runningText } from './lib/status';
import { lanesWithFocus, parseResultsParams, writeResultsParams } from './lib/urlState';
import { chipText, dangerRules, groupWarnings, type WarningRemedy } from './lib/warnings';
import { Breakdown } from './components/Breakdown';
import { FigureOverTime } from './components/FigureOverTime';
import { MetricPicker } from './components/MetricPicker';
import { PinMetricMenu, ReadoutRail } from './components/ReadoutRail';
import { ResultsExplain } from './components/ResultsExplain';
import { WarningsPanel } from './components/WarningsPanel';
import { useResultsUiStore, useScenarioResultsPrefs } from './store';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import './results.css';

/** The subset of `useSimulation(sid)` the screen reads. */
export interface SimulationLike {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  phase: 'nominal' | 'ensemble' | null;
  progress: number;
  result: SimulationResult | null;
  bands: { p10: BandsLike['p10']; p90: BandsLike['p90']; drawsDone: number; drawsTotal: number; complete?: boolean } | null;
  stale: boolean;
  hasResult: boolean;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  resultHash: string | null;
  runId: number;
}

export interface ResultsPrefs extends UnitPrefs {
  showFigure: boolean;
  textures: boolean;
  /** Drawing-only frame of the figure, 0 = hips-led … 1 = shoulders-led (profile.figure.frame). */
  figureFrame?: number;
}

export interface ResultsScreenProps {
  scenarioId: string;
  scenarioName: string;
  sim: SimulationLike;
  /** Inputs behind the shown result (the last run's profile and schedule). */
  inputs: { profile: PersonProfile; schedule: Schedule } | null;
  /** Horizon of the scenario as it is now (never-run copy). */
  horizonDays: number;
  onRun: () => void;
  /** Why Run is unavailable (e.g. macros exceed energy on some days). */
  runBlockedReason?: string;
  prefs: ResultsPrefs;
  /** Schedule link with days pre-selected and the rule to fix. */
  scheduleHref: (opts?: { startDay?: number; endDay?: number; fix?: string }) => string;
}

const CHANNELS = displayCatalogue().length;

function useElapsed(running: boolean, startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  return running && startedAt != null ? Math.max(0, now - startedAt) : null;
}

function useResolvedInputs(inputs: ResultsScreenProps['inputs']): { rp: ResolvedProfile | null; compiled: CompiledSchedule | null } {
  return useMemo(() => {
    if (!inputs) return { rp: null, compiled: null };
    try {
      const rp = resolveProfile(inputs.profile);
      let compiled: CompiledSchedule | null = null;
      try {
        compiled = compileSchedule(inputs.schedule, rp);
      } catch {
        compiled = null;
      }
      return { rp, compiled };
    } catch {
      return { rp: null, compiled: null };
    }
  }, [inputs]);
}

/**
 * The chart toolbar sticks under the shell's sticky bars (mobile top bar + context bar, or the desktop context bar,
 * whose height depends on its content). Measure them and hand the offset to the chart as `--lmc-sticky-top`.
 */
function useStickyTop(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;
    const bars = ['.lm-topbar', '.lm-ctx-slot'].map((q) => document.querySelector<HTMLElement>(q)).filter((b): b is HTMLElement => !!b);
    if (!bars.length) return;
    const update = () => {
      let h = 0;
      for (const b of bars) if (getComputedStyle(b).display !== 'none' && getComputedStyle(b).position === 'sticky') h += b.getBoundingClientRect().height;
      if (h > 0) el.style.setProperty('--lmc-sticky-top', `${Math.round(h)}px`);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    for (const b of bars) ro.observe(b);
    return () => ro.disconnect();
  }, [ref]);
}

/** Lanes: the saved selection (or the core set), restricted to what this result carries. */
function effectiveLanes(saved: readonly string[] | null | undefined, available: ReadonlySet<string>): string[] {
  const base = saved ?? CORE_METRIC_IDS;
  return base.filter((id) => available.has(id));
}

export function ResultsScreen(p: ResultsScreenProps) {
  const { sim, scenarioId } = p;
  const st = resultsState(sim);
  const lg = useMediaQuery(MQ.lg);
  const reduced = useReducedMotion();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const url = useMemo(() => parseResultsParams(params), [params]);
  const prefsUi = useScenarioResultsPrefs(scenarioId);
  const setLanes = useResultsUiStore((s) => s.setLanes);
  const togglePinned = useResultsUiStore((s) => s.togglePinned);
  const bandOpen = useResultsUiStore((s) => s.bandOpen);
  const setBandOpen = useResultsUiStore((s) => s.setBandOpen);
  const breakdownOpen = useResultsUiStore((s) => s.breakdownOpen);
  const setBreakdownOpen = useResultsUiStore((s) => s.setBreakdownOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const warningsRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useStickyTop(rootRef);
  const running = sim.status === 'running';
  const elapsed = useElapsed(running, sim.startedAt);
  const { rp, compiled } = useResolvedInputs(p.inputs);
  const units: UnitPrefs = useMemo(() => ({ units: p.prefs.units, energyUnit: p.prefs.energyUnit, glucoseUnit: p.prefs.glucoseUnit }), [p.prefs.units, p.prefs.energyUnit, p.prefs.glucoseUnit]);

  const bands: BandsLike | null = useMemo(
    () => (sim.bands ? { p10: sim.bands.p10, p90: sim.bands.p90, draws: sim.bands.drawsDone, total: sim.bands.drawsTotal } : null),
    [sim.bands],
  );
  const adapted = useMemo(() => {
    if (!sim.result) return null;
    try {
      return buildResultsData({ result: sim.result, bands, schedule: p.inputs?.schedule ?? null, compiled }, units);
    } catch (e) {
      console.error('results: could not adapt the simulation', e);
      return null;
    }
  }, [sim.result, bands, p.inputs, compiled, units]);
  const data = adapted?.data ?? null;
  const days = data?.time.days ?? p.horizonDays;
  const controller = useChartController(Math.max(1, days));

  const timeline: BodyTimeline | null = useMemo(() => {
    if (!sim.result || !rp) return null;
    try {
      return bodyTimeline(sim.result, rp.body, { frame: p.prefs.figureFrame });
    } catch {
      return null;
    }
  }, [sim.result, rp, p.prefs.figureFrame]);

  // lanes / overlay / view / focus ------------------------------------------------------------
  const available = useMemo(() => new Set(data?.series.map((s) => s.id) ?? []), [data]);
  const savedLanes = prefsUi.laneIds;
  const laneIds = useMemo(() => lanesWithFocus(effectiveLanes(savedLanes, available), url.view === 'focus' ? url.metric : undefined, available), [savedLanes, available, url.view, url.metric]);
  const [overlayIds, setOverlayIds] = useState<string[] | null>(null);
  const overlayEff = useMemo(() => {
    if (overlayIds) return overlayIds.filter((id) => available.has(id));
    const byId = new Map(data?.series.map((s) => [s.id, s]) ?? []);
    return laneIds.filter((id) => {
      const s = byId.get(id);
      return s && s.overlay !== 'none' && s.kind !== 'stacked-area';
    }).slice(0, 5);
  }, [overlayIds, available, data, laneIds]);
  const view: ChartView = url.view ?? 'lanes';
  const focusId = view === 'focus' ? (url.metric && available.has(url.metric) ? url.metric : (laneIds[0] ?? null)) : null;

  const setUrl = useCallback(
    (next: { view?: ChartView; metric?: string; explain?: string }) => {
      setParams((cur) => writeResultsParams(cur, { view: next.view ?? view, metric: next.metric ?? focusId ?? undefined, explain: 'explain' in next ? next.explain : url.explain }), {
        replace: true,
        // view/explain changes are in-page state: ScrollRestoration must not jump back to the top of the screen
        preventScrollReset: true,
      });
    },
    [setParams, view, focusId, url.explain],
  );
  const onViewChange = useCallback((v: ChartView) => setUrl({ view: v, metric: v === 'focus' ? (focusId ?? laneIds[0]) : undefined }), [setUrl, focusId, laneIds]);
  const onFocusChange = useCallback((id: string | null) => setUrl({ view: id ? 'focus' : 'lanes', metric: id ?? undefined }), [setUrl]);
  const onLaneIdsChange = useCallback((ids: string[]) => setLanes(scenarioId, ids), [setLanes, scenarioId]);

  // deep-link zoom and crosshair, once per result
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !sim.resultHash || appliedFor.current === sim.resultHash) return;
    appliedFor.current = sim.resultHash;
    if (url.zoom) controller.dispatch({ type: 'preset', preset: url.zoom, centre: url.day != null ? url.day + 0.5 : undefined }, { animate: false });
    if (url.day != null && url.day < data.time.days) controller.setCursor(url.day + 0.5, 'program', { force: true, pin: true });
  }, [data, sim.resultHash, url.zoom, url.day, controller]);

  // explain ------------------------------------------------------------------------------------
  const explainId = url.explain;
  const openExplain = useCallback((id: string) => setUrl({ explain: id }), [setUrl]);
  const closeExplain = useCallback(() => setUrl({ explain: undefined }), [setUrl]);
  const returnTo = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return { to: `${location.pathname}${q.toString() ? `?${q}` : ''}`, label: `${p.scenarioName} results` };
  }, [location.pathname, location.search, p.scenarioName]);

  // warnings + danger gate -----------------------------------------------------------------------
  const warnings = useMemo(() => sim.result?.warnings ?? [], [sim.result]);
  const groups = useMemo(() => groupWarnings(warnings), [warnings]);
  const chip = chipText(groups.counts);
  const rules = useMemo(() => dangerRules(warnings), [warnings]);
  const ack = useSafetyStore((s) => s.dangerAcks[scenarioId]);
  const gateHash = sim.resultHash ?? 'none';
  const needsAck = rules.length > 0 && !isDangerAcknowledged(ack, gateHash, rules.map((r) => r.id), DANGER_ACK_VERSION);
  const acknowledged = rules.length > 0 && !needsAck;
  const onAcknowledge = () =>
    void sendCommand('safety.acknowledgeDanger', { scenarioId, ack: { scheduleHash: gateHash, rules: rules.map((r) => r.id), version: DANGER_ACK_VERSION, at: new Date().toISOString() } });

  const showWarning = useCallback(
    (day: number) => {
      controller.jumpCursor(day + 0.5);
      controller.pin(true);
      chartRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    },
    [controller, reduced],
  );
  const remedyHref = useCallback((r: WarningRemedy) => p.scheduleHref({ startDay: r.startDay, endDay: r.endDay, fix: r.ruleId }), [p]);

  // readouts ------------------------------------------------------------------------------------
  const pinned = useMemo(() => (prefsUi.pinned ?? []).filter((id) => !(HEADLINE_METRIC_IDS as readonly string[]).includes(id)), [prefsUi.pinned]);
  const stripIds = useMemo(() => [...HEADLINE_METRIC_IDS, ...pinned], [pinned]);
  const readouts = useMemo(() => (data && adapted ? computeReadouts(data, stripIds, adapted.metrics) : []), [data, adapted, stripIds]);
  const placeholders = useMemo(() => {
    const cat = displayCatalogue(units);
    return HEADLINE_METRIC_IDS.map((id) => cat.find((m) => m.id === id)!).filter(Boolean);
  }, [units]);
  const pinnable = useMemo(() => (data ? data.series.filter((s) => !(HEADLINE_METRIC_IDS as readonly string[]).includes(s.id)).map((s) => ({ id: s.id, label: s.label })) : []), [data]);

  const copySummary = useCallback(async () => {
    if (!data) return;
    const text = summaryText({
      title: p.scenarioName,
      dateRange: dateRange(data.time),
      days: data.time.days,
      readouts,
      warnings: { danger: groups.counts.danger, caution: groups.counts.caution, titles: [...groups.danger, ...groups.caution].map((w) => `${w.title} (${w.daysText})`) },
      disclaimer: `${acknowledged ? 'Simulation — not a recommendation. ' : ''}Projections for an average person with your inputs. Not medical advice. Individual results differ: see the range on each curve.`,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast('Summary copied');
    } catch {
      toast('Copy is blocked in this browser. Use the table view to copy values.');
    }
  }, [data, p.scenarioName, readouts, groups, acknowledged]);

  // chrome --------------------------------------------------------------------------------------
  const chartStatus: ChartStatus = st.chart;
  const statusText = runningText(st.phase, elapsed, sim.bands?.drawsDone, sim.bands?.drawsTotal);
  const channels = data?.series.length ?? CHANNELS;
  const runMeta =
    sim.result && data
      ? `last run ${(sim.result.meta.runtimeMs / 1000).toFixed(1)} s · ${data.time.days} days · ${channels} channels${sim.bands ? ` · ranges from ${sim.bands.drawsDone} of ${sim.bands.drawsTotal} draws` : ' · fixed ranges'}`
      : null;

  const toolbarSlot = (
    <>
      {chip ? (
        <Chip kind="status" severity={chip.severity} onClick={() => warningsRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })}>
          {chip.text}
        </Chip>
      ) : null}
      <Key size="sm" icon={SlidersHorizontal} onClick={() => setPickerOpen(true)} aria-haspopup="dialog">
        Metrics <span className="rs-count lm-num">{view === 'overlay' ? overlayEff.length : laneIds.length}</span>
      </Key>
      <IconKey size="sm" icon={ClipboardCopy} label="Copy summary" onClick={() => void copySummary()} />
    </>
  );

  const gated = needsAck && st.hasChart;
  const showChart = st.hasChart && data && !gated;

  let chartArea: ReactNode;
  if (st.phase === 'never-run' || (st.phase === 'error' && !st.hasChart)) {
    chartArea =
      st.phase === 'error' ? null : (
        <EmptyStage
          className="rs-empty"
          title="Run your first projection."
          action={<RunKey size="lg" onRun={p.onRun} caption={`${p.horizonDays} days`} disabledReason={p.runBlockedReason} />}
          art={null}
        >
          Vitals will simulate {p.horizonDays} days across {CHANNELS} channels. It takes about a second.
        </EmptyStage>
      );
  } else if (st.phase === 'first-run' || !data) {
    chartArea = (
      <Faceplate variant="flush" className="rs-first">
        <ProgressRule label="Running" />
        <EmptyStage className="rs-empty" title={`Running ${p.horizonDays} days · ${CHANNELS} channels`} art={null}>
          {statusText ?? 'Running'}
        </EmptyStage>
      </Faceplate>
    );
  } else if (gated) {
    chartArea = <AcknowledgeDialog rules={rules} onAcknowledge={onAcknowledge} titleAs="h2" className="rs-ack" />;
  } else {
    chartArea = (
      <>
        {laneIds.length === 0 && view !== 'overlay' ? (
          <Notice
            severity="info"
            className="rs-nolanes"
            title="No channels selected."
            actions={
              <>
                <Key size="sm" onClick={() => setPickerOpen(true)}>
                  Pick metrics
                </Key>
                <Key size="sm" variant="quiet" onClick={() => setLanes(scenarioId, null)}>
                  Reset to default set
                </Key>
              </>
            }
          >
            The inputs and energy lanes stay; pick the outcomes you want to read.
          </Notice>
        ) : null}
        {acknowledged ? <SimulationStrip className="rs-simstrip" /> : null}
        <ChartFrame
          data={data}
          controller={controller}
          laneIds={laneIds}
          onLaneIdsChange={onLaneIdsChange}
          overlayIds={overlayEff}
          view={view}
          onViewChange={onViewChange}
          focusId={focusId}
          onFocusChange={onFocusChange}
          status={chartStatus}
          statusText={statusText}
          sweepKey={sim.resultHash ?? undefined}
          textures={p.prefs.textures}
          energyUnit={p.prefs.energyUnit}
          toolbarSlot={toolbarSlot}
          onExplain={openExplain}
          title={`${p.scenarioName}: projection channels${acknowledged ? '. Simulation — not a recommendation.' : ''}`}
          exportTitle={p.scenarioName}
          exportSubtitle={`${dateRange(data.time)} · ${data.time.days} days · projections with likely ranges`}
          exportNote={acknowledged ? 'Simulation — not a recommendation.' : undefined}
          // the disclaimer is shown once, under the readout strip (DisclaimerLine); the frame's own copy would repeat it
          disclaimer={null}
          className={acknowledged ? 'rs-frame rs-frame--flagged' : 'rs-frame'}
        />
      </>
    );
  }

  const figure =
    showChart && data ? (
      <FigureOverTime timeline={timeline} data={data} controller={controller} showFigure={p.prefs.showFigure} units={p.prefs.units} />
    ) : null;
  const warningsPanel = (
    <div ref={warningsRef} className="rs-warnwrap">
      <WarningsPanel groups={groups} startDate={data?.time.startDate} onShow={showWarning} remedyHref={remedyHref} pending={!sim.result} returnTo={returnTo} />
    </div>
  );

  const massFactor = adapted?.metrics.get('fatMass')?.factor ?? 1;
  const massUnit = adapted?.metrics.get('fatMass')?.unit ?? 'kg';
  const breakdown = useMemo(() => (sim.result ? scaleBreakdown(sim.result, massFactor, massUnit) : null), [sim.result, massFactor, massUnit]);
  const compBaseline = useMemo(() => (sim.result ? compositionTracks(sim.result, massFactor)?.baseline : undefined), [sim.result, massFactor]);
  const visibleCaveats = useMemo(() => {
    if (!adapted || !showChart) return [];
    const ids = view === 'overlay' ? overlayEff : laneIds;
    const byText = new Map<string, string[]>();
    for (const id of ids) {
      const m = adapted.metrics.get(id);
      if (!m?.caveat) continue;
      const list = byText.get(m.caveat) ?? [];
      list.push(m.label);
      byText.set(m.caveat, list);
    }
    return [...byText.entries()].map(([text, names]) => ({ text, names }));
  }, [adapted, showChart, view, overlayEff, laneIds]);

  return (
    <div ref={rootRef} className="rs" data-phase={st.phase}>
      <div className="rs-top">
        <ReadoutRail
          readouts={showChart ? readouts : []}
          placeholders={showChart ? undefined : placeholders}
          // the run is done: while the danger acknowledgement is pending "run to see the projection" would be wrong
          placeholderCaption={gated ? 'shown after the acknowledgement below' : undefined}
          pinnedIds={pinned}
          onExplain={openExplain}
          animate={!reduced}
        />
        <div className="rs-meta">
          <DisclaimerLine bare className="rs-meta__disclaimer" />
          <span className="rs-meta__right">
            {showChart && pinnable.length ? <PinMetricMenu pinnable={pinnable} pinnedIds={pinned} onPin={(id) => togglePinned(scenarioId, id)} /> : null}
            {runMeta ? <span className="rs-meta__run lm-num">{runMeta}</span> : null}
          </span>
        </div>
      </div>

      {st.phase === 'stale' ? (
        <Notice
          severity="info"
          className="rs-notice"
          title="Schedule changed since this run."
          actions={
            <Key size="sm" onClick={p.onRun} disabledReason={p.runBlockedReason}>
              Run again
            </Key>
          }
        >
          The curves below show the previous inputs.
        </Notice>
      ) : null}
      {st.phase === 'error' ? (
        <Notice
          severity="danger"
          className="rs-notice"
          announce
          title="The simulation stopped."
          actions={
            <>
              <Key size="sm" onClick={p.onRun}>
                Run again
              </Key>
              <Key
                size="sm"
                variant="quiet"
                onClick={() => {
                  void navigator.clipboard?.writeText(`Vitals simulation error (${scenarioId}): ${sim.error ?? 'unknown'}`).then(() => toast('Details copied'), () => toast('Copy is blocked in this browser.'));
                }}
              >
                Copy details
              </Key>
            </>
          }
        >
          {sim.error ? `${sim.error}. ` : ''}This is our bug, not your plan.{st.hasChart ? ' The last good projection stays below, dimmed.' : ''}
        </Notice>
      ) : null}

      {lg && figure && bandOpen ? (
        <div className="rs-band">
          {figure}
          {warningsPanel}
          <IconKey className="rs-band__toggle" size="sm" icon={PanelTopClose} label="Hide figure and warnings" onClick={() => setBandOpen(false)} />
        </div>
      ) : lg && figure ? (
        <div className="rs-bandbar">
          <span className="lm-eng">figure over time · warnings</span>
          {chip ? (
            <span className="rs-bandbar__sev">
              <StatusMark severity={chip.severity} size={16} />
              {chip.text}
            </span>
          ) : null}
          <IconKey size="sm" icon={PanelTopOpen} label="Show figure and warnings" onClick={() => setBandOpen(true)} />
        </div>
      ) : null}

      <div ref={chartRef} className="rs-chart" data-dim={st.phase === 'error' || undefined}>
        {chartArea}
      </div>

      {visibleCaveats.length ? (
        <ul className="rs-caveats" aria-label="Caveats for the channels shown">
          {visibleCaveats.map((c) => (
            <li key={c.text}>
              <b>{c.names.join(', ')}.</b> {c.text}
            </li>
          ))}
        </ul>
      ) : null}

      {!lg ? (
        <>
          {figure}
          {warningsPanel}
        </>
      ) : !figure || !bandOpen ? (
        warningsPanel
      ) : null}

      {showChart && data ? (
        <Breakdown
          data={data}
          controller={controller}
          breakdown={breakdown}
          compositionBaseline={compBaseline}
          collapsible={!lg}
          open={breakdownOpen}
          onOpenChange={setBreakdownOpen}
          textures={p.prefs.textures}
        />
      ) : null}

      {data && adapted ? (
        <MetricPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          series={data.series}
          metrics={adapted.metrics}
          mode={view === 'overlay' ? 'overlay' : 'lanes'}
          laneIds={laneIds}
          overlayIds={overlayEff}
          onLaneIdsChange={onLaneIdsChange}
          onOverlayIdsChange={setOverlayIds}
          onReset={() => {
            setLanes(scenarioId, null);
            setOverlayIds(null);
          }}
          pinnedIds={pinned}
          onTogglePin={(id) => togglePinned(scenarioId, id)}
          onExplain={openExplain}
        />
      ) : null}

      <ResultsExplain
        metricId={explainId}
        onClose={closeExplain}
        returnTo={returnTo}
        controller={controller}
        data={showChart ? data : null}
        result={sim.result}
        compiled={compiled}
        prefs={units}
      />
    </div>
  );
}
