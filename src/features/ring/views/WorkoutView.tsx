/** One workout (Ring › Activity › a workout). */
import { useId, useMemo, useRef } from 'react';
import { Activity, HeartPulse, MapPin, Check, Clock } from 'lucide-react';
import { useDrawIn } from '@/app/motion';
import { useElementWidth } from '@/features/charts/core/hooks';
import { useWidth } from '@/components/viz/hooks';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GlowLine,
  GradientCard,
  HeroNumber,
  MonoMeta,
  Stack,
  StackBar,
  lineModel,
  lineTwin,
  stackTwin,
  formatEnergy,
  formatNumber,
  type GlowLineProps,
  type ShareBarRow,
} from '@/components';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useEnergyUnit, useQuietMode, useSettingsStore } from '@/state/settingsStore';
import { QUIET_ZONE_EDGES, aboveMaxText, quietZoneLabel } from '@/features/lib/zoneRange';
import type { ZoneBoundaries } from '@/living/sensors';
import { datesOverlapping, wallIso } from '../activities';
import { useTimelines } from '../load';
import { useRingActivities } from '../useActivities';
import { RING_COPY as C } from '../copy';
import { useHrIntervals, useSeries, useWorkouts } from '../data';
import {
  routePath,
  clockOf,
  decodePolyline,
  distanceParts,
  hourOf,
  legacyZoneText,
  minutesText,
  paceText,
  shiftDate,
  wholePercents,
} from '../model';
import type { GaugeRawPoint, GaugeTimeline, GaugeWorkout } from '../types';
import { exactSegments, workoutZones, zoneBasisText, type ZoneSource } from '../zones';
import { useZoneSources } from '../zoneSource';
import { useUnitPrefs } from '../components/parts';
import { partOfDay, quietDuration } from '../quiet';
import { signalLine } from './detailSeries';
import './details.css';

// ---------------------------------------------------------------------------------------------------------------
// One workout

export function useWorkout(id: string, date: string | null, today: string) {
  const from = date ?? shiftDate(today, -89);
  const to = date ?? today;
  const q = useWorkouts(from, to);
  return { q, workout: q.data?.sessions.find((w) => w.id === id) ?? null };
}

/** The span a workout's figures are read over: the approved activity's decided window and pauses, else Gauge's own. */
export interface WorkoutSpan {
  start: number;
  end: number;
  pauses: Array<{ start: number; end: number }>;
}

/** Gauge's workout over another span (an edited window): the zone functions read `start`, `end` and `pauses`. */
const overSpan = (w: GaugeWorkout, sp: WorkoutSpan): GaugeWorkout => ({
  ...w,
  start: new Date(sp.start).toISOString(),
  end: new Date(sp.end).toISOString(),
  pauses: sp.pauses.map((p) => ({
    start: new Date(p.start).toISOString(),
    end: new Date(p.end).toISOString(),
  })),
});

/**
 * The HR plot's x: clock hours unwrapped from the workout's start (23:50 → 23.83, 00:10 → 24.17), so a workout across
 * midnight keeps its order; the axis labels wrap back to the clock at the presentation (S32/A32).
 */
export function unwrappedHours(startIso: string, startMs: number, at: string): number {
  return hourOf(startIso) + (Date.parse(at) - startMs) / 3_600_000;
}

