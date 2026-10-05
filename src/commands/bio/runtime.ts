/**
 * Light runtime of the `bio.*` executors (stays in the main chunk; heavy code is in `./exec.ts`, loaded lazily):
 * the `bio` port (`ctx.ports.bio`) through which a command takes what a screen staged (a picked file, a Bluetooth link
 * opened inside a click) and the optional SQLite opener, the debounced background rescoring after small changes, and
 * the ring master switch re-applied after sync.
 */
import type { SqlOpener } from '@/biometrics/importers/sqlite';
import { takeBleLink, takeFile, type StagedFile, type StagedLink } from '@/biometrics/app/handoff';
import { isRingSource, RING_SHARING_ID } from '@/biometrics/core/policy';
import { installPorts, getPorts } from '../bus';
import type { DocumentStore, LocalDate, StoreChange } from '@/store';

export interface BioPorts {
  /** A file the screen staged (`stageFile`), taken once. */
  takeFile(fileRef: string): StagedFile | undefined;
  /** A Bluetooth link the screen opened inside the click (`requestDevice` + `stageBleLink`), taken once. */
  takeLink(linkRef: string): StagedLink | undefined;
  /** SQLite engine (sql.js) when the build allows WebAssembly; absent in this build (CSP), so SQLite files need a JSON dump. */
  openSqlite?: SqlOpener;
}

declare module '../types' {
  interface CommandPorts {
    /** Biometrics hand-offs from the screens (files, Bluetooth links) and the optional SQLite engine. */
    bio?: BioPorts;
  }
}

export const defaultBioPorts: BioPorts = { takeFile, takeLink: takeBleLink };

/** Install the default `bio` port (keeps one already installed, e.g. by a test). */
export function installBioPorts(over: Partial<BioPorts> = {}): BioPorts {
  const bio: BioPorts = { ...defaultBioPorts, ...(getPorts().bio ?? {}), ...over };
  installPorts({ bio });
  return bio;
}

/* ---------------------------------------------------------------- background rescoring */

function isTest(): boolean {
  return (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
}

let auto = !isTest();
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingFrom: LocalDate | null = null;
let runner: ((from: LocalDate | null) => Promise<void>) | null = null;

/** Who runs a scheduled rescore (`./index.ts` installs a `bio.rescore` system dispatch). */
export function setRescoreRunner(fn: (from: LocalDate | null) => Promise<void>): void {
  runner = fn;
}

/** Turn automatic rescoring after small changes on or off (off in tests unless a test turns it on). */
export function setAutoRescore(on: boolean): void {
  auto = on;
  if (!on && timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** The earliest date a scheduled rescore will start from (tests), or null when nothing is scheduled. */
export function pendingRescore(): LocalDate | null {
  return pendingFrom;
}

/** Recompute scores from `from` (null = fill what is missing) a moment after the last small change. */
export function scheduleRescore(from: LocalDate | null, delayMs = 1500): void {
  pendingFrom = pendingFrom === null ? from : from === null ? pendingFrom : from < pendingFrom ? from : pendingFrom;
  if (!auto) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushRescore(), delayMs);
}

/** The earliest day a synced biometrics document can touch (a record's local date, a correction's target), a day early for zones. */
export function remoteBioDate(col: string, doc: unknown): LocalDate | null {
  const d = doc as { time?: { local_date?: string; start?: string; end?: string }; target?: { localDate?: string }; local_date?: string; superseded?: boolean } | null;
  if (col === 'bioChunks' && d?.superseded) return null;
  const day = col === 'bioCorrections' ? d?.target?.localDate : col === 'bioChunks' ? d?.local_date : (d?.time?.local_date ?? d?.time?.start ?? d?.time?.end)?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) as LocalDate;
}

/**
 * Scores are derived on each device and never synced, so records and corrections that arrive by sync (another device,
 * the server's broker ingest of the ring) are scored here too: a debounced rescore from the earliest day touched.
 */
export function rescoreOnRemoteBio(store: { subscribe(fn: (c: StoreChange) => void): () => void }, delayMs = 3000): () => void {
  return store.subscribe((c) => {
    // sample chunks too: a night's heart rate can arrive after its sleep record
    if (c.origin !== 'remote' || (c.col !== 'bioRecords' && c.col !== 'bioCorrections' && c.col !== 'bioChunks') || !c.doc) return;
    const from = remoteBioDate(c.col, c.doc);
    if (from) scheduleRescore(from, delayMs);
  });
}

/* ---------------------------------------------------------------- the ring master switch, by sync */

/**
 * The master switch off must reach ring sources made or written without it on another device (R3-09): when the
 * person's choice (`ringSharing:me`) or a ring source arrives by sync, `run` (`./sharing.ts` `applyRingSharingOff`)
 * goes over them once nothing more arrived for `delayMs` (3 s, as the rescore waits: a switch turned on elsewhere and
 * that device's ring rows may come in separate bursts); with `atOpen`, also a moment after the store is ready (the app
 * opening it). Runs never overlap.
 */
export function ringSharingOnRemote(store: DocumentStore, run: (store: DocumentStore) => Promise<unknown>, o: { atOpen?: boolean; delayMs?: number } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(() => run(store)).catch((e: unknown) => console.warn('Vitals: the ring data switch was not applied to every ring', e));
    }, ms);
  };
  if (o.atOpen) void store.ready.then(() => schedule(300), () => undefined);
  const off = store.subscribe((c) => {
    if (c.origin === 'remote' && c.col === 'bioSources' && (c.id === RING_SHARING_ID || isRingSource({ sourceKey: c.id }))) schedule(o.delayMs ?? 3000);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Run a scheduled rescore now (tests, page hide). */
export async function flushRescore(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const from = pendingFrom;
  pendingFrom = null;
  if (from === null && !runner) return;
  try {
    await runner?.(from);
  } catch (e) {
    console.error('Vitals: rescoring failed', e);
  }
}

/** Tests: forget anything scheduled. */
export function resetBioRuntime(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pendingFrom = null;
  auto = !isTest();
}
