/**
 * Battery over time (design/screens/ring-pages.md §5.7): a 64 px line, 0–100 %, the last 7 days, from the ring
 * service's battery samples. The line breaks where readings are missing (no line across more than 6 h without a
 * sample), a hairline at 15 % is labelled "low", and a table twin lists each day's lowest and highest. Fewer than two
 * samples (or a service that keeps none): "Not enough readings yet."
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Engraved } from '@/components';
import { THIN_SPACE } from '@/components/lib/format';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtDay } from '@/features/living/format';
import { localDateOf, useLivingClock } from '@/features/living/clock';
import { addDays } from '@/living/dates';
import { ChartShell, SHELL_COPY, TwinTable } from '@/features/signals/charts/kit';
import { runsOf, type SeriesPoint } from '@/features/signals/charts/ringData';
import { useRingService } from './data';
import { RING_SECTIONS_COPY } from './copySections';
import './ring-sections.css';

const C = RING_SECTIONS_COPY.settings;
const HOUR = 3_600_000;
const DAYS = 7;
/** No line across a stretch longer than this without a sample. */
export const BATTERY_GAP_MS = 6 * HOUR;
export const BATTERY_LOW = 15;
const H = 64;
const PAD = { l: 34, r: 30, t: 4, b: 14 };

const pct = (v: number) => `${Math.round(v)}${THIN_SPACE}%`;
const midnight = (d: string) => new Date(`${d}T00:00:00`).getTime();

export function BatteryHistory({ ringKey }: { ringKey: string }) {
  const service = useRingService();
  const clock = useLivingClock();
  const [got, setGot] = useState<{ key: string; points: SeriesPoint[] } | null>(null);
  const supported = typeof service.batteryHistory === 'function';

  useEffect(() => {
    if (!service.batteryHistory) return;
    let live = true;
    service.batteryHistory(ringKey, DAYS).then(
      (pts) => {
        if (live) setGot({ key: ringKey, points: pts.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).map((p) => ({ t: p.t, v: p.v })).sort((a, b) => a.t - b.t) });
      },
      () => {
        if (live) setGot({ key: ringKey, points: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [service, ringKey]);

  const end = clock.now().getTime();
  const start = end - DAYS * 24 * HOUR;
  const loaded = got && got.key === ringKey ? got.points : null;
  const points = useMemo(() => (loaded ?? []).filter((p) => p.t >= start && p.t <= end), [loaded, start, end]);

  if (!supported || (loaded && points.length < 2)) {
    return (
      <div className="rs-batt">
        <Engraved as="p">{C.battery}</Engraved>
        <p className="rs-line">{C.batteryEmpty}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="rs-batt" aria-busy="true">
        <Engraved as="p">{C.battery}</Engraved>
        <Engraved as="p">{SHELL_COPY.reading}</Engraved>
      </div>
    );
  }
  return <BatteryChart points={points} start={start} end={end} />;
}

function BatteryChart({ points, start, end }: { points: SeriesPoint[]; start: number; end: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = Math.max(160, useElementWidth(ref, 320));
  const plotW = w - PAD.l - PAD.r;
  const x = (t: number) => PAD.l + ((t - start) / (end - start)) * plotW;
  const y = (v: number) => PAD.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PAD.t - PAD.b);
  const runs = runsOf(points, BATTERY_GAP_MS);

  // one tick per local midnight inside the window, labelled with the weekday of the day that starts there
  const ticks: Array<{ t: number; label: string }> = [];
  for (let d = addDays(localDateOf(new Date(start)), 1); midnight(d) <= end; d = addDays(d, 1)) ticks.push({ t: midnight(d), label: fmtDay(d).split(' ')[0]! });

  // the table twin: one row per day with readings
  const perDay = new Map<string, { lo: number; hi: number; n: number }>();
  for (const p of points) {
    const d = localDateOf(new Date(p.t));
    const e = perDay.get(d);
    if (e) {
      e.lo = Math.min(e.lo, p.v);
      e.hi = Math.max(e.hi, p.v);
      e.n++;
    } else perDay.set(d, { lo: p.v, hi: p.v, n: 1 });
  }
  const rows = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, e]) => [fmtDay(d), pct(e.lo), pct(e.hi), String(e.n)]);
  const vals = points.map((p) => p.v);
  const summary = C.batterySummary(
    fmtDay(localDateOf(new Date(start))),
    fmtDay(localDateOf(new Date(end))),
    pct(Math.min(...vals)),
    pct(Math.max(...vals)),
    pct(points[points.length - 1]!.v),
  );

  return (
    <div className="rs-batt" ref={ref}>
      <ChartShell title={C.battery} summary={summary} height={H} table={<TwinTable caption={C.batteryTable} head={C.batteryCols} rows={rows} />}>
        <svg className="sg-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={summary}>
          <line className="sg-grid" x1={PAD.l} x2={w - PAD.r} y1={y(100) + 0.5} y2={y(100) + 0.5} />
          <line className="sg-axis" x1={PAD.l} x2={w - PAD.r} y1={y(0) + 0.5} y2={y(0) + 0.5} />
          <text className="sg-tick" x={PAD.l - 4} y={y(100) + 4} textAnchor="end">
            {pct(100)}
          </text>
          <text className="sg-tick" x={PAD.l - 4} y={y(0) + 3} textAnchor="end">
            {pct(0)}
          </text>
          <line className="rs-batt__low" data-low="true" x1={PAD.l} x2={w - PAD.r} y1={y(BATTERY_LOW) + 0.5} y2={y(BATTERY_LOW) + 0.5} />
          <text className="sg-label" x={w - PAD.r + 4} y={y(BATTERY_LOW) + 4}>
            {C.batteryLow}
          </text>
          {ticks.map((k) => (
            <g key={k.t}>
              <line className="sg-grid" x1={x(k.t) + 0.5} x2={x(k.t) + 0.5} y1={y(100)} y2={y(0) + 3} />
              <text className="sg-tick" x={x(k.t) + 3} y={H - 2}>
                {k.label}
              </text>
            </g>
          ))}
          {runs.map((r, i) =>
            r.length === 1 ? (
              <circle key={i} className="rs-batt__dot" cx={x(r[0]!.t)} cy={y(r[0]!.v)} r={1.5} />
            ) : (
              <polyline key={i} className="rs-batt__line" points={r.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
            ),
          )}
        </svg>
      </ChartShell>
    </div>
  );
}