function WorkoutHeartCard({
  w,
  span,
  frozen,
  tz,
  today,
  points,
}: {
  w: GaugeWorkout;
  span: WorkoutSpan;
  frozen: ZoneBoundaries | null;
  tz: string;
  today: string;
  points: Array<{ t: number; v: number }>;
}) {
  const dates = useMemo(
    () => datesOverlapping({ start: span.start, end: span.end }, tz),
    [span.start, span.end, tz],
  );
  const tls = useTimelines(dates, today);
  const raw = useHrIntervals(new Date(span.start).toISOString(), new Date(span.end).toISOString());
  const quiet = useQuietMode().on;
  const hatch = useSettingsStore((s) => s.chartPatterns);
  const source = useZoneSources(w.date)(w);
  const boundaries = frozen ?? source.boundaries;
  const basisSource: ZoneSource = frozen ? { boundaries: frozen, frozen: true, profile: null } : source;
  const timelines = useMemo(
    () => (tls ? dates.map((d) => tls.get(d)).filter((t): t is GaugeTimeline => !!t) : []),
    [tls, dates],
  );
  const exact = raw.status === 'ready' ? exactSegments(raw.data, { start: span.start, end: span.end }) : null;
  const zones =
    timelines.length || exact ? workoutZones(overSpan(w, span), timelines, boundaries, exact) : null;
  const legacy = legacyZoneText(w);
  const z = zones?.time;
  const moving = z ? Math.max(1, z.elapsedS - z.pausedS) : 1;
  const drawn: Array<ShareBarRow & { s: number }> =
    z && zones
      ? [
          ...z.zonesS
            .map((s, i) => ({
              id: `z${i + 1}`,
              label: quiet ? quietZoneLabel(i) : `Zone ${i + 1} · ${zoneSpan(zones.boundaries.edgesBpm, i)}`,
              valueText: minutesText(s / 60),
              share: s / moving,
              hue: `var(--lm-hr-zone-${i + 1})`,
              s,
            }))
            .filter((r) => r.s >= 30),
          ...(z.aboveEstimateS > 0
            ? [
                {
                  id: 'above',
                  label: quiet
                    ? QUIET_ZONE_EDGES.above
                    : `Above your maximum · ${aboveMaxText(zones.boundaries)}`,
                  valueText: minutesText(z.aboveEstimateS / 60),
                  share: z.aboveEstimateS / moving,
                  hue: 'var(--lm-hr-zone-5)',
                  s: z.aboveEstimateS,
                },
              ]
            : []),
          ...(z.below50S >= 30
            ? [
                {
                  id: 'below',
                  label: quiet ? QUIET_ZONE_EDGES.below : 'Under zone 1',
                  valueText: minutesText(z.below50S / 60),
                  share: z.below50S / moving,
                  hue: 'var(--lm-ink-3)',
                  s: z.below50S,
                },
              ]
            : []),
          ...(z.unknownS > 30
            ? [
                {
                  id: 'unknown',
                  label: 'No reading',
                  valueText: minutesText(z.unknownS / 60),
                  share: z.unknownS / moving,
                  hue: 'var(--lm-ink-3)',
                  unknown: true,
                  s: z.unknownS,
                },
              ]
            : []),
        ]
      : [];
  const pcts = wholePercents(
    drawn.map((r) => r.s),
    moving,
  );
  const rows: ShareBarRow[] = drawn.map(({ s: _s, ...r }, k) => ({ ...r, shareText: `${pcts[k]}\u00a0%` }));
  const tableRows: ShareBarRow[] =
    z && zones
      ? [
          ...z.zonesS.map((s, i) => ({
            id: `z${i + 1}`,
            label: `Zone ${i + 1} · ${zoneSpan(zones.boundaries.edgesBpm, i)}`,
            valueText: minutesText(s / 60),
            share: s / moving,
            hue: `var(--lm-hr-zone-${i + 1})`,
          })),
          ...rows.filter((r) => !/^z\d/.test(r.id)),
        ]
      : [];
  const basis = zoneBasisText(basisSource);
  const line = {
    label: 'Heart rate during the workout',
    series: signalLine(points),
    unit: 'bpm',
    from: span.start,
    to: span.end,
    tz,
  };
  const average = points.length ? points.reduce((n, p) => n + p.v, 0) / points.length : w.avgHr;
  return (
    <GradientCard
      domain="heart"
      size="hero"
      head={
        <CardHead
          as="h2"
          icon={HeartPulse}
          title={C.heartRate}
          info={{
            title: 'Heart-rate zones',
            body: quiet
              ? 'Zones are shares of your maximum heart rate, from Settings › Heart rate. Time in each zone comes from the workout’s raw readings, or minute averages when raw readings are missing. The ring app’s own zones use a different method and are kept as a comparison.'
              : 'Zones are shares of your maximum heart rate, from Settings › Heart rate. Time in each zone comes from raw heart-rate readings, or minute averages when those are missing. The ring app’s own zones use 220 minus age and are shown only as a comparison.',
            source: {
              kind: 'ring',
              words: zones?.source === 'samples' ? C.zonesFromSamples : C.zonesFromMinutes,
            },
            range: quiet ? undefined : (
              <>
                <p>{basis}</p>
                {legacy ? <p>{legacy}</p> : null}
              </>
            ),
            twin: quiet ? undefined : (
              <>
                <ChartTwin data={lineTwin(line)} />
                <ChartTwin data={stackTwin({ label: C.zones, rows: tableRows })} />
              </>
            ),
          }}
        />
      }
      foot={
        <CardFoot
          state={{ word: zones ? 'Workout readings' : 'No zone readings' }}
          right={!quiet && zones ? basis : undefined}
        />
      }
    >
      <div className="rg-workout__heart">
        <div className="rg-workout__hero">
          <HeroNumber
            size="num-l"
            value={average === null ? null : Math.round(average)}
            unit="bpm"
            quietWord={quiet ? 'Heart-rate zones' : undefined}
            label={
              quiet
                ? 'Heart-rate zones'
                : `Average heart rate ${average === null ? 'not available' : `${formatNumber(average, 0)} bpm`}`
            }
          />
          {!quiet ? (
            <MonoMeta tone="hue">
              Average{w.maxHr !== null ? ` · Peak ${formatNumber(w.maxHr, 0)} · ${C.singleReading}` : ''}
            </MonoMeta>
          ) : null}
        </div>
        {!quiet && points.length ? <WorkoutHrLine line={line} boundaries={boundaries} hatch={hatch} /> : null}
        {zones ? (
          <div className="rg-workout__zones" data-patterns={hatch || undefined}>
            <StackBar label={C.zones} rows={rows} quiet={quiet} twin={false} legend="none" hue="heart" />
            <ul className="rg-workout__zone-list" aria-label={C.zones}>
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="rg-workout__zone-name">
                    <i style={{ background: r.hue }} aria-hidden="true" />
                    <MonoMeta tone="hue">{r.label}</MonoMeta>
                  </span>
                  <MonoMeta tone="hue">
                    {quiet
                      ? r.share < 0.1
                        ? 'A small part'
                        : r.share < 0.34
                          ? 'Some'
                          : r.share < 0.67
                            ? 'A large part'
                            : 'Most'
                      : `${r.valueText} · ${r.shareText}`}
                  </MonoMeta>
                </li>
              ))}
            </ul>
            <MonoMeta tone="hue">
              {quiet
                ? zones.source === 'samples'
                  ? C.zonesFromSamples
                  : C.zonesFromMinutes
                : `${zones.source === 'samples' ? C.zonesFromSamples : C.zonesFromMinutes}${z?.coveragePct !== null && z?.coveragePct !== undefined && z.coveragePct < 95 ? ` · Readings cover ${Math.round(z.coveragePct)} %` : ''}`}
            </MonoMeta>
          </div>
        ) : !boundaries ? (
          <p className="rg-note">
            Add your age in Body, or a maximum heart rate in Settings › Heart rate, to see your heart-rate
            zones.
          </p>
        ) : null}
      </div>
    </GradientCard>
  );
}

