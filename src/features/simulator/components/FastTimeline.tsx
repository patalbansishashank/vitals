/**
 * Multi-day fast timeline (simulator-schedule.md §6): a 72 px strip spanning the fast with day boundaries, sleep bands
 * and the break-fast meal marker — shown in the day editor instead of the clock for days inside a fast over 24 h.
 */
import type { CompiledSchedule } from '@/engine';
import { addDaysISO, formatClock, formatDayShort } from '../lib/calendar';
import { formatFastHours, type FastSpan } from '../lib/fasts';

const W = 340;
const H = 72;

export function fastWhen(span: FastSpan, startDate: string): string {
  const a = `${formatDayShort(addDaysISO(startDate, Math.floor(span.startHour / 24))).split(' ')[0]} ${formatClock(span.startHour)}`;
  const b = `${formatDayShort(addDaysISO(startDate, Math.floor(span.endHour / 24))).split(' ')[0]} ${formatClock(span.endHour)}`;
  return `${a} → ${b}`;
}

export function FastTimeline({ span, compiled }: { span: FastSpan; compiled: CompiledSchedule }) {
  const x0 = span.startHour - 3;
  const x1 = span.endHour + 3;
  const X = (h: number) => 8 + ((h - x0) / (x1 - x0)) * (W - 16);
  const days: number[] = [];
  for (let d = Math.ceil(x0 / 24); d * 24 <= x1; d++) days.push(d);
  const sleeps: Array<[number, number]> = [];
  for (let d = Math.floor(x0 / 24) - 1; d <= Math.ceil(x1 / 24); d++) {
    const day = compiled.days[Math.max(0, Math.min(compiled.nDays - 1, d))];
    if (!day) continue;
    const a = d * 24 + day.sleepBedH;
    sleeps.push([a, a + day.sleepHours]);
  }
  const label = `fast ${formatFastHours(span.hours)} · ${fastWhen(span, compiled.startDate)}`;
  return (
    <figure className="sim-ftl">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Water-only fast, ${label}`}
      >
        <rect x={0} y={0} width={W} height={H} className="sim-ftl__bg" />
        {sleeps.map(([a, b], i) =>
          b > x0 && a < x1 ? (
            <rect
              key={i}
              x={X(Math.max(a, x0))}
              y={42}
              width={Math.max(0, X(Math.min(b, x1)) - X(Math.max(a, x0)))}
              height={10}
              className="sim-ftl__sleep"
            />
          ) : null,
        )}
        <rect
          x={X(span.startHour)}
          y={22}
          width={X(span.endHour) - X(span.startHour)}
          height={12}
          className="sim-ftl__fast"
        />
        <rect
          x={X(span.plannedStart)}
          y={34}
          width={Math.max(0, X(span.plannedEnd) - X(span.plannedStart))}
          height={3}
          className="sim-ftl__planned"
        />
        {days.map((d) => (
          <g key={d}>
            <line x1={X(d * 24)} x2={X(d * 24)} y1={14} y2={H - 4} className="sim-ftl__mid" />
            <text x={X(d * 24) + 3} y={11} className="sim-ftl__day">
              {formatDayShort(addDaysISO(compiled.startDate, d)).split(' ')[0]!.toLowerCase()}
            </text>
          </g>
        ))}
        <circle cx={X(span.endHour)} cy={28} r={5} className="sim-ftl__meal" />
        <text
          x={Math.min(W - 4, X(span.endHour) + 8)}
          y={66}
          textAnchor={X(span.endHour) > W - 90 ? 'end' : 'start'}
          className="sim-ftl__cap"
        >
          break-fast meal {formatClock(span.endHour)}
        </text>
      </svg>
      <figcaption className="sim-ftl__caption">{label}</figcaption>
    </figure>
  );
}
