/**
 * "updating scores…" (design/screens/scores.md §9, §11 "Rescoring"): a quiet status chip while a biometrics rescore job
 * runs in the background (`bioActivity.rescoring`, set by the `bio.rescore` job and by imports and ring syncs as they
 * score what they brought in). Tiles keep their old values until the new ones are written. Renders nothing otherwise.
 */
import { useSyncExternalStore } from 'react';
import { Chip } from '@/components';
import { bioActivity, type BioActivity } from '@/biometrics/app/activity';

const subscribe = (l: () => void) => bioActivity.subscribe(l);
const snapshot = (): BioActivity['rescoring'] => bioActivity.get().rescoring;

/** "updating scores to v1.3…" when one version is being written, else "updating scores…". */
export function rescoringText(r: NonNullable<BioActivity['rescoring']>): string {
  return r.versions.length === 1 ? `updating scores to ${r.versions[0]}…` : 'updating scores…';
}

export function useRescoring(): BioActivity['rescoring'] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function ScoresChip({ className }: { className?: string }) {
  const r = useRescoring();
  return (
    <span role="status" aria-live="polite" className={className}>
      {r ? <Chip>{rescoringText(r)}</Chip> : null}
    </span>
  );
}
