import { Tooltip } from './Tooltip';

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/** Plain-language meaning of each grade; used for aria-label and the tooltip. */
export const GRADE_TEXT: Record<EvidenceGrade, string> = {
  A: 'Evidence grade A: strong — consistent human trials or metabolic-ward studies.',
  B: 'Evidence grade B: a few human trials or consistent human mechanistic data.',
  C: 'Evidence grade C: limited human data. Read the shape, not the exact number.',
  D: 'Evidence grade D: based on animal and cell studies. Shown for exploration.',
};

const PIPS: Record<EvidenceGrade, number> = { A: 4, B: 3, C: 2, D: 1 };

export interface GradeBadgeProps {
  grade: EvidenceGrade;
  /** `md` 20 px (default) · `sm` 18 px (lanes, metric rows). */
  size?: 'md' | 'sm';
  /** Makes the badge a button (opens Explain / the mechanism). */
  onClick?: () => void;
  /** Show the meaning in a tooltip (default true). */
  tooltip?: boolean;
  className?: string;
}

/**
 * Evidence grade A–D: letter + four pips. Achromatic on purpose — A solid ink,
 * B grey, C outlined, D dashed — so a grade never reads as severity or a series.
 */
export function GradeBadge({ grade, size = 'md', onClick, tooltip = true, className }: GradeBadgeProps) {
  const n = PIPS[grade];
  const inner = (
    <>
      <span aria-hidden="true">{grade}</span>
      <span className="lm-grade__pips" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <i key={k} data-on={k < n} />
        ))}
      </span>
    </>
  );
  const el = onClick ? (
    <button type="button" className={['lm-grade', className].filter(Boolean).join(' ')} data-grade={grade} data-size={size} aria-label={GRADE_TEXT[grade]} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className={['lm-grade', className].filter(Boolean).join(' ')} data-grade={grade} data-size={size} role="img" aria-label={GRADE_TEXT[grade]}>
      {inner}
    </span>
  );
  return tooltip ? (
    <Tooltip content={GRADE_TEXT[grade]} role="label">
      {el}
    </Tooltip>
  ) : (
    el
  );
}

/** Alias used in the task brief. */
export const EvidenceBadge = GradeBadge;
