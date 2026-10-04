/**
 * The chapter scale (design v3 §3.4): one segment per chapter; fill = answered share, hatch = asked-later share; the
 * current segment carries a notch per question (≤ 14 questions), so progress reads per question. Below 768 px it sits
 * on its own centred row under the title with one label ("a normal day · 4 of 11"); from 768 px it is right-aligned on
 * the title row with a label under every segment.
 */
import { BAR, CHAPTER_NAME, CHAPTER_SHORT } from '../copy';
import type { ChapterId } from '../types';

export interface ChapterProgressProps {
  chapters: readonly ChapterId[];
  current: ChapterId | null;
  /** Share of each chapter answered (0–1). */
  fill: Readonly<Partial<Record<ChapterId, number>>>;
  /** Share of each chapter asked later (0–1, drawn hatched after the fill). */
  later?: Readonly<Partial<Record<ChapterId, number>>>;
  /** Position in the current chapter ("4 of 11"). */
  position: number;
  total: number;
  /** Optional chapters: the empty track is dashed. */
  optional?: readonly ChapterId[];
}

const clamp = (x: number | undefined) => Math.min(1, Math.max(0, x ?? 0));

export function ChapterProgress({ chapters, current, fill, later = {}, position, total, optional = ['markers'] }: ChapterProgressProps) {
  const overall = chapters.reduce((a, c) => a + clamp((fill[c] ?? 0) + (later[c] ?? 0)), 0) / Math.max(1, chapters.length);
  const done = chapters.filter((c) => clamp((fill[c] ?? 0) + (later[c] ?? 0)) >= 1).length;
  const notches = current && total > 1 && total <= 14 ? Array.from({ length: total - 1 }, (_, i) => (i + 1) / total) : [];
  return (
    <div
      className="lm-ik-progress"
      role="progressbar"
      aria-label={BAR.progressLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(overall * 100)}
      aria-valuetext={current ? BAR.progressFull(CHAPTER_NAME[current], position, total, done, chapters.length) : `${Math.round(overall * 100)} %`}
    >
      <span className="lm-ik-progress__segs">
        {chapters.map((c) => {
          const f = clamp(fill[c]);
          const l = Math.min(clamp(later[c]), 1 - f);
          return (
            <span key={c} className="lm-ik-progress__seg" data-current={c === current || undefined} data-optional={optional.includes(c) || undefined}>
              <span className="lm-ik-progress__bar" aria-hidden="true">
                <span className="lm-ik-progress__fill" style={{ width: `${Math.round(f * 100)}%` }} />
                {l > 0 ? <span className="lm-ik-progress__later" style={{ left: `${Math.round(f * 100)}%`, width: `${Math.round(l * 100)}%` }} /> : null}
                {c === current ? notches.map((n) => <span key={n} className="lm-ik-progress__notch" style={{ left: `${(n * 100).toFixed(2)}%` }} />) : null}
              </span>
              <span className="lm-ik-progress__label" aria-hidden="true">
                {c === current ? <span className="lm-ik-progress__dot" /> : null}
                {CHAPTER_SHORT[c]}
              </span>
            </span>
          );
        })}
      </span>
      {current ? (
        <span className="lm-ik-progress__one" aria-hidden="true">
          <span className="lm-ik-progress__dot" />
          {`${CHAPTER_SHORT[current]} · ${BAR.count(position, total)}`}
        </span>
      ) : null}
    </div>
  );
}
