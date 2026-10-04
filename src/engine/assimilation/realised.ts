/**
 * The realised schedule (docs/SUITE_SPEC.md §3.4-3.5): the plan version's engine `Schedule` with the days that already
 * happened replaced by what was done (`LoggedDay.inputs`, built by the living plan), so the replay simulates the logged
 * past and the prescribed (or expected-credit) future. Pure.
 *
 * Each replaced day becomes its own program (identical templates share one), so overrides never merge with the
 * prescription's fields by accident. Fast events: the base schedule's events that START before `eventsReplacedBefore`
 * are dropped and the logged fasts (`events`) are added; later prescribed fasts stay.
 */
import type { DayTemplate, FastEvent, Schedule } from '../types/schedule';

export interface RealisedDay {
  /** Plan-day index. */
  day: number;
  /** What the engine should simulate for that day (logged, device-measured or expected-credit inputs). */
  template: DayTemplate;
}

export interface RealisedScheduleInput {
  base: Schedule;
  days: readonly RealisedDay[];
  /** Logged/expected fasts of the replaced period (plan-day indices). */
  events?: readonly FastEvent[];
  /** Base events starting before this day are replaced by `events` (default: one past the last replaced day). */
  eventsReplacedBefore?: number;
  /** Extend (or cut) the horizon; extra days repeat the base's last week pattern. Default: base horizon. */
  horizonDays?: number;
}

/** Stable JSON (sorted keys) for de-duplicating identical templates. */
function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined && k !== 'id' && k !== 'label')
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`)
    .join(',')}}`;
}

export function buildRealisedSchedule(i: RealisedScheduleInput): Schedule {
  const base = i.base;
  const H = Math.max(1, Math.floor(i.horizonDays ?? base.horizonDays));
  const programs: DayTemplate[] = base.programs.map((p) => p);
  const keyToIndex = new Map<string, number>();
  const days = Array.from({ length: H }, (_, d) => {
    if (d < base.days.length) return { ...base.days[d]! };
    // beyond the base horizon: repeat the last week of the base (habitual-like continuation)
    const src = base.days[Math.max(0, base.days.length - 7 + ((d - base.days.length) % 7))] ?? base.days[base.days.length - 1]!;
    return { program: src.program };
  });
  let lastReplaced = -1;
  for (const rd of [...i.days].sort((a, b) => a.day - b.day)) {
    if (rd.day < 0 || rd.day >= H) continue;
    const key = stableKey(rd.template);
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = programs.length;
      programs.push({ ...rd.template, id: `realised-${idx}`, label: rd.template.label || 'as logged' });
      keyToIndex.set(key, idx);
    }
    days[rd.day] = { program: idx };
    if (rd.day > lastReplaced) lastReplaced = rd.day;
  }
  const cut = i.eventsReplacedBefore ?? lastReplaced + 1;
  const events: FastEvent[] = [];
  for (const e of base.events ?? []) if (e.kind === 'fast' && e.startDay >= cut && e.startDay < H) events.push(e);
  for (const e of i.events ?? []) if (e.startDay < H) events.push(e);
  events.sort((a, b) => a.startDay - b.startDay || a.startH - b.startH);
  const blocks = base.blocks?.filter((b) => b.startDay < H).map((b) => ({ ...b, endDay: Math.min(b.endDay, H) }));
  return {
    ...base,
    horizonDays: H,
    programs,
    days,
    ...(blocks ? { blocks } : {}),
    events,
  };
}
