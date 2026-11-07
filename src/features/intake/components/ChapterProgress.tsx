/**
 * The chapter scale, the step's one progress indicator in the header's progress row: one segment per chapter, the same
 * segments as the welcome steps (`FlowSteps`). The chapter you are on is gold, a finished chapter (every question
 * answered or asked later) is filled, and the rest are the bare track — whole states, no partial fill, no count, no
 * names. The summary has no current chapter: it shows the finished ones filled. Its accessible value carries the
 * chapter and "question n of N".
 */
import { FlowSteps, type FlowStepState } from '@/features/onboarding/FlowSteps';
import { BAR, CHAPTER_NAME } from '../copy';
import type { ChapterId } from '../types';

export interface ChapterProgressProps {
  chapters: readonly ChapterId[];
  /** The chapter on screen; null on the summary. */
  current: ChapterId | null;
  /** Share of each chapter answered (0–1). */
  fill: Readonly<Partial<Record<ChapterId, number>>>;
  /** Share of each chapter asked later (0–1); it counts as finished like an answer. */
  later?: Readonly<Partial<Record<ChapterId, number>>>;
  /** Position in the current chapter (read out only: "question 4 of 11"). */
  position: number;
  total: number;
}

const clamp = (x: number | undefined) => Math.min(1, Math.max(0, x ?? 0));
/** Shares are sums of fractions: allow for rounding when asking "is every question done?". */
const FINISHED = 1 - 1e-9;

export function ChapterProgress({ chapters, current, fill, later = {}, position, total }: ChapterProgressProps) {
  const share = (c: ChapterId) => clamp((fill[c] ?? 0) + (later[c] ?? 0));
  const overall = chapters.reduce((a, c) => a + share(c), 0) / Math.max(1, chapters.length);
  const done = chapters.filter((c) => share(c) >= FINISHED).length;
  const stateOf = (c: ChapterId): FlowStepState => (c === current ? 'current' : share(c) >= FINISHED ? 'done' : 'todo');
  return (
    <div
      className="lm-ik-progress"
      role="progressbar"
      aria-label={BAR.progressLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(overall * 100)}
      aria-valuetext={current ? BAR.progressFull(CHAPTER_NAME[current], position, total, done, chapters.length) : BAR.progressSummary(done, chapters.length)}
    >
      <FlowSteps steps={chapters.map((c) => ({ id: c, state: stateOf(c) }))} />
    </div>
  );
}
