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
import { fmtClock, fmtDateRange, fmtDay, fmtHours, fmtLikely, quietWord } from '../format';
import { BRIEFING_COPY as B } from './copy';

export interface BriefingSection {
  id: 'always' | 'about' | 'plan' | 'week' | 'signals' | 'ask' | 'sentTo';
  title: string;
  lines: string[];
  /** A setting the person can change from here ("Change what it can see"). */
  link?: { label: string; to: string };
}

export interface BriefingModel {
  sections: BriefingSection[];
}

export interface BriefingInput {
  today: TodayView | null;
  /** Days before today in the last 7, newest first (today itself comes from `today`). */
  week?: ReadonlyArray<Pick<HistoryDay, 'date'> & { score: { score: number | null } | null; entries: readonly unknown[] }>;
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
  for (const s of rx.sessions) parts.push(s.kind === 'resistance' ? B.strength(fmtClock(s.startH)) : B.cardio(fmtClock(s.startH)));
  if (rx.fast) parts.push(B.fast(Math.round(rx.fast.hours)));
  return parts.length ? parts.join(' · ') : null;
}

function scoreText(score: number | null, quiet: boolean): string {
  if (quiet) return quietWord(score);
  return score === null ? quietWord(null) : formatNumber(Math.round(score), 0);
}

export function buildCoachBriefing(input: BriefingInput): BriefingModel {
  const v = input.today;
  const quiet = !!v?.quietMode;

  const about: string[] = [];
  if (v?.trendWeight) {
    about.push(quiet ? B.trendWeightQuiet : B.trendWeight(formatNumber(v.trendWeight.kg, 1), fmtLikely(v.trendWeight.kg, v.trendWeight.sd, 1)));
  } else if (v) about.push(B.noTrend);
  const sups = v?.prescription?.supplements ?? [];
  if (sups.length) about.push(B.supplements(sups.map((s) => `${s.supplementId} ${formatNumber(s.dose, 0)} ${s.unit}`).join(', ')));
  about.push(...(input.about ?? [B.setupAnswers]));

  const plan: string[] = [];
  if (v?.plan) {
    plan.push(B.planLine(v.plan.name, v.plan.rung, v.plan.day, v.plan.of));
    const t = todayParts(v);
    if (t) plan.push(B.todayLine(t));
    const goal = v.drift?.[0];
    if (goal?.goalDate.range) plan.push(B.goalDate(fmtDateRange(goal.goalDate.range[0], goal.goalDate.range[1])));
    if (goal) plan.push(B.drift(B.drift3[goal.state]));
    if (quiet) plan.push(B.adherenceQuiet(quietWord(v.adherence.a7)));
    else plan.push(B.adherence(scoreText(v.adherence.a7, false), scoreText(v.adherence.a28, false)));
    if (input.waiting) plan.push(B.proposals(input.waiting));
  } else plan.push(B.noPlan);

  // "Last 7 days" counts today too: what was logged today is something the Coach knows
  const days = [...(input.week ?? [])].filter((d) => !v || d.date !== v.date);
  if (v && (v.logged.entries.length || v.adherence.today)) days.unshift({ date: v.date, score: v.adherence.today, entries: v.logged.entries });
  const week = days.map((d) => {
    const s = d.score?.score ?? null;
    const word = s === null ? (d.entries.length ? scoreText(null, quiet) : B.notLogged) : scoreText(s, quiet);
    return B.weekLine(fmtDay(d.date), word, d.entries.length);
  });

  const signals: string[] = [];
  const bio = v?.biometrics;
  if (bio?.lastNight) signals.push(B.sleep(fmtHours(bio.lastNight.hours)));
  if (bio?.restingHr) signals.push(B.restingHr);
  if (bio?.hrv) signals.push(B.hrv);

  return {
    sections: [
      { id: 'always', title: B.always, lines: [...B.alwaysLines] },
      { id: 'about', title: B.about, lines: about },
      { id: 'plan', title: B.plan, lines: plan },
      { id: 'week', title: B.week, lines: week.length ? week : [B.weekEmpty] },
      { id: 'signals', title: B.signals, lines: signals.length ? signals : [B.noSignals], link: { label: B.changeSignals, to: '/settings' } },
      { id: 'ask', title: B.ask, lines: input.ask?.length ? input.ask : [B.askNone] },
      { id: 'sentTo', title: B.sentTo, lines: [input.provider ? B.sentLine(input.provider.name, input.provider.model) : B.sentNone] },
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
  const waiting = today ? source.changes('today').filter((c) => c.state === 'pending' || c.state === 'stale').length : 0;
  return buildCoachBriefing({ today, week, waiting, ...extra });
}