/** Whether a Gauge workout counts: the approved activity it is evidence for, a pending one, or neither. */
function useWorkoutActivity(w: GaugeWorkout, activityId: string | null) {
  const acts = useRingActivities(shiftDate(w.date, -1), shiftDate(w.date, 1));
  const approved =
    (activityId ? acts.approved.find((a) => a.id === activityId) : undefined) ??
    acts.approved.find((a) => a.gaugeIds.includes(w.id)) ??
    null;
  const pending = approved ? null : (acts.pending.find((a) => a.gaugeIds.includes(w.id)) ?? null);
  return { approved, pending, tz: acts.tz };
}

export function WorkoutView({
  w,
  activityId = null,
  today,
}: {
  w: GaugeWorkout;
  activityId?: string | null;
  today: string;
}) {
  const prefs = useUnitPrefs();
  const quiet = useQuietMode().on;
  const eu = useEnergyUnit();
  const { approved, pending, tz } = useWorkoutActivity(w, activityId);
  // (S25) the figures read the approved activity's decided window (an edit moves it), else Gauge's own session
  const span: WorkoutSpan = useMemo(
    () =>
      approved?.window
        ? { start: approved.window.start, end: approved.window.end, pauses: approved.pauses }
        : {
            start: Date.parse(w.start),
            end: Date.parse(w.end),
            pauses: (w.pauses ?? []).map((p) => ({ start: Date.parse(p.start), end: Date.parse(p.end) })),
          },
    [approved, w],
  );
  const edited =
    !!approved?.window &&
    (Math.abs(approved.window.start - Date.parse(w.start)) > 30_000 ||
      Math.abs(approved.window.end - Date.parse(w.end)) > 30_000);
  const startIso = approved?.window ? wallIso(span.start, tz) : w.start;
  const endIso = approved?.window ? wallIso(span.end, tz) : w.end;
  const dist = w.distanceM ? distanceParts(w.distanceM, prefs.units) : null;
  const pace = w.distanceM ? paceText(w.durationS, w.distanceM, prefs.units) : null;
  const route = w.route ? decodePolyline(w.route.polyline) : [];
  // the series takes the person's wall clock (as Gauge's own `start`), the minute after the end included
  const hr = useSeries(
    'hr',
    wallIso(span.start, tz).slice(0, 16),
    wallIso(span.end + 60_000, tz).slice(0, 16),
    'raw',
  );
  // (S32/A32) x in clock hours unwrapped from the start: a workout across midnight keeps its order

  const hrPoints =
    (hr.data?.points as GaugeRawPoint[] | undefined)
      ?.filter((p) => p.value != null && Date.parse(p.at) >= span.start && Date.parse(p.at) <= span.end)
      .map((p) => ({ t: Date.parse(p.at), v: p.value! })) ?? [];
  const movingMin =
    (span.end - span.start - span.pauses.reduce((t, p) => t + Math.max(0, p.end - p.start), 0)) / 60_000;
  // (r063 FX3 sR10/aR10) quiet: the time moving in words; no distance, pace, steps, energy or heart-rate figures
  // (r068 W1) every value through Val, the unit in the text face, one size; Gauge's estimate only when it differs
  const duration = durationParts(approved?.window ? movingMin : w.durationS / 60);
  const gaugeDiffers =
    w.kcal !== null &&
    !(approved && approved.grossKcal !== null && Math.round(approved.grossKcal) === Math.round(w.kcal));
  const facts = quiet
    ? []
    : [
        { label: C.duration, value: `${duration.value}${duration.unit ? ` ${duration.unit}` : ''}` },
        ...(pace ? [{ label: C.pace, value: `${pace.value} ${pace.unit}` }] : []),
        ...(approved?.grossKcal != null
          ? [{ label: C.bookedEnergy, value: formatEnergy(approved.grossKcal, eu) }]
          : []),
        ...(w.kcal !== null && gaugeDiffers
          ? [{ label: approved ? C.gaugeEnergyComparison : C.gaugeEnergy, value: formatEnergy(w.kcal, eu) }]
          : []),
        ...(w.steps !== null ? [{ label: C.steps, value: formatNumber(w.steps, 0) }] : []),
      ];
  // (r068 W1) whether it counts is the card's fact line, not a tag
  const status = approved
    ? edited
      ? C.countedEdited
      : C.counted
    : pending
      ? C.pendingWorkout
      : C.notCountedWorkout;
  const when = quiet
    ? `${fmtDay(w.date as LocalDate)} · ${partOfDay(startIso)}`
    : `${fmtDay(w.date as LocalDate)} · ${clockOf(startIso)}–${clockOf(endIso)}`;
  // (r068 G04) one Summary card: the facts and, beside them on a wide screen (under them on a phone), the route, so no
  // pair of cards ends ragged
  const hasRoute = route.length > 1;
  const heroValue = dist?.value ?? duration.value;
  const heroUnit = dist?.unit ?? duration.unit;
  const quietWord = quietDuration(approved?.window ? movingMin : w.durationS / 60).replace(/^./, (c) =>
    c.toUpperCase(),
  );
  return (
    <Stack>
      <GradientCard
        domain="steps"
        size="hero"
        head={
          <CardHead
            as="h2"
            icon={Activity}
            title="Summary"
            info={{
              title: 'This workout',
              body: 'How this workout counts in your day. The ring reports distance, steps and route. Duration and booked energy follow the times you approved. Energy is gross, including what you would burn at rest. The phone’s estimate appears when it differs.',
              source: {
                kind: 'ring',
                words:
                  'Ring session through your phone; counted status and booked energy from your approved activity.',
              },
              terms: quiet ? undefined : [{ term: C.bookedEnergy, text: C.bookedEnergyInfo }],
              evidence: { to: '/evidence/10-wearable-calorie-error', label: 'Wearable energy estimates' },
            }}
          />
        }
        foot={
          <CardFoot
            state={{ word: status, icon: approved ? Check : Clock }}
            right={quiet ? partOfDay(startIso) : when}
          />
        }
      >
        <div className="rg-workout__summary" data-route={hasRoute || undefined}>
          <div className="rg-workout__heart">
            <HeroNumber
              size="hero"
              value={heroValue}
              unit={heroUnit}
              quietWord={quiet ? quietWord : undefined}
              label={
                quiet
                  ? quietWord
                  : `${dist ? 'Distance' : C.duration} ${heroValue}${heroUnit ? ` ${heroUnit}` : ''}`
              }
            />
            <dl className="rg-workout__facts">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt>
                    <MonoMeta tone="hue">{f.label}</MonoMeta>
                  </dt>
                  <dd>
                    <MonoMeta tone="ink">{f.value}</MonoMeta>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          {hasRoute ? (
            <figure className="rg-workout__route">
              <WorkoutRoute points={route} quiet={quiet} />
            </figure>
          ) : null}
        </div>
      </GradientCard>
      <WorkoutHeartCard
        w={w}
        span={span}
        frozen={approved?.zones ?? null}
        tz={tz}
        today={today}
        points={hrPoints}
      />
    </Stack>
  );
}

