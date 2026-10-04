import type { EvidenceGrade } from '../types';
import { supplementRecord } from './dose';

/** Best certainty among the outcomes that showed an effect (the row's evidence badge); null when none did. */
export function supplementGrade(supplementId: string | null | undefined): EvidenceGrade | null {
  const r = supplementRecord(supplementId);
  if (!r) return null;
  const shown = r.outcomes.filter((o) => o.direction === 'effect').map((o) => o.certainty).sort();
  return (shown[0] as EvidenceGrade | undefined) ?? null;
}
