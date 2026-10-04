/**
 * Figure over time (simulator-results.md §6, AVATAR_SPEC §6, body-figure-v2.md §4 and §6.5): the body on the crosshair
 * day (the last day when no crosshair is set) with the start as a ghost, and the day's waist / weight / body fat beside
 * it. A `figure | visceral` key bank switches the stage between the 3D figure (SVG while it loads or without WebGL) and
 * the visceral view (waist slice + side cutaway, the start's contours as a ghost); both follow the crosshair. Play
 * sweeps the crosshair day 1 → last over 2.2 s (ease-in-out) so every lane, the figure and the slice move together;
 * press again to stop. Reduced motion jumps start → end. With "Show the figure" off (Settings), only the numbers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { Faceplate, Key, KeyBank, formatNumber, formatSigned, useReducedMotion } from '@/components';
import type { ChartController, ChartData, ChartSeries } from '@/features/charts';
import { roundArea } from '@/features/body/avatar';
import { Figure3D, VisceralView, liveVisceral } from '@/features/body/figure3d';
import type { BodyTimeline } from '../lib/bodyState';
import { dayLabel } from '../lib/format';

export interface FigureOverTimeProps {
  timeline: BodyTimeline | null;
  data: ChartData;
  controller: ChartController;
  showFigure: boolean;
  units: 'metric' | 'imperial';
  /** Heading level inside the page (default h2). */
  titleAs?: 'h2' | 'h3';
}

