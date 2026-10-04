/**
 * The message contract between the `home` server's main thread and one person's program (`./personProgram.ts`, run in a
 * `worker_threads` Worker by `./personWorkerEntry.ts`, in-process in tests). Types only, and nothing from the app's `@/`
 * graph: the main thread runs on Node type stripping without the alias.
 *
 * Worker messages: main → worker `{ id, req }` or `{ id, close: true }`; worker → main `{ ready: true }` once open,
 * `{ fatal: message }` when it cannot open, `{ id, started: true }` and `{ id, res }` per request.
 */

export interface PersonInit {
  personId: string;
  /** `persons/<id>` (0700). Holds the Evolu replica, `local.db`, `blobs/`, `owner.key`. */
  dir: string;
  /** IANA zone the person lives in: "today" and the rollover follow it, not the host's zone. */
  timeZone: string;
  /** Fixed at `persons add` (R17 blocker 5). */
  deviceId: string;
  /** The relay this replica syncs through (`http(s)://host[:port]`), null for a replica that never syncs. */
  relayUrl: string | null;
  /** Distinguishes Evolu instances in one process (locks, broadcast channels). */
  instance: string;
}

export interface LumenInstallation {
  deviceType?: string;
  modelId?: string;
  firmware?: string;
  updatedAt?: string;
}

export type PersonRequest =
  | { op: 'dispatch'; command: string; input: unknown; source: 'ui' | 'coach' | 'agent' | 'server'; idempotencyKey?: string }
  | { op: 'ingestLumen'; events: unknown[]; installations: Record<string, LumenInstallation> }
  | { op: 'stats' }
  /** Agent tool calls through the server (§14.4): the person's `vitals.tools/1` manifest and one guarded call. */
  | { op: 'agentManifest' }
  | { op: 'agentCall'; command: string; input: Record<string, unknown>; actorId: string; idempotencyKey?: string; stage?: boolean }
  | { op: 'flush' };

export interface IngestLumenResult {
  /** Records the importer produced from the accepted events (a series record carries many samples). */
  records: number;
  /** Records plus raw samples newly stored (0 when every event was already there). */
  added: number;
  installations: Record<string, LumenInstallation>;
  status: Array<{ kind: 'battery' | 'connection'; at: string; installationId?: string; value: unknown }>;
  /** Events per stream (policy stream names: hr, steps, sleep_sessions, …). */
  streams: Record<string, number>;
  /** Events refused before mapping (`checkLumenEvent`), by their index in `events`. */
  rejected?: Array<{ index: number; reason: 'unknown_type' | 'invalid_payload' | 'validation_failed'; type?: string }>;
}

export interface PersonStats {
  personId: string;
  timeZone: string;
  deviceId: string;
  /** Live documents in the person's store (synced and local-only). */
  documents: number;
  openedMs: number;
}

/** `detail.reason` says why a person could not answer (`person_restarting`, `timeout`); see `./workers.ts`. */
export type PersonResponse = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; detail?: { reason: string } } };

export interface PersonProgram {
  handle(req: PersonRequest): Promise<PersonResponse>;
  close(): Promise<void>;
}

/** `diag` and `snapshot` are answered at once, outside the request queue (docs/SERVER.md "Operations"). */
export type PersonWorkerIn = { id: number; req: PersonRequest } | { id: number; close: true } | { id: number; diag: true } | { id: number; snapshot: string } | { id: number; profile: string; ms: number };
/** `{ id, started: true }` when the worker begins a request (its time limit runs from there, not from the queue). */
export type PersonWorkerOut = { ready: true } | { fatal: string } | { id: number; started: true } | { id: number; res: PersonResponse } | { id: number; diag: unknown };
