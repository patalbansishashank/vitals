/** Discrete ring-index readings. No smoothing or connecting strokes across unknown time. */
import { useState, type KeyboardEvent } from 'react';
import { useWidth } from '@/components/viz/hooks';
import { clockText } from '@/components/viz/geometry';
import { BANDS, bandIndex, minutesText, stressSegments } from '../model';
import './stress-history.css';

type Point = { t: number; v: number };
export interface StressHistoryProps {
  points: readonly Point[];
  from: number;
  to: number;
  now?: number | null;
  quiet?: boolean;
  label?: string;
}
export function StressHistory({
  points,
  from,
  to,
  now,
  quiet,
  label = 'Stress through the day',
}: StressHistoryProps) {
  const [ref, width] = useWidth<HTMLDivElement>(300);
  const [selected, select] = useState<number | null>(null);
  const end = Math.max(from, Math.min(to, now ?? to));
  const readings = points
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t) && p.t >= from && p.t < end)
    .sort((a, b) => a.t - b.t);
  const segments = stressSegments(readings, from, end);
  const covered = segments.reduce((n, s) => n + s.to - s.from, 0) / 60_000;
  const unknown = Math.max(0, (end - from) / 60_000 - covered);
  const active = readings[Math.min(selected ?? readings.length - 1, readings.length - 1)];
  const time = clockText;
  const band = (v: number) => BANDS.stress![bandIndex(BANDS.stress!, v)]!.word;
  const left = 66,
    right = Math.max(left + 1, width - 6),
    top = 8,
    bottom = 132;
  const x = (t: number) => left + ((t - from) / Math.max(1, to - from)) * (right - left);
  const y = (v: number) => bottom - (Math.min(100, Math.max(0, v)) / 100) * (bottom - top);
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!readings.length) return;
    const i = selected ?? readings.length - 1;
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? readings.length - 1
          : e.key === 'ArrowLeft'
            ? Math.max(0, i - 1)
            : e.key === 'ArrowRight'
              ? Math.min(readings.length - 1, i + 1)
              : null;
    if (next !== null) {
      e.preventDefault();
      select(next);
    }
    if (e.key === 'Escape') select(null);
  };
  return (
    <div className="rg-stress" ref={ref}>
      {quiet ? (
        <p className="rg-stress__quiet">History figures hidden in quiet mode</p>
      ) : (
        <>
          <div className="rg-stress__reading lm-mono" aria-live="polite">
            <span>
              {active ? `${selected === null ? 'Latest' : 'Reading'} · ${time(active.t)}` : 'No readings'}
            </span>
            <span>{active ? `${Math.round(active.v)} · ${band(active.v)}` : '—'}</span>
          </div>
          <div
            className="rg-stress__plot"
            role="img"
            aria-label={`${label}: ${readings.length} readings${active ? `; ${selected === null ? 'latest' : 'selected'} ${Math.round(active.v)} ring index, ${band(active.v)}, ${time(active.t)}` : ''}. ${minutesText(covered)} estimated coverage; ${minutesText(unknown)} uncovered time. Left and right arrows explore readings.`}
            tabIndex={readings.length ? 0 : undefined}
            onKeyDown={step}
            onPointerDown={(e) => {
              if (!readings.length) return;
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
              select(
                readings.reduce(
                  (best, p, i) => (Math.abs(x(p.t) - px) < Math.abs(x(readings[best]!.t) - px) ? i : best),
                  0,
                ),
              );
            }}
          >
            <svg width={width} height={180} aria-hidden="true">
              {[
                { word: 'High', v: 88 },
                { word: 'Elevated', v: 63 },
                { word: 'Normal', v: 38 },
                { word: 'Calm', v: 13 },
              ].map((b) => (
                <text key={b.word} x="0" y={y(b.v)} dominantBaseline="middle" className="rg-stress__band">
                  {b.word}
                </text>
              ))}
              {[0, 26, 51, 76, 100].map((v) => (
                <line key={v} className="rg-stress__grid" x1={left} x2={right} y1={y(v)} y2={y(v)} />
              ))}
              {now != null && end < to ? (
                <rect
                  className="rg-stress__future"
                  x={x(end)}
                  y={top}
                  width={Math.max(0, right - x(end))}
                  height={bottom - top}
                />
              ) : null}
              {readings.map((p, i) => (
                <circle key={`${p.t}-${i}`} className="rg-stress__dot" cx={x(p.t)} cy={y(p.v)} r={2.5}>
                  <title>
                    {time(p.t)} · {p.v} · {band(p.v)}
                  </title>
                </circle>
              ))}
              {active ? (
                <circle className="rg-stress__selected" cx={x(active.t)} cy={y(active.v)} r="4.5" />
              ) : null}
              <line className="rg-stress__coverage-track" x1={left} x2={x(end)} y1="144" y2="144" />
              {segments.map((s, i) => (
                <line key={i} className="rg-stress__coverage" x1={x(s.from)} x2={x(s.to)} y1="144" y2="144" />
              ))}
              {[0, 6, 12, 18, 24].map((h) => (
                <text
                  key={h}
                  className="rg-stress__tick lm-mono"
                  x={x(from + (h / 24) * (to - from))}
                  y="170"
                  textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
                >
                  {String(h).padStart(2, '0')}
                </text>
              ))}
            </svg>
          </div>
          <dl className="rg-stress__coverage-facts lm-mono">
            <div>
              <dt>
                <i />
                Estimated coverage
              </dt>
              <dd>{minutesText(covered)}</dd>
            </div>
            <div>
              <dt>
                <i data-unknown />
                Uncovered time
              </dt>
              <dd>{minutesText(unknown)}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
