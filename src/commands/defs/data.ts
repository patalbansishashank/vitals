/**
 * `data.*` (SUITE_SPEC §1.9, §2.8): storage usage, export (v2 file with documents), import (v1 and v2, replace or
 * merge) and erase. Export, import and erase are UI-only; import and erase are destructive (confirmation token).
 */
import { exportAll, exportFileName, eraseAll, importAll, parseImport, serializeExport, storageUsage } from '@/state/persistence';
import { getDocumentStore } from '@/state/runtime';
import { settleCommits } from '../history';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, DEVICE, UI_ONLY, UNDO } from './_shared';

export const dataUsage = defineCommand({
  id: 'data.usage',
  version: 1,
  title: 'Storage used',
  description: 'How much this device stores: documents and bytes per collection, and the size of the boot cache.',
  input: T.Object({}),
  output: T.Object({
    engine: T.String(),
    collections: T.Record(T.Object({ docs: T.Integer(), bytes: T.Integer() })),
    bootCacheBytes: T.Integer(),
    totalBytes: T.Integer(),
  }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'Settings › Your data reads the storage meter directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async () => {
    const store = getDocumentStore();
    const collections = (await store.estimate()) as Record<string, { docs: number; bytes: number }>;
    const boot = storageUsage().bytes;
    const total = Object.values(collections).reduce((n, c) => n + c.bytes, 0) + boot;
    return { engine: store.engine, collections, bootCacheBytes: boot, totalBytes: total };
  },
});

export const dataExport = defineCommand({
  id: 'data.export',
  version: 1,
  title: 'Export your data',
  description: 'Everything Vitals keeps on this device as one JSON file (format 2: documents per collection plus the v1 section), never keys, secrets or caches.',
  input: T.Object({}),
  output: T.Object({ fileName: T.String(), bytes: T.Integer(), text: T.String() }),
  perm: 'read',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(DEVICE),
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['file'],
  execute: async (ctx) => {
    await settleCommits();
    const now = new Date(ctx.now);
    const text = serializeExport(exportAll(now));
    return { fileName: exportFileName(now), bytes: new TextEncoder().encode(text).length, text };
  },
});

export const dataImport = defineCommand({
  id: 'data.import',
  version: 1,
  title: 'Import a data file',
  description: 'Import a Vitals export (format 1 or 2). replace: the file replaces this device’s data; merge: keeps this device’s data and adds what is new (scenarios are kept side by side, safety answers and settings stay as they are).',
  input: T.Object({ file: T.Union([T.String({ minLength: 2 }), T.OpenObject()]), mode: T.Enum(['replace', 'merge']) }),
  output: T.Object({ written: T.Array(T.String()), kept: T.Array(T.String()), skipped: T.Array(T.Object({ key: T.String(), label: T.String(), reason: T.String() })) }),
  perm: 'destructive',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(DEVICE),
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['docs', 'file'],
  execute: async (ctx, input) => {
    const preview = parseImport(input.file);
    if (!preview.ok) fail('invalid_input', preview.message, { rule: preview.code });
    await settleCommits();
    return importAll(preview, input.mode, { write: ctx.write, docs: ctx.docs });
  },
});

export const dataEraseAll = defineCommand({
  id: 'data.eraseAll',
  version: 1,
  title: 'Erase everything on this device',
  description: 'Delete every document, the boot cache and the caches on this device. Export first: this cannot be undone.',
  input: T.Object({}),
  output: T.Object({ keys: T.Integer(), databases: T.Integer() }),
  perm: 'destructive',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason("erasing the person's data needs their own confirmation in the app"),
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['docs'],
  execute: async (ctx) => {
    await settleCommits();
    const out = await eraseAll();
    ctx.ports.reload?.();
    return out;
  },
});

declare module '../types' {
  interface CommandMap {
    'data.usage': typeof dataUsage;
    'data.export': typeof dataExport;
    'data.import': typeof dataImport;
    'data.eraseAll': typeof dataEraseAll;
  }
}
