/**
 * `copyStore(from, to)`: the one-time switch-over between engines (SUITE_SPEC §2.1: IndexedDB reference store →
 * Evolu after the spike). Copies every document of every collection in hydration order, keeps soft deletes, and writes
 * a marker into both stores (`syncState/copy`) so it never runs twice. Runs with a `migration` token.
 */
import { orderedCollections } from './collections';
import { bodyOf } from './documentStore';
import { mintWriteToken, revokeWriteToken } from './tokens';
import type { DocumentStore, Instant } from './types';

const MARKER = 'copy';

export interface CopyReport {
  copied: number;
  skipped: boolean;
  at: Instant;
}

export async function copyStore(from: DocumentStore, to: DocumentStore, now: Instant = new Date().toISOString()): Promise<CopyReport> {
  await Promise.all([from.ready, to.ready]);
  const marker = await to.get<{ from: string; at: Instant }>('syncState', MARKER);
  if (marker && marker.from === from.engine) return { copied: 0, skipped: true, at: marker.at };
  const token = mintWriteToken('migration', { label: 'copyStore' });
  let copied = 0;
  try {
    for (const def of orderedCollections()) {
      if (def.col === 'syncState') continue;
      const docs: Array<Record<string, unknown>> = [];
      for await (const d of from.dump([def.col])) docs.push(d as unknown as Record<string, unknown>);
      if (docs.length === 0) continue;
      const tombstones: string[] = [];
      await to.transact(token, async (tx) => {
        for (const d of docs) {
          const id = d._id as string;
          if (def.strategy === 'append' || def.strategy === 'immutable') {
            if (!d._deleted && !(await tx.get(def.col, id))) await tx.append(def.col, { ...bodyOf(d), _id: id });
          } else {
            await tx.put(def.col, { ...bodyOf(d), _id: id });
            // keep the tombstone (restorable soft delete): written, then deleted in a second step
            if (d._deleted) tombstones.push(id);
          }
          copied++;
        }
      });
      if (tombstones.length)
        await to.transact(token, async (tx) => {
          for (const id of tombstones) await tx.remove(def.col, id);
        });
    }
    await to.transact(token, async (tx) => {
      await tx.put('syncState', { _id: MARKER, from: from.engine, at: now, copied });
    });
    await from.transact(token, async (tx) => {
      await tx.put('syncState', { _id: MARKER, to: to.engine, at: now, copied });
    });
  } finally {
    revokeWriteToken(token);
  }
  return { copied, skipped: false, at: now };
}
