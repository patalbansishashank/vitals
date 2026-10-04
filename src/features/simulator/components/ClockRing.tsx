/**
 * <ClockRing> — the 24 h clock dial editor (COMPONENTS §4; REVIEW_FINDINGS #3: a printed dial with 24 hour ticks, a
 * hairline bezel, the eating window and the fast as thin bands — never a thick donut).
 *
 * The eating window runs from the first to the last meal (the engine's own definition), so its two thumbs are the
 * first and last meals: drag either end (the meals between rescale), drag the band to move the whole window, drag a
 * middle meal along the arc, tap the track to add a meal there. Training and cardio blocks drag outside the ring.
 * Snap 15 min (⇧ 5 min). Keyboard: every thumb is an ARIA slider; ←/→ 15 min, ⇧ 5 min, PgUp/PgDn 1 h.
 * Drags draft locally and commit once on release (one undo step per gesture).
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx, VisuallyHidden } from '@/components';
import { formatClock } from '../lib/calendar';
import {
  arcPath,
  clampHour,
  FINE_SNAP_H,
  keyStep,
  moveMeal,
  pointToHour,
  polar,
  shiftMeals,
  SNAP_H,
  snapHour,
  windowOf,
  wrapDelta,
} from '../lib/clock';

export interface RingMeal {
  clockH: number;
  kcal: number;
}

export interface RingSession {
  kind: 'resistance' | 'cardio';
  startH: number;
  durationMin: number;
  label: string;
  dotted?: boolean;
}

export interface ClockRingProps {
  meals: readonly RingMeal[];
  sessions?: readonly RingSession[];
  sleep?: { bedH: number; wakeH: number } | null;
  /** Water-only day: no window, the whole dial is fasted. */
  fast?: { hours: number; caption: string } | null;
  onMealsChange?: (times: number[]) => void;
  onSessionMove?: (index: number, startH: number) => void;
  onAddMeal?: (clockH: number) => void;
  /** Accessible name of the dial group. */
  label?: string;
  /** Energy display unit for meal sizes (Settings; default kcal). */
  energyUnit?: 'kcal' | 'kJ';
  className?: string;
}

/** 16 → "16", 16.5 → "16.5", 36.2 → "36" (fasts over a day read in whole hours). */
function hoursText(h: number): string {
  const r = Math.round(h * 2) / 2;
  return h >= 24 || Number.isInteger(r) ? String(Math.round(h)) : r.toFixed(1);
}

const S = 208;
const C = S / 2;
const R_SESSION = 99;
const R_BEZEL = 92;
const R_BAND = 77;
const R_SLEEP = 68;
const R_NUM = 56;

type DragKind =
  { kind: 'meal'; i: number } | { kind: 'band' } | { kind: 'session'; i: number } | { kind: 'track' };
type Drag = {
  id: number;
  what: DragKind;
  h0: number;
  times0: number[];
  start0: number;
  moved: boolean;
  x0: number;
  y0: number;
};

