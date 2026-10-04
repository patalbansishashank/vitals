/**
 * The ring service wired to the app: the document store (sources, the lease), the device-local cursor documents,
 * the sync view, the platform shell and the transport for where Vitals runs. Loaded lazily from the bio commands at
 * boot (`startAppRingService`) and by `getRingService()` on first use.
 */
import { bioActivity } from '@/biometrics/app/activity';
import { chooserFactory } from '@/biometrics/ble/transports/rings';
import { capacitorTransport, electronTransport, pickTransport, webTransport } from '@/biometrics/ble/transports';
import { RING_SHARING_ID, ringChoiceOf } from '@/biometrics/core/policy';
import { newSourceDoc } from '@/biometrics/core/source';
import type { BioBatch } from '@/biometrics/core/types';
import { sharedBioIndex, type SourceBody } from '@/biometrics/store/docIndex';
import { deriveWriter, openBioStore } from '@/commands/bio/store';
import { deviceId, getDocumentStore, onDocumentStoreSwitch, writeOps } from '@/state/runtime';
import { getSyncRuntime } from '@/state/sync';
import * as platformModule from '@/platform';
import { platform } from '@/platform';
import type { DocumentStore } from '@/store';
import { familyById } from '../../../packages/rings/src/index';
import { createLegacyConnector } from './connectors/legacy';
import { createRingsConnector } from './connectors/rings';
import type { RingConnector, RingLocalPort, RingLocalState, RingServicePorts, RingShellPort, RingStorePort, RingSyncPort } from './ports';
import { createRingService } from './ringService';
import { isLeaseDocId, leaseDocId, type RingLeaseBody, type RingService, type RingSyncReport } from './types';

const LOCAL_COL = 'deviceSettings' as const;
const cursorDocId = (ringKey: string): string => `ringCursor:${ringKey}`;

/**
 * The ring service's view of the person's documents. Without an explicit store it follows the app's current document
 * store: pairing or joining sync replaces that store mid-session (`onDocumentStoreSwitch`), and the service must read
 * the sources and the lease from the same store its ingest writes to.
 */
export function appStorePort(fixed?: DocumentStore): RingStorePort {
  const cur = (): DocumentStore => fixed ?? getDocumentStore();
  const index = () => sharedBioIndex(cur());
  /** Ring sources this port created and has not read yet. */
  const created = new Set<string>();
  return {
    ready: () => index().ready,
    sources: () => index().sources(),
    source: (k) => index().source(k),
    async ingest(batch: BioBatch, ctx): Promise<RingSyncReport> {
      const { ingestRingBatch } = await import('@/commands/bio/exec');
      const rep = await ingestRingBatch(batch, ctx);
      // a new ring's first read is in: Lumen data and older sources of this ring fold into it (one ring = one source)
      if (created.delete(ctx.ringKey) && !fixed) void import('@/commands/bio').then((m) => m.runRingFold()).catch(() => undefined);
      return rep;
    },
    async ensureSource(ringKey, p) {
      if (index().source(ringKey)) return;
      const store = cur();
      const now = new Date().toISOString();
      const bio = await openBioStore({ store, writer: deriveWriter(store, 'ring source') });
      const doc = newSourceDoc({ channel: p.channel as never, device: { type: 'ring', manufacturer: p.maker, model: p.model, tier: 'C', ...(p.firmware ? { firmware: p.firmware } : {}) }, recording_method: 'automatic', modality: 'sensed', ingested_at: now }, 0, p.streams, ringChoiceOf(index().sourceDocs.get(RING_SHARING_ID)));
      await bio.putSource({ ...doc, sourceKey: ringKey, label: p.label, baselineEpochs: [now.slice(0, 10) as never] });
      await bio.patchSource(ringKey, { deviceType: 'ring', ble: { driver: p.driverId }, createdAt: now });
      await bio.flush();
      created.add(ringKey);
    },
    async patchSource(ringKey, patch) {
      const store = cur();
      const bio = await openBioStore({ store, writer: deriveWriter(store, 'ring state') });
      await bio.patchSource(ringKey, patch as Partial<SourceBody>);
      await bio.flush();
    },
    lease(ringKey) {
      const b = index().sourceDocs.get(leaseDocId(ringKey)) as unknown as RingLeaseBody | undefined;
      return b?.kind === 'ringLease' ? b : undefined;
    },
    async patchLease(ringKey, patch) {
      // the lease document sits beside the sources; `patchSource` is a merge patch on any `bioSources` id
      const store = cur();
      const bio = await openBioStore({ store, writer: deriveWriter(store, 'ring lease') });
      await bio.patchSource(leaseDocId(ringKey), { kind: 'ringLease', ringKey, ...patch } as unknown as Partial<SourceBody>);
      await bio.flush();
    },
    subscribe(cb) {
      let off = index().subscribe(cb);
      // a new store: listen there and let the service read everything again
      const offSwitch = fixed
        ? () => undefined
        : onDocumentStoreSwitch(() => {
            off();
            off = index().subscribe(cb);
            void index().ready.then(cb, () => undefined);
          });
      return () => {
        off();
        offSwitch();
      };
    },
  };
}

