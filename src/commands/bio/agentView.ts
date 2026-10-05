/**
 * What an agent reads of a result built before the reader was known (a job's, the change list): every ring key in it as
 * its alias over the current store's ring sources (L-REV2 R3-10). `job.result`, `history.list` and the agent
 * dispatcher's wait for a job use it; the bio reads alias their own outputs.
 */
import { aliasRingKeys } from '@/biometrics/service/identity';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { getDocumentStore } from '@/state/runtime';

/** `v` with its ring keys as aliases; waits for the biometrics index only when `v` holds one. */
export async function ringKeysForAgent<T>(v: T): Promise<T> {
  if (!JSON.stringify(v ?? null).includes('ble:')) return v;
  const ix = sharedBioIndex(getDocumentStore());
  await ix.ready;
  return aliasRingKeys(v, ix.sources());
}
