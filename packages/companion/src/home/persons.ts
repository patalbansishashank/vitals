/**
 * Persons on a `home` server (SUITE_SPEC §14.1): `persons/index.json` and one directory per person, 0700, files 0600.
 * The owner secret lives only in `persons/<id>/owner.key` (raw bytes); nothing here logs or returns it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, writeJsonSecret } from '../config.ts';

export interface PersonEntry {
  id: string;
  label: string;
  createdAt: string;
}

export interface PersonFile {
  label: string;
  timeZone: string;
  deviceId: string;
  relayUrl: string | null;
  createdAt: string;
}

export const PERSON_ID = /^[0-9a-f]{16}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const personPaths = (dataDir: string, id: string) => {
  if (!PERSON_ID.test(id)) throw new Error('Not a person id.');
  const dir = join(dataDir, 'persons', id);
  return {
    dir,
    ownerKey: join(dir, 'owner.key'),
    person: join(dir, 'person.json'),
    devices: join(dir, 'devices.json'),
    mqtt: join(dir, 'mqtt.json'),
    ingest: join(dir, 'ingest'),
    wal: join(dir, 'ingest', 'wal.jsonl'),
    installations: join(dir, 'ingest', 'installations.json'),
    deadletter: join(dir, 'deadletter'),
    backup: join(dir, 'backup'),
    credentials: join(dir, 'credentials'),
  };
};
export type PersonPaths = ReturnType<typeof personPaths>;

export const mkdirPrivate = async (dir: string) => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
};

/** A 16-character Crockford base32 device id, the shape the app's runtime accepts. */
export function newServerDeviceId(): string {
  return [...randomBytes(16)].map((b) => CROCKFORD[b & 31]).join('');
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

export interface PersonRegistry {
  list(): Promise<PersonEntry[]>;
  get(id: string): Promise<(PersonEntry & PersonFile) | null>;
  add(o: { label: string; timeZone: string; secret: Uint8Array; relayUrl: string | null }): Promise<PersonEntry>;
  remove(id: string): Promise<boolean>;
  paths(id: string): PersonPaths;
  readSecret(id: string): Promise<Uint8Array>;
}

export function createPersonRegistry(dataDir: string): PersonRegistry {
  const indexFile = join(dataDir, 'persons', 'index.json');
  const readIndex = async (): Promise<PersonEntry[]> => {
    const list = await readJsonFile<PersonEntry[]>(indexFile);
    return Array.isArray(list) ? list.filter((p) => PERSON_ID.test(p?.id ?? '')) : [];
  };
  const reg: PersonRegistry = {
    list: readIndex,
    async get(id) {
      if (!PERSON_ID.test(id)) return null;
      const entry = (await readIndex()).find((p) => p.id === id);
      const file = entry ? await readJsonFile<PersonFile>(personPaths(dataDir, id).person) : null;
      return entry && file ? { ...entry, ...file, label: entry.label } : null;
    },
    async add({ label, timeZone, secret, relayUrl }) {
      if (secret.length !== 32) throw new Error('The owner secret must be 32 bytes.');
      if (!validTimeZone(timeZone)) throw new Error(`Unknown time zone: ${timeZone}`);
      await mkdirPrivate(join(dataDir, 'persons'));
      const index = await readIndex();
      let id: string;
      // ids are never reused: a removed person's directory name stays taken while it exists
      do id = randomBytes(8).toString('hex');
      while (index.some((p) => p.id === id) || existsSync(join(dataDir, 'persons', id)));
      const p = personPaths(dataDir, id);
      for (const d of [p.dir, p.ingest, p.deadletter, p.credentials]) await mkdirPrivate(d);
      await writeFile(p.ownerKey, secret, { mode: 0o600, flag: 'wx' });
      const createdAt = new Date().toISOString();
      const clean = label.trim().slice(0, 60) || 'Person';
      await writeJsonSecret(p.person, { label: clean, timeZone, deviceId: newServerDeviceId(), relayUrl, createdAt } satisfies PersonFile);
      await writeJsonSecret(p.devices, []);
      await writeJsonSecret(p.mqtt, []);
      const entry = { id, label: clean, createdAt };
      await writeJsonSecret(indexFile, [...index, entry]);
      return entry;
    },
    async remove(id) {
      const index = await readIndex();
      if (!index.some((p) => p.id === id)) return false;
      await writeJsonSecret(indexFile, index.filter((p) => p.id !== id));
      await rm(personPaths(dataDir, id).dir, { recursive: true, force: true });
      return true;
    },
    paths: (id) => personPaths(dataDir, id),
    async readSecret(id) {
      const raw = await readFile(personPaths(dataDir, id).ownerKey);
      if (raw.length !== 32) throw new Error('owner.key is not 32 bytes.');
      return new Uint8Array(raw);
    },
  };
  return reg;
}

