import { useReveal } from '@/components/lib/reveal';
import type { EvidenceGrade, Mechanism } from '@/content/evidence/schema';
import { GRADE_ORDER } from '../data/filters';

export type GradeCounts = Record<EvidenceGrade, number>;

export function countGrades(mechanisms: readonly Pick<Mechanism, 'grade'>[]): GradeCounts {
  const counts: GradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const mechanism of mechanisms) counts[mechanism.grade] += 1;
  return counts;
}

/** Achromatic, labelled distribution: the same solid, outline and dash as the grade badges. */
export function GradeShare({ counts, animate = true }: { counts: GradeCounts; animate?: boolean }) {
  const [ref, pending] = useReveal<HTMLSpanElement>({ animate });
  const total = GRADE_ORDER.reduce((n, grade) => n + counts[grade], 0);
  if (!total) return null;
  const label = `${total} mechanisms: ${GRADE_ORDER.map((grade) => `${counts[grade]} grade ${grade}`).join(', ')}`;
  return (
    <span
      ref={ref}
      className="ev-grade-share"
      role="img"
      aria-label={label}
      data-reveal={pending ? 'pending' : undefined}
    >
      {GRADE_ORDER.filter((grade) => counts[grade] > 0).map((grade) => (
        <span key={grade} data-grade={grade} style={{ flexGrow: counts[grade] }} aria-hidden="true" />
      ))}
    </span>
  );
}