/** Device-local ring state in `deviceSettings` documents `ringCursor:<ringKey>` (never synced). */
export function appLocalPort(fixed?: DocumentStore): RingLocalPort {
  const cur = (): DocumentStore => fixed ?? getDocumentStore();
  const strip = (d: Record<string, unknown>): RingLocalState => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = v;
    return { cursor: {}, ...(out as Partial<RingLocalState>) };
  };
  return {
    async get(ringKey) {
      const store = cur();
      await store.ready;
      const d = store.peek<Record<string, unknown>>(LOCAL_COL, cursorDocId(ringKey));
      return d ? strip(d) : undefined;
    },
    async set(ringKey, state) {
      try {
        await writeOps('derive', [{ col: LOCAL_COL, id: cursorDocId(ringKey), before: null, after: { ...state }, kind: 'put' }], 'ring cursor');
      } catch (e) {
        console.warn('Vitals: could not save the ring cursor on this device', e);
      }
    },
    remove: (ringKey) => writeOps('derive', [{ col: LOCAL_COL, id: cursorDocId(ringKey), before: null, after: null, kind: 'remove' }], 'ring cursor').catch(() => undefined),
  };
}

export function appSyncPort(): RingSyncPort {
  return {
    view() {
      const v = getSyncRuntime().view();
      return { deviceId: v.deviceId || deviceId(), deviceLabel: v.label ?? 'This device', syncOn: v.paired && v.enabled && v.status.state !== 'off' };
    },
  };
}

/**
 * The platform shell (`src/platform/shell.ts`) as the service's port. On Android the ring link (`androidRingLink`)
 * already drives the foreground service from the service's status, so the service leaves keep-alive to it there.
 */
export function appShellPort(): RingShellPort {
  const shell = platformModule.shell();
  const port: RingShellPort = {
    notify: (n) => shell.notify(n),
    onBluetoothState: (cb) => shell.onBluetoothState(cb),
    onResume: (cb) => shell.onResume(cb),
  };
  if (platform() !== 'android') port.keepAlive = (on, reason) => shell.keepAlive(on, reason);
  return port;
}

/**
 * The transport for where Vitals runs, picked as L-XPORT's `pickTransport()` picks it (Capacitor in the Android app,
 * the desktop bridge in Electron, Web Bluetooth in a browser), as an A5a factory, plus the old drivers for a family
 * without one. Inside the apps `navigator.bluetooth` does not exist, so the platform name alone is not enough.
 */
export function appConnector(): RingConnector {
  const p = platform();
  const t = pickTransport() ?? (p === 'android' ? capacitorTransport : p === 'electron' ? electronTransport : webTransport);
  // the app transports keep their own scan list behind the chooser path (`capacitorFactory` needs the plugin's client,
  // which only `src/biometrics/ble` may load); the label is informational
  const factory = chooserFactory(t, t === webTransport ? 'web-bluetooth' : 'electron');
  const rings = createRingsConnector({
    factory,
    unavailable: () => (t !== capacitorTransport ? 'unsupported' : t.permissionDenied?.() ? 'permission_needed' : 'bluetooth_off'),
  });
  const legacy = createLegacyConnector({ transport: t, drivers: () => import('@/biometrics/ble/registry') });
  const pick = (driverId: string): RingConnector => (familyById(driverId) ? rings : legacy);
  return {
    available: () => rings.available(),
    scan: (signal) => rings.scan(signal),
    connect: (hit, signal) => rings.connect(hit, signal),
    reconnect: (platformId, driverId, signal) => {
      const c = pick(driverId);
      if (!c.reconnect) return Promise.reject(new Error('this platform cannot reconnect on its own'));
      return c.reconnect(platformId, driverId, signal);
    },
    adopt: (link, driverId, signal) => pick(driverId).adopt!(link, driverId, signal),
    driverInfo: (driverId) => pick(driverId).driverInfo(driverId),
  };
}

export function createAppRingPorts(): RingServicePorts {
  return {
    connector: appConnector(),
    store: appStorePort(),
    local: appLocalPort(),
    sync: appSyncPort(),
    clock: { now: () => Date.now(), setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }, tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    shell: appShellPort(),
    platform: platform(),
    producer: { name: 'vitals-ring', version: '1' },
  };
}

export function createAppRingService(): RingService {
  const s = createRingService(createAppRingPorts());
  // the chip on the Devices page follows the service while it reads a ring on its own
  s.subscribe((rings) => {
    const syncing = rings.find((r) => r.state === 'syncing');
    const cur = bioActivity.get().syncing;
    if (syncing && !cur) bioActivity.set({ syncing: { jobId: `ring:${syncing.ringKey}`, progress: syncing.syncProgress ?? 0, sourceKey: syncing.ringKey, driver: '' } });
    else if (syncing && cur?.jobId === `ring:${syncing.ringKey}`) bioActivity.set({ syncing: { ...cur, progress: syncing.syncProgress ?? cur.progress } });
    else if (!syncing && cur?.jobId.startsWith('ring:')) bioActivity.set({ syncing: null });
  });
  return s;
}

/** Boot: start the app's service once the document store is ready (idempotent). */
export async function startAppRingService(): Promise<void> {
  const { getRingService } = await import('./index');
  await getDocumentStore().ready;
  await getRingService().start();
}

export { isLeaseDocId };
