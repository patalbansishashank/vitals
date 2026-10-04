/**
 * Saving supplement rows from a screen (Food tab, Settings): every change goes through `supplements.set` /
 * `supplements.remove` with the whole row. Saves run one at a time and each waits for its change to commit: the
 * command reads the section before it writes, so two quick edits (a time key, then the next row's state) must not read
 * the same old section (the second would drop the first). Errors show as a toast in plain words.
 */
import { dispatch, settleCommits } from '@/commands';
import { toast } from '@/components';
import type { SupplementRow, SupplementStance } from '@/catalogues/supplements';

const ref = (r: SupplementRow) => (r.supplementId ? { supplementId: r.supplementId } : { text: r.text ?? '' });

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.then(settleCommits, settleCommits);
  return next;
}

export function saveSupplementRow(row: SupplementRow, stance?: SupplementStance): Promise<boolean> {
  return serial(() => setRow(row, stance));
}

async function setRow(row: SupplementRow, stance?: SupplementStance): Promise<boolean> {
  const r = await dispatch('supplements.set', {
    ...ref(row),
    state: row.state,
    ...(row.dose !== undefined && row.state === 'taking' ? { dose: row.dose } : {}),
    ...(row.unit ? { unit: row.unit } : {}),
    timesOfDay: row.timesOfDay,
    ...(stance ? { stance } : {}),
  });
  if (!r.ok) toast(r.error.message);
  return r.ok;
}

export function removeSupplementRow(row: SupplementRow): Promise<boolean> {
  return serial(async () => {
    const r = await dispatch('supplements.remove', ref(row));
    if (!r.ok) toast(r.error.message);
    return r.ok;
  });
}
