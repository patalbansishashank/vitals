// @vitest-environment node
/**
 * A person's program opens on an empty replica before the sync group's documents arrive. It must not write the app's
 * in-memory defaults as documents: with per-field sync their newer clocks would replace the person's real profile,
 * safety answers and settings on every device (found by the I3 smoke: the browser fell back to the welcome screen).
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { newOwnerSecret } from '@/sync/pairing';
import { COLLECTIONS } from '@/store';
import { openPersonProgram } from './personProgram.ts';

it('a fresh person program writes no documents at open', async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, 'probe-'));
  const p = await openPersonProgram({ personId: '0123456789abcdef', dir, timeZone: 'Asia/Kolkata', deviceId: 'srvdevice0000001', relayUrl: null, instance: 'probe' }, newOwnerSecret());
  await new Promise((r) => setTimeout(r, 3000));
  const { getDocumentStore } = await import('@/state/runtime');
  const out: Record<string, string[]> = {};
  for (const c of Object.values(COLLECTIONS) as Array<{ col: string; sync?: string }>) {
    const rows = await getDocumentStore().list(c.col as never).catch(() => []);
    if (rows.length) out[`${c.col}${c.sync ? `(${c.sync})` : ''}`] = rows.length ? [String(rows.length)] : [];
  }
  expect(out).toEqual({});
  await p.close();
}, 60000);
