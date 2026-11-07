/**
 * "What the Coach knows" — the standing briefing, made visible (living-mode.md, Coach: what the Coach knows). Built in
 * plain language from the same Living data the Coach receives each turn: the person can always see what it knows and
 * where it is sent. Pure; the numbers are rendered as the source gives them, never derived here.
 *
 * With a provider connected, `about` / `ask` come from the Coach's `buildBriefing` (src/ai/coach/briefing.ts: the
 * profile card and the intake's open questions); these defaults serve the no-provider adapter.
 */
import { addDays } from '@/living/dates';
import type { TodayView } from '@/living';
import { formatNumber } from '@/components/lib/format';
import { currentDay, type LivingClock } from '../clock';
import type { LivingDataSource } from '../data/source';
import type { HistoryDay } from '../data/types';
import { fmtClock, fmtDateRange, fmtDay, fmtLikely, quietWord } from '../format';
import { planTrack, type PlanTrack } from '../model/planTrack';
import { BRIEFING_COPY as B } from './copy';

export interface BriefingSection {
  id: 'always' | 'about' | 'plan' | 'week' | 'ask' | 'sentTo';
  title: string;
  lines: string[];
  viz?:
    | { kind: 'plan'; track: PlanTrack }
    | { kind: 'week'; dates: string[]; values: Array<number | null>; quiet: boolean };
  /** A setting the person can change from here ("Change what it can see"). */
  link?: { label: string; to: string };
}

export interface BriefingModel {
  sections: BriefingSection[];
}

export interface BriefingInput {
  today: TodayView | null;
  /** Days before today in the last 7, newest first (today itself comes from `today`). */
  week?: ReadonlyArray<
    Pick<HistoryDay, 'date'> & { score: { score: number | null } | null; entries: readonly unknown[] }
  >;
  /** Proposals waiting for the person. */
  waiting?: number;
  provider?: { name: string; model: string } | null;
  /** Profile lines (age band, height, safety mode, food rules, equipment). */
  about?: string[];
  /** Deferred intake questions. */
  ask?: string[];
}

function todayParts(v: TodayView): string | null {
  const rx = v.prescription;
  if (!rx) return null;
  const parts: string[] = [];
  if (rx.window) parts.push(B.window(fmtClock(rx.window.startH), fmtClock(rx.window.endH)));
  if (rx.meals.length) parts.push(B.meals(rx.meals.length));
  for (const s of rx.sessions)
    parts.push(s.kind === 'resistance' ? B.strength(fmtClock(s.startH)) : B.cardio(fmtClock(s.startH)));
  if (rx.fast) parts.push(B.fast(Math.round(rx.fast.hours)));
  return parts.length ? parts.join(' · ') : null;
}

export function buildCoachBriefing(input: BriefingInput): BriefingModel {
  const v = input.today;
  const quiet = !!v?.quietMode;

  const about: string[] = [];
  if (v?.trendWeight) {
    about.push(
      quiet
        ? B.trendWeightQuiet
        : B.trendWeight(formatNumber(v.trendWeight.kg, 1), fmtLikely(v.trendWeight.kg, v.trendWeight.sd, 1)),
    );
  } else if (v) about.push(B.noTrend);
  const sups = v?.prescription?.supplements ?? [];
  if (sups.length)
    about.push(
      B.supplements(
        sups
          .map((s) => `${s.supplementId.replace(/_/g, ' ')} ${formatNumber(s.dose, 0)} ${s.unit}`)
          .join(', '),
      ),
    );
  about.push(...(input.about ?? [B.setupAnswers]));

  const plan: string[] = [];
  if (v?.plan) {
    plan.push(B.planLine(v.plan.name, v.plan.day, v.plan.of));
    const t = todayParts(v);
    if (t) plan.push(B.todayLine(t));
    const goal = v.drift?.[0];
    if (goal?.goalDate.range)
      plan.push(B.goalDate(fmtDateRange(goal.goalDate.range[0], goal.goalDate.range[1])));
    if (goal) plan.push(B.drift3[goal.state]);
    const a7 = v.adherence.a7;
    if (quiet || a7 === null) plan.push(B.adherenceQuiet(quietWord(a7)));
    else plan.push(B.adherence(formatNumber(Math.round(a7), 0)));
    if (input.waiting) plan.push(B.proposals(input.waiting));
  } else plan.push(B.noPlan);

  // "Last 7 days" counts today too: what was logged today is something the Coach knows
  const days = [...(input.week ?? [])].filter((d) => !v || d.date !== v.date);
  if (v && (v.logged.entries.length || v.adherence.today))
    days.unshift({ date: v.date, score: v.adherence.today, entries: v.logged.entries });
  // one fact per day: how much was logged (the day's score is in the plan's 7-day adherence above)
  const week = days.map((d) =>
    d.entries.length ? B.weekLine(fmtDay(d.date), d.entries.length) : `${fmtDay(d.date)} · ${B.notLogged}`,
  );

  return {
    sections: [
      { id: 'always', title: B.always, lines: [...B.alwaysLines] },
      { id: 'about', title: B.about, lines: about },
      {
        id: 'plan',
        title: B.plan,
        lines: plan,
        ...(v?.plan ? { viz: { kind: 'plan' as const, track: planTrack(v.plan.day, v.plan.of) } } : {}),
      },
      {
        id: 'week',
        title: B.week,
        lines: week.length ? week : [B.weekEmpty],
        ...(v
          ? {
              viz: {
                kind: 'week' as const,
                dates: Array.from({ length: 7 }, (_, i) => addDays(v.date, i - 6)),
                values: Array.from({ length: 7 }, (_, i) => {
                  const date = addDays(v.date, i - 6);
                  return date === v.date
                    ? v.logged.entries.length || null
                    : (days.find((d) => d.date === date)?.entries.length ?? null);
                }),
                quiet,
              },
            }
          : {}),
      },
      { id: 'ask', title: B.ask, lines: input.ask?.length ? input.ask : [B.askNone] },
      {
        id: 'sentTo',
        title: B.sentTo,
        lines: [input.provider ? B.sentLine(input.provider.name, input.provider.model) : B.sentNone],
      },
    ],
  };
}

/** The briefing from the Living source at the clock's current day (null source/clock = no plan, nothing known). */
export function briefingFromLiving(
  source: LivingDataSource | null,
  clock: LivingClock | null,
  extra: Omit<BriefingInput, 'today' | 'week' | 'waiting'> = {},
): BriefingModel {
  if (!source || !clock) return buildCoachBriefing({ today: null, ...extra });
  const t = currentDay(clock);
  const today = source.today(t);
  const week = today ? source.history(addDays(t, -6), addDays(t, -1)) : [];
  const waiting = today
    ? source.changes('today').filter((c) => c.state === 'pending' || c.state === 'stale').length
    : 0;
  return buildCoachBriefing({ today, week, waiting, ...extra });
}
