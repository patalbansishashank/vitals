/**
 * `sync.*` and `agents.configure` (SUITE_SPEC §1.9, §2.6, §7): ids and inputs fixed here; the sync executors are in
 * `../sync` (I1), `agents.configure` is E12's.
 *
 * Pairing, joining, a new key, the relay address and stopping are UI-only: they need the person's own consent, and
 * `sync.pair` / `sync.rotate` return the pairing code (the secret), which never goes to an agent.
 */
import { T } from '../schema';
import { CONSENT, UI_ONLY, UNDO, stub } from './_shared';

const SYNC = 'I1 (sync)';
const statusFields = {
  state: T.Enum(['off', 'connecting', 'synced', 'syncing', 'offline', 'error', 'needs-permission']),
  lastSyncedAt: T.Nullable(T.String()),
  pendingChanges: T.Integer(),
  pendingBlobs: T.Integer(),
  lastError: T.Optional(T.Object({ code: T.String(), message: T.String(), at: T.String() })),
  /** Host of the sync server only. */
  endpoint: T.Optional(T.String()),
};
/** `SyncStatus` (SUITE_SPEC §2.6) plus whether this device is paired, whether sync is on, and this device's name. */
const SyncStatus = T.Object({
  ...statusFields,
  paired: T.Boolean(),
  enabled: T.Boolean(),
  deviceLabel: T.Optional(T.String()),
});
const PairingCode = T.Object({
  uri: T.String({ description: 'vitals-sync:1?u=<server>&s=<secret>[&n=<name>]' }),
  words: T.Array(T.String(), { minItems: 24, maxItems: 24 }),
  relayUrl: T.String(),
  label: T.Optional(T.String()),
});
/** Called by Settings › Sync (the census sees the literal ids there). */
const settingsUi = { surfaces: UI_ONLY.surfaces, excludedReason: { ...UI_ONLY.excludedReason(CONSENT), ui: undefined } };

stub({
  id: 'sync.status',
  title: 'Sync status',
  description: 'Whether this device syncs, when it last did, what is waiting to upload, the sync server host and any error.',
  input: T.Object({}),
  output: SyncStatus,
  perm: 'read',
  excludedReason: { ui: 'Settings reads the live sync status directly' },
  owner: SYNC,
});
stub({
  id: 'sync.now',
  title: 'Sync now',
  description: 'Reconcile with the sync server now and upload waiting changes and files.',
  input: T.Object({}),
  output: SyncStatus,
  perm: 'write',
  impact: 'low',
  excludedReason: { ui: undefined },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network'],
  owner: SYNC,
});
stub({
  id: 'sync.pair',
  title: 'Set up sync',
  description: 'First device: create the sync key, copy this device’s data into it and show the pairing code.',
  input: T.Object({ relayUrl: T.String({ minLength: 1 }), label: T.Optional(T.String({ maxLength: 60 })) }),
  output: PairingCode,
  perm: 'write',
  impact: 'consequential',
  ...settingsUi,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network', 'docs'],
  owner: SYNC,
});
stub({
  id: 'sync.join',
  title: 'Join sync',
  description: 'Join an existing sync with a pairing code, or the 24 words and the sync server address. Merge keeps this device’s data; replace takes the synced data instead.',
  input: T.Object({ code: T.String({ minLength: 1 }), relayUrl: T.Optional(T.String()), onExisting: T.Enum(['merge', 'replace']) }),
  output: SyncStatus,
  perm: 'write',
  impact: 'consequential',
  ...settingsUi,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network', 'docs'],
  owner: SYNC,
});
stub({
  id: 'sync.rotate',
  title: 'Make a new sync key',
  description: 'After losing a device: move this device’s data to a new sync key and show its pairing code. Other devices join again with the new code. Needs full: true.',
  input: T.Object({ full: T.Optional(T.Boolean()) }),
  output: T.Object({ code: PairingCode, status: SyncStatus }),
  perm: 'write',
  impact: 'consequential',
  surfaces: UI_ONLY.surfaces,
  excludedReason: { ...UI_ONLY.excludedReason(CONSENT), ui: 'the “Lost a device?” panel is not built yet' },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network', 'docs'],
  owner: SYNC,
});
stub({
  id: 'sync.configure',
  title: 'Sync settings',
  description: 'Change the sync server address or this device’s name, or pause and resume syncing on this device.',
  input: T.Object({ relayUrl: T.Optional(T.String()), label: T.Optional(T.String({ maxLength: 60 })), enabled: T.Optional(T.Boolean()) }),
  output: SyncStatus,
  perm: 'write',
  impact: 'consequential',
  ...settingsUi,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network'],
  owner: SYNC,
});
stub({
  id: 'sync.unpair',
  title: 'Stop syncing',
  description: 'Stop syncing on this device and forget the sync key. This device keeps its data; other devices keep syncing.',
  input: T.Object({}),
  output: SyncStatus,
  perm: 'destructive',
  ...settingsUi,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['network', 'docs'],
  owner: SYNC,
});

stub({ id: 'agents.configure', title: 'Agent access', description: 'Turn WebMCP on or off and choose which MCP clients may apply changes directly.', input: T.Object({ webmcp: T.Optional(T.Boolean()), clients: T.Optional(T.Record(T.Object({ directApply: T.Boolean() }))) }), perm: 'write', impact: 'consequential', ...settingsUi, undo: UNDO.IP, idempotency: 'natural', owner: 'I1 (agents)' });