export function ClockRing({
  meals,
  sessions = [],
  sleep,
  fast,
  onMealsChange,
  onSessionMove,
  onAddMeal,
  label = 'Day clock',
  energyUnit = 'kcal',
  className,
}: ClockRingProps) {
  const eu = (kcal: number) => `${Math.round(energyUnit === 'kJ' ? (kcal * 4.184) / 10 : kcal) * (energyUnit === 'kJ' ? 10 : 1)} ${energyUnit}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draftTimes, setDraftTimes] = useState<number[] | null>(null);
  const [draftSession, setDraftSession] = useState<{ i: number; startH: number } | null>(null);
  const summaryId = useId();

  const sorted = [...meals].sort((a, b) => a.clockH - b.clockH);
  const baseTimes = sorted.map((m) => m.clockH);
  const times = draftTimes ?? baseTimes;
  const total = sorted.reduce((a, m) => a + m.kcal, 0) || 1;
  const w = windowOf(times);
  const editable = Boolean(onMealsChange) && !fast;

  const hourAt = (clientX: number, clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const r = svg.getBoundingClientRect();
    const k = r.width / S || 1;
    return pointToHour(C, C, (clientX - r.left) / k, (clientY - r.top) / k);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const el = (e.target as Element).closest<SVGElement>('[data-drag]');
    if (!el) return;
    const kind = el.dataset.drag;
    const i = Number(el.dataset.i ?? -1);
    let what: DragKind | null = null;
    if (kind === 'meal' && editable) what = { kind: 'meal', i };
    else if (kind === 'band' && editable) what = { kind: 'band' };
    else if (kind === 'track' && editable && onAddMeal) what = { kind: 'track' };
    else if (kind === 'session' && onSessionMove) what = { kind: 'session', i };
    if (!what) return;
    e.preventDefault();
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = {
      id: e.pointerId,
      what,
      h0: hourAt(e.clientX, e.clientY),
      times0: baseTimes,
      start0: sessions[i]?.startH ?? 0,
      moved: false,
      x0: e.clientX,
      y0: e.clientY,
    };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
    d.moved = true;
    const step = e.shiftKey ? FINE_SNAP_H : SNAP_H;
    const h = hourAt(e.clientX, e.clientY);
    const delta = wrapDelta(d.h0, h);
    if (d.what.kind === 'band') setDraftTimes(shiftMeals(d.times0, snapHour(delta, step)));
    else if (d.what.kind === 'meal') {
      const cur = d.times0[d.what.i]!;
      setDraftTimes(moveMeal(d.times0, d.what.i, snapHour(cur + wrapDelta(cur, h), step)));
    } else if (d.what.kind === 'session') {
      const s = sessions[d.what.i];
      if (!s) return;
      const next = clampHour(snapHour(d.start0 + delta, step), 0, 24 - s.durationMin / 60);
      setDraftSession({ i: d.what.i, startH: next });
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.what.kind === 'track') {
      if (!d.moved) onAddMeal?.(snapHour(d.h0));
      return;
    }
    if (d.what.kind === 'session') {
      if (draftSession && d.moved) onSessionMove?.(draftSession.i, draftSession.startH);
      setDraftSession(null);
      return;
    }
    if (draftTimes && d.moved) onMealsChange?.(draftTimes);
    setDraftTimes(null);
  };

  const onPointerCancel = () => {
    drag.current = null;
    setDraftTimes(null);
    setDraftSession(null);
  };

  const mealKey = (i: number) => (e: KeyboardEvent<SVGGElement>) => {
    const s = keyStep(e.key, e.shiftKey);
    if (s === null) return;
    e.preventDefault();
    onMealsChange?.(moveMeal(baseTimes, i, baseTimes[i]! + s));
  };
  const bandKey = (e: KeyboardEvent<SVGGElement>) => {
    const s = keyStep(e.key, e.shiftKey);
    if (s === null) return;
    e.preventDefault();
    onMealsChange?.(shiftMeals(baseTimes, s));
  };
  const sessionKey = (i: number) => (e: KeyboardEvent<SVGGElement>) => {
    const s = keyStep(e.key, e.shiftKey);
    const cur = sessions[i];
    if (s === null || !cur) return;
    e.preventDefault();
    onSessionMove?.(i, clampHour(cur.startH + s, 0, 24 - cur.durationMin / 60));
  };

  // ---- geometry
  const ticks = [];
  for (let h = 0; h < 24; h++) {
    const major = h % 6 === 0;
    const [x0, y0] = polar(C, C, R_BEZEL, h);
    const [x1, y1] = polar(C, C, R_BEZEL - (major ? 8 : h % 3 === 0 ? 6 : 4), h);
    ticks.push(
      <line
        key={h}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        className="sim-ring__tick"
        data-major={major || undefined}
      />,
    );
  }
  const numerals = [0, 6, 12, 18].map((h) => {
    const [x, y] = polar(C, C, R_NUM, h);
    return (
      <text key={h} x={x} y={y} className="sim-ring__num" textAnchor="middle" dominantBaseline="central">
        {String(h).padStart(2, '0')}
      </text>
    );
  });

  const fastHours = fast ? fast.hours : 24 - w.length;
  const oneMeal = times.length === 1;
  const centre1 = `fast ${hoursText(fastHours)} h`;
  const whole = Math.abs(w.length - Math.round(w.length)) < 1e-6;
  const centre2 = fast
    ? fast.caption
    : oneMeal
      ? 'one meal'
      : whole
        ? `${24 - Math.round(w.length)}:${Math.round(w.length)}`
        : `window ${hoursText(w.length)} h`;

  const sessionsShown = sessions.map((s, i) =>
    draftSession?.i === i ? { ...s, startH: draftSession.startH } : s,
  );

  const summary = fast
    ? `Water-only fast, ${Math.round(fast.hours)} hours, ${fast.caption}.`
    : `Eat ${formatClock(w.start)} to ${formatClock(w.end)}, ${times.length} meal${times.length === 1 ? '' : 's'}: ${times.map((t, i) => `${formatClock(t)} (${eu(sorted[i]?.kcal ?? 0)})`).join(', ')}.` +
      sessionsShown
        .map((s) => ` ${s.label} ${formatClock(s.startH)} to ${formatClock(s.startH + s.durationMin / 60)}.`)
        .join('') +
      (sleep ? ` Sleep ${formatClock(sleep.bedH)} to ${formatClock(sleep.wakeH)}.` : '');

  return (
    <div className={cx('sim-ring', className)}>
      <svg
        ref={svgRef}
        className="sim-ring__svg"
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        role="group"
        aria-label={label}
        aria-describedby={summaryId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <circle cx={C} cy={C} r={R_BEZEL} className="sim-ring__bezel" />
        {ticks}
        {numerals}
        {/* sleep (inner thin band) */}
        {sleep ? (
          <path d={arcPath(C, C, R_SLEEP, sleep.bedH, sleep.wakeH)} className="sim-ring__sleep" />
        ) : null}
        {/* track: the dial's fasted hours read as a dotted band, the window as a solid one */}
        <circle cx={C} cy={C} r={R_BAND} className="sim-ring__track" data-drag="track" />
        {fast ? (
          <path d={arcPath(C, C, R_BAND, 0, 24, true)} className="sim-ring__fast sim-ring__fast--day" />
        ) : (
          <>
            <path
              d={arcPath(C, C, R_BAND, w.end, w.start + 24 * (w.length <= 0 ? 1 : 0), w.length <= 0)}
              className="sim-ring__fast"
            />
            {w.length > 0 ? (
              <g
                role="slider"
                tabIndex={editable ? 0 : -1}
                aria-label="eating window"
                aria-valuemin={0}
                aria-valuemax={24 - w.length}
                aria-valuenow={w.start}
                aria-valuetext={`window ${formatClock(w.start)} to ${formatClock(w.end)}`}
                onKeyDown={editable ? bandKey : undefined}
                className="sim-ring__bandg"
              >
                <path d={arcPath(C, C, R_BAND, w.start, w.end)} className="sim-ring__window" />
                <path d={arcPath(C, C, R_BAND, w.start, w.end)} className="sim-ring__hit" data-drag="band" />
              </g>
            ) : null}
          </>
        )}
        {/* sessions outside the ring */}
        {sessionsShown.map((s, i) => {
          const h1 = s.startH + s.durationMin / 60;
          return (
            <g
              key={i}
              role="slider"
              tabIndex={onSessionMove ? 0 : -1}
              aria-label={`${s.label} start`}
              aria-valuemin={0}
              aria-valuemax={24}
              aria-valuenow={s.startH}
              aria-valuetext={`${s.label} starts ${formatClock(s.startH)}, ${Math.round(s.durationMin)} minutes`}
              onKeyDown={onSessionMove ? sessionKey(i) : undefined}
              className="sim-ring__sessiong"
            >
              <path
                d={arcPath(C, C, R_SESSION, s.startH, h1)}
                className="sim-ring__session"
                data-kind={s.kind}
                data-dotted={s.dotted || undefined}
              />
              <path
                d={arcPath(C, C, R_SESSION, s.startH, h1)}
                className="sim-ring__hit"
                data-drag="session"
                data-i={i}
              />
            </g>
          );
        })}
        {/* meals: first and last are the window thumbs */}
        {!fast
          ? times.map((t, i) => {
              const [x, y] = polar(C, C, R_BAND, t);
              const edge = !oneMeal && (i === 0 || i === times.length - 1);
              const share = (sorted[i]?.kcal ?? 0) / total;
              const name = oneMeal
                ? 'meal'
                : i === 0
                  ? 'window starts'
                  : i === times.length - 1
                    ? 'window ends'
                    : `meal ${i + 1}`;
              return (
                <g
                  key={i}
                  role="slider"
                  tabIndex={editable ? 0 : -1}
                  aria-label={
                    oneMeal
                      ? 'meal time'
                      : i === 0
                        ? 'window start'
                        : i === times.length - 1
                          ? 'window end'
                          : `meal ${i + 1} time`
                  }
                  aria-valuemin={0}
                  aria-valuemax={24}
                  aria-valuenow={t}
                  aria-valuetext={`${name} ${formatClock(t)}, ${eu(sorted[i]?.kcal ?? 0)}`}
                  onKeyDown={editable ? mealKey(i) : undefined}
                  className="sim-ring__thumbg"
                  data-drag="meal"
                  data-i={i}
                >
                  <circle cx={x} cy={y} r={12} className="sim-ring__focus" />
                  {edge ? (
                    <>
                      <circle cx={x} cy={y} r={8.5} className="sim-ring__cap" />
                      <circle cx={x} cy={y} r={2.2 + 2.2 * share} className="sim-ring__dot" />
                    </>
                  ) : (
                    <circle cx={x} cy={y} r={3.5 + 4 * share} className="sim-ring__meal" />
                  )}
                </g>
              );
            })
          : null}
        <text x={C} y={C - 5} className="sim-ring__c1" textAnchor="middle">
          {centre1}
        </text>
        <text x={C} y={C + 13} className="sim-ring__c2" textAnchor="middle">
          {centre2}
        </text>
      </svg>
      <VisuallyHidden id={summaryId}>{summary}</VisuallyHidden>
    </div>
  );
}