/** (r068 W3) A zone's bpm as one short range ("146–164 bpm"; the top zone "165–183 bpm"), whole beats. */
function zoneSpan(edges: readonly number[], z: number): string {
  const lo = Math.round(edges[z]!);
  const hi = Math.round(edges[z + 1]!);
  return `${lo}${'–'}${z === 4 ? hi : hi - 1} bpm`;
}

/** "45 min" → 45 · min; "1 h 05" → 1 h 05 (no unit split). */
function durationParts(min: number): { value: string; unit?: string } {
  const t = minutesText(min);
  const m = /^(\S+) min$/.exec(t);
  return m ? { value: m[1]!, unit: 'min' } : { value: t };
}

/** GPS shape in metres, north up; the start stays hollow and the end filled. */
function WorkoutRoute({
  points,
  quiet,
}: {
  points: ReadonlyArray<readonly [number, number]>;
  quiet: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const draw = useRef<SVGSVGElement>(null);
  const width = useElementWidth(box, 500) || 500;
  const route = routePath(points, width, 200, 24);
  useDrawIn(draw);
  if (!route) return null;
  return (
    <div ref={box} className="rg-route">
      <svg
        ref={draw}
        width="100%"
        viewBox={`0 0 ${width} 200`}
        role="img"
        aria-label={
          quiet
            ? 'Route, from the hollow start mark to the filled end mark.'
            : `Route of ${points.length} GPS points, from the hollow start mark to the filled end mark.`
        }
      >
        <path className="rg-route__line" d={route.d} />
        <circle className="rg-route__start" cx={route.start[0]} cy={route.start[1]} r="5" />
        <circle className="rg-route__end" cx={route.end[0]} cy={route.end[1]} r="5" />
        <text className="lmc-lv-tick" x="12" y="18">
          North
        </text>
      </svg>
      <MonoMeta tone="hue">
        <MapPin size={14} aria-hidden="true" /> Hollow start · filled end
      </MonoMeta>
    </div>
  );
}

/** Local flat zone washes share GlowLine's own y model; the line and its keyboard read-out stay the shared picture. */
function WorkoutHrLine({
  line,
  boundaries,
  hatch,
}: {
  line: GlowLineProps;
  boundaries: ZoneBoundaries | null;
  hatch: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(288);
  const pattern = useId();
  const model = lineModel({ ...line, height: 180, yTicks: 0, xTicks: 'hours' }, width);
  const [lo, hi] = model.domain;
  return (
    <div ref={ref} className="rg-workout__hrline">
      {boundaries ? (
        <svg className="rg-workout__washes" width={width} height="180" aria-hidden="true">
          <defs>
            <pattern
              id={pattern}
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--lm-ink)" strokeWidth="1" />
            </pattern>
          </defs>
          {Array.from({ length: 5 }, (_, i) => {
            const a = Math.max(lo, boundaries.edgesBpm[i]!);
            const b = Math.min(hi, boundaries.edgesBpm[i + 1]!);
            if (b <= a) return null;
            const y = model.y(b),
              h = model.y(a) - y;
            return (
              <g key={i} data-zone={i + 1}>
                <rect
                  x="0"
                  y={y}
                  width={width}
                  height={h}
                  fill={`var(--lm-hr-zone-${i + 1})`}
                  opacity=".14"
                />
                {hatch ? (
                  <rect x="0" y={y} width={width} height={h} fill={`url(#${pattern})`} opacity=".12" />
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      <GlowLine
        {...line}
        height={180}
        yTicks={0}
        xTicks="hours"
        hue="heart"
        twin={false}
        area
        endDot="static"
      />
    </div>
  );
}
