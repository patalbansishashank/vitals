/**
 * The biometrics store of the app (I1-B): E10's `BioStore` port over the document store and the app blob store
 * (`DocBioStore`, src/biometrics/store/docStore.ts), with the two write routes E4 allows (docs/COMMANDS.md §1):
 *
 * - `commandWriter(ctx.docs)` — inside a command: the ops join the command's ChangeSet (undo, ledger, change log).
 *   Used by `bio.manual`, `bio.setPolicy`.
 * - `deriveWriter()` — jobs (file imports, Bluetooth reads, rescoring) and the bulk part of `bio.deleteSource`: each
 *   batch commits in one transaction under a `derive` write token (E4: job writes run in a derive scope; the person's
 *   dispatch of the command that started the job is the authorisation). These writes are not in the change log.
 *
 * Loaded lazily by the executors (never at the top of `./index.ts`).
 */
import { mintWriteToken, revokeWriteToken, type BlobStore, type DocumentStore, type Tx } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { getBlobStore } from '@/state/blobStore';
import { DocBioStore, type BioDocOp, type BioDocWriter } from '@/biometrics/store/docStore';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';

/** Apply one op to a transaction. */
export async function applyBioOp(tx: Tx, op: BioDocOp): Promise<void> {
  switch (op.kind) {
    case 'put':
      await tx.put(op.col, { ...op.body, _id: op.id });
      return;
    case 'append':
      await tx.append(op.col, { ...op.body, _id: op.id });
      return;
    case 'patch':
      await tx.patch(op.col, op.id, op.patch);
      return;
    case 'remove':
      await tx.remove(op.col, op.id);
      return;
  }
}

/** Ops join the command's buffered transaction (committed with its ChangeSet after the executor returns). */
export function commandWriter(docs: Tx): BioDocWriter {
  return {
    durable: false,
    async write(ops) {
      for (const op of ops) await applyBioOp(docs, op);
    },
  };
}

/** Each flush commits one `derive` transaction on `store` (default: the app's document store). */
export function deriveWriter(store?: DocumentStore, label = 'biometrics'): BioDocWriter {
  return {
    durable: true,
    async write(ops) {
      if (ops.length === 0) return;
      const target = store ?? getDocumentStore();
      const token = mintWriteToken('derive', { label });
      try {
        await target.transact(token, async (tx) => {
          for (const op of ops) await applyBioOp(tx, op);
        });
      } finally {
        revokeWriteToken(token);
      }
    },
  };
}

/** A writer for read-only use (read commands): any write is a bug. */
export const readOnlyWriter: BioDocWriter = {
  durable: true,
  write: () => Promise.reject(new Error('biometrics: read-only store')),
};

/** The shared index of the app's (or a given) document store, once it holds the documents. */
export async function bioIndex(store?: DocumentStore): Promise<BioDocIndex> {
  const ix = sharedBioIndex(store ?? getDocumentStore());
  await ix.ready;
  return ix;
}

export interface OpenOptions {
  writer?: BioDocWriter;
  store?: DocumentStore;
  blobs?: BlobStore;
  batchSize?: number;
}

/** A `DocBioStore` session (call `flush()` when done writing). */
export async function openBioStore(o: OpenOptions = {}): Promise<DocBioStore> {
  const index = await bioIndex(o.store);
  const blobs = o.blobs ?? (await getBlobStore());
  return new DocBioStore({ index, blobs, writer: o.writer ?? readOnlyWriter, ...(o.batchSize ? { batchSize: o.batchSize } : {}) });
}
