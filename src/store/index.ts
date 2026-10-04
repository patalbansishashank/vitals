/**
 * Local-first document store (SUITE_SPEC §2). Tier H.
 *
 *   const store = createDocumentStore({ backend: createIdbBackend() });   // or createMemoryBackend(), or E11's SyncStore
 *   await store.ready;
 *   await store.transact(token, async (tx) => tx.patch('settings', 'me', { units: 'imperial' }));
 *   store.watch('scenarios', {}, (docs) => …);
 */
export * from './types';
export type { BackendChange, BackendDoc, BackendOp, PersistenceBackend } from './backend';
export { COLLECTIONS, collectionDef, exportedCollections, orderedCollections, validateDoc, type CollectionDef } from './collections';
export { bodyOf, createDocumentStore, type DocumentStoreOptions } from './documentStore';
export { createIdbBackend, isIndexedDbAvailable, IDB_DATABASE, type IdbBackendOptions } from './idbBackend';
export { createMemoryBackend, type MemoryBackend } from './memoryBackend';
export { copyStore, type CopyReport } from './copy';
export { createHlc, newDeviceId, ulid } from './ids';
export { applyFieldPatch, applyMergePatch, deepEqual, diffMergePatch, fieldOf, fieldPatch, isPlainObject, jsonClone } from './json';
export { defaultStrictMode, isValidWriteToken, mintWriteToken, revokeWriteToken, type StrictMode } from './tokens';
