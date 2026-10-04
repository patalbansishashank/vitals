/**
 * Device-local sync configuration and the owner secret. Never under a `vitals.*` localStorage key (those are exported
 * and synced). The secret is AES-GCM-wrapped under a non-extractable device `CryptoKey` kept in IndexedDB, so script
 * on this origin can use it but cannot read the raw key out (R7 §7.2 "at rest": the browser profile is the baseline).
 */
import type { SyncConfig } from '@/sync/types';

export interface SyncVault {
  load(): Promise<{ config: SyncConfig; secret: Uint8Array } | null>;
  save(config: SyncConfig, secret: Uint8Array): Promise<void>;
  saveConfig(config: SyncConfig): Promise<void>;
  clear(): Promise<void>;
}

export const SYNC_DB = 'vitals-sync';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

async function deviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = (await tx<CryptoKey>(db, 'readonly', (s) => s.get('deviceKey'))) ?? null;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await tx(db, 'readwrite', (s) => void s.put(key, 'deviceKey'));
  return key;
}

export function createIdbVault(): SyncVault {
  const available = () => typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);
  return {
    async load() {
      if (!available()) return null;
      const db = await openDb();
      try {
        const config = await tx<SyncConfig>(db, 'readonly', (s) => s.get('config'));
        const wrapped = await tx<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }>(db, 'readonly', (s) => s.get('secret'));
        if (!config || !wrapped) return null;
        const secret = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv }, await deviceKey(db), wrapped.ct));
        return { config, secret };
      } finally {
        db.close();
      }
    },
    async save(config, secret) {
      const db = await openDb();
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = new Uint8Array(secret.byteLength);
        plain.set(secret);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(db), plain);
        await tx(db, 'readwrite', (s) => {
          s.put(config, 'config');
          s.put({ iv, ct }, 'secret');
        });
      } finally {
        db.close();
      }
    },
    async saveConfig(config) {
      const db = await openDb();
      try {
        await tx(db, 'readwrite', (s) => void s.put(config, 'config'));
      } finally {
        db.close();
      }
    },
    async clear() {
      if (!available()) return;
      const db = await openDb();
      try {
        await tx(db, 'readwrite', (s) => {
          s.delete('config');
          s.delete('secret');
        });
      } finally {
        db.close();
      }
    },
  };
}

/** For tests and environments without IndexedDB. */
export function createMemoryVault(): SyncVault {
  let data: { config: SyncConfig; secret: Uint8Array } | null = null;
  return {
    load: async () => data,
    save: async (config, secret) => {
      data = { config, secret: secret.slice() };
    },
    saveConfig: async (config) => {
      if (data) data = { ...data, config };
    },
    clear: async () => {
      data = null;
    },
  };
}