function useCursorDay(controller: ChartController, days: number): number {
  const get = useCallback(() => {
    const t = controller.cursor.get().t;
    return t == null ? days - 1 : Math.max(0, Math.min(days - 1, Math.floor(t)));
  }, [controller, days]);
  return useSyncExternalStore(controller.cursor.subscribe, get, get);
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

interface Line {
  id: string;
  name: string;
  from: string;
  to: string;
  delta: string;
  unit: string;
}

function line(s: ChartSeries | undefined, day: number, name: string): Line | null {
  if (!s) return null;
  const v = s.daily.values[day];
  const start = s.baseline ?? s.daily.values[0];
  if (v == null || !Number.isFinite(v) || start == null) return null;
  const d = s.format.decimals;
  return { id: s.id, name, from: formatNumber(start, d), to: formatNumber(v, d), delta: formatSigned(v - start, d), unit: s.unit === 'index' ? '' : s.unit };
}

type StageView = 'figure' | 'visceral';
const STAGE_VIEWS = [
  { value: 'figure', label: 'figure' },
  { value: 'visceral', label: 'visceral' },
] as const;
const FIGURE_CAPTION = 'Illustrative figure. Outline: your start. Shows proportions from the projection, not your exact shape.';
const VISCERAL_CAPTION = 'Waist slice, drawn to scale from the projection. Grey lines: your start. Range shown is the estimate’s; projections are less certain.';

export function FigureOverTime({ timeline, data, controller, showFigure, units, titleAs = 'h2' }: FigureOverTimeProps) {
  const days = data.time.days;
  const day = useCursorDay(controller, days);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [stage, setStage] = useState<StageView>('figure');
  const [announce, setAnnounce] = useState('');
  // bumped when Play stops or a reduced-motion jump lands: the live line then speaks the day once
  const [announceReq, setAnnounceReq] = useState(0);
  const raf = useRef(0);

  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const lines = useMemo(
    () =>
      [
        line(byId.get('scaleWeight'), day, 'weight'),
        line(byId.get('bodyFatPct'), day, 'body fat'),
        line(byId.get('waist'), day, 'waist'),
        line(byId.get('fatMass'), day, 'fat'),
        line(byId.get('leanTissue'), day, 'lean tissue'),
      ].filter((l): l is Line => !!l),
    [byId, day],
  );

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setPlaying(false);
    setAnnounceReq((n) => n + 1);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    if (playing) {
      stop();
      return;
    }
    if (reduced || days <= 1) {
      controller.setCursor(days - 1 + 0.5, 'program', { force: true, pin: true });
      setAnnounceReq((n) => n + 1);
      return;
    }
    setPlaying(true);
    const t0 = performance.now();
    const dur = 2200;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      controller.setCursor(easeInOut(k) * (days - 1) + 0.5, 'program', { force: true, pin: true });
      if (k < 1) raf.current = requestAnimationFrame(step);
      else stop();
    };
    raf.current = requestAnimationFrame(step);
  };

  const params = timeline ? timeline.paramsAt(day) : null;
  const ghost = timeline ? timeline.paramsAt(-1) : null;
  const visceral = stage === 'visceral';
  const vis = params ? liveVisceral(params.visceral) : null;
  // spoken once Play stops (or a jump lands), never per frame (body-figure-v2.md §8)
  const dayWords = `${dayLabel(data.time, day)}${vis ? `: visceral fat about ${roundArea(vis.vatAreaCm2)} square centimetres, likely ${roundArea(vis.areaRangeCm2[0])} to ${roundArea(vis.areaRangeCm2[1])}, ${vis.band}` : ''}`;
  const spoken = useRef(0);
  useEffect(() => {
    if (playing || announceReq === spoken.current) return;
    spoken.current = announceReq;
    setAnnounce(dayWords);
  }, [playing, announceReq, dayWords]);
  const waist = byId.get('waist');
  const waistText = waist && Number.isFinite(waist.daily.values[day]!) ? `${formatNumber(waist.daily.values[day]!, 1)} ${waist.unit}` : undefined;
  const heightCm = timeline?.baseline.heightCm;
  const heightText = heightCm ? (units === 'imperial' ? `${Math.floor(heightCm / 30.48)} ft ${Math.round((heightCm / 2.54) % 12)} in` : `${Math.round(heightCm)} cm`) : undefined;
  const H = titleAs;

  return (
    <Faceplate variant="flush" className="rs-figure" aria-labelledby="rs-figure-title">
      <div className="rs-figure__bar">
        <H id="rs-figure-title" className="lm-h3 rs-figure__title">
          Figure over time
        </H>
        <span className="rs-figure__day lm-eng lm-num" aria-live="off">
          {dayLabel(data.time, day)}
        </span>
        {showFigure && params && ghost ? (
          <KeyBank<StageView> size="sm" label="What the figure panel shows" value={stage} onChange={setStage} options={STAGE_VIEWS} className="rs-figure__views" />
        ) : null}
      </div>
      {showFigure && params && ghost ? (
        visceral ? (
          <div className="rs-figure__visceral" data-testid="rs-visceral">
            <VisceralView params={params} compareTo={ghost} caption={VISCERAL_CAPTION} />
          </div>
        ) : (
          <div className="rs-figure__stage">
            <Figure3D
              params={params}
              compareTo={ghost}
              layers="two-layer"
              size="fill"
              tween={false}
              units={units}
              heightText={heightText}
              showMeasures={waistText ? { waist: waistText } : undefined}
              caption={FIGURE_CAPTION}
            />
          </div>
        )
      ) : showFigure && !timeline ? (
        <p className="rs-figure__none">The figure needs your body inputs. Numbers are shown below.</p>
      ) : null}
      {timeline?.endpointsOnly ? <p className="rs-figure__note">This run did not record the body day by day, so the figure shows the start and the last day only.</p> : null}
      <p className="lm-sr" aria-live="polite" data-testid="rs-figure-live">
        {announce}
      </p>
      <div className="rs-figure__foot">
        <Key size="sm" icon={playing ? Pause : Play} onClick={play} aria-pressed={playing}>
          {playing ? 'Stop' : 'Play'}
        </Key>
        <dl className="rs-figure__vals">
          {lines.map((l) => (
            <div key={l.id}>
              <dt className="lm-eng">{l.name}</dt>
              <dd className="lm-num">
                <span className="rs-figure__from">{l.from}</span>
                <span className="rs-figure__arrow" aria-hidden="true">
                  →
                </span>
                <b>{l.to}</b>
                {l.unit ? <span className="lm-unit">{l.unit}</span> : null}
                <span className="rs-figure__delta">{l.delta}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Faceplate>
  );
}
