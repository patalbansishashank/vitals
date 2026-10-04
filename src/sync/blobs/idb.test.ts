import { expect, it } from 'vitest';
import { createFakeIndexedDb } from '../../../tests/fakeIndexedDb';
import { openBlobDb } from './idb';

it('closes its connection when the database is deleted (erase is not blocked by an open tab)', async () => {
  const idb = createFakeIndexedDb();
  const opened: Array<{ closed: boolean }> = [];
  const factory = {
    open: (name: string, version?: number) => {
      const r = idb.factory.open(name, version);
      setTimeout(() => opened.push(r.result as unknown as { closed: boolean }), 5);
      return r;
    },
    deleteDatabase: (name: string) => idb.factory.deleteDatabase(name),
  } as unknown as IDBFactory;
  await openBlobDb({ factory, name: 'vitals-blobs' });
  await new Promise((r) => setTimeout(r, 10));
  expect(opened[0]!.closed).toBe(false);
  await new Promise<void>((resolve) => {
    const d = factory.deleteDatabase('vitals-blobs');
    d.onsuccess = () => resolve();
  });
  expect(opened[0]!.closed).toBe(true);
});
