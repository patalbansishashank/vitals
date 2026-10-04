/** Persistent storage requests (src/app/persistStorage.ts) against a stubbed navigator.storage. */
import type { BusEvent } from '@/commands/types';
import { PERSIST_KEY, readPersistRecord, requestPersistentStorage, resetPersistSession, startStoragePersistence, type PersistEnv } from '../persistStorage';

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

function stubStorage(answer: boolean, already = false) {
  return { persisted: vi.fn(async () => already), persist: vi.fn(async () => answer) };
}

const env = (ua: string, storage: PersistEnv['storage']): PersistEnv => ({ userAgent: ua, storage, local: localStorage, now: () => new Date('2026-10-01T12:00:00Z') });

const committed = (commandId: string, actor: 'user' | 'ai' = 'user'): BusEvent =>
  ({ type: 'committed', commandId, actor: { kind: actor, id: actor === 'user' ? 'me' : 'coach' }, changeSet: { id: 'cs', commandId, label: commandId, at: '', actor: { kind: actor, id: 'x' }, docs: [] } }) as unknown as BusEvent;

beforeEach(() => {
  localStorage.clear();
  resetPersistSession();
});

describe('silent browsers (Chromium, Safari)', () => {
  it('ask after a save, once per session, and remember a grant', async () => {
    const s = stubStorage(true);
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('granted');
    expect(s.persist).toHaveBeenCalledTimes(1);
    expect(readPersistRecord()).toMatchObject({ outcome: 'granted', asked: 1, trigger: 'save' });
    resetPersistSession();
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('skipped');
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('ask again in a later session (or on install) after a silent refusal, never twice in one session', async () => {
    const s = stubStorage(false);
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('denied');
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('skipped');
    expect(await requestPersistentStorage('install', env(CHROME, s))).toBe('denied');
    expect(s.persist).toHaveBeenCalledTimes(2);
    resetPersistSession();
    s.persist.mockResolvedValueOnce(true);
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('granted');
    expect(readPersistRecord()?.asked).toBe(3);
  });

  it('do not call persist() when storage is already persistent', async () => {
    const s = stubStorage(true, true);
    expect(await requestPersistentStorage('save', env(CHROME, s))).toBe('granted');
    expect(s.persist).not.toHaveBeenCalled();
  });
});

describe('Firefox (prompts)', () => {
  it('never asks on an ordinary save; asks once when setup is done, and never again after an answer', async () => {
    const s = stubStorage(false);
    expect(await requestPersistentStorage('save', env(FIREFOX, s))).toBe('skipped');
    expect(s.persist).not.toHaveBeenCalled();
    expect(await requestPersistentStorage('setupDone', env(FIREFOX, s))).toBe('denied');
    resetPersistSession();
    expect(await requestPersistentStorage('planStart', env(FIREFOX, s))).toBe('skipped');
    expect(await requestPersistentStorage('install', env(FIREFOX, s))).toBe('skipped');
    expect(s.persist).toHaveBeenCalledTimes(1);
    expect(readPersistRecord()).toMatchObject({ outcome: 'denied', asked: 1, trigger: 'setupDone' });
  });
});

describe('without the API', () => {
  it('records unsupported once and stays quiet', async () => {
    expect(await requestPersistentStorage('save', env(CHROME, null))).toBe('unsupported');
    expect(JSON.parse(localStorage.getItem(PERSIST_KEY)!)).toMatchObject({ outcome: 'unsupported' });
    resetPersistSession();
    expect(await requestPersistentStorage('install', env(CHROME, null))).toBe('skipped');
  });

  it('treats a throwing persist() as an answer', async () => {
    const s = { persisted: vi.fn(async () => false), persist: vi.fn(async () => Promise.reject(new Error('blocked'))) };
    expect(await requestPersistentStorage('setupDone', env(FIREFOX, s))).toBe('denied');
    resetPersistSession();
    expect(await requestPersistentStorage('setupDone', env(FIREFOX, s))).toBe('skipped');
  });
});

describe('wiring', () => {
  function bus() {
    const ls = new Set<(e: BusEvent) => void>();
    return { subscribe: (l: (e: BusEvent) => void) => (ls.add(l), () => ls.delete(l)), emit: (e: BusEvent) => ls.forEach((l) => l(e)) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('Chromium: the first saved change asks; agent writes and reads do not', async () => {
    const b = bus();
    const s = stubStorage(true);
    const stop = startStoragePersistence({ ...env(CHROME, s), subscribe: b.subscribe, win: null });
    b.emit(committed('settings.update', 'ai'));
    b.emit({ type: 'committed', commandId: 'profile.get', actor: { kind: 'user', id: 'me' }, changeSet: null } as unknown as BusEvent);
    await settle();
    expect(s.persist).not.toHaveBeenCalled();
    b.emit(committed('profile.patch'));
    await settle();
    expect(s.persist).toHaveBeenCalledTimes(1);
    stop();
  });

  it('Firefox: asks when the body setup is done, not on earlier steps', async () => {
    const b = bus();
    const s = stubStorage(true);
    let done = false;
    const stop = startStoragePersistence({ ...env(FIREFOX, s), subscribe: b.subscribe, setupDone: () => done, win: null });
    b.emit(committed('profile.patch'));
    b.emit(committed('profile.setSetupStep'));
    await settle();
    expect(s.persist).not.toHaveBeenCalled();
    done = true;
    b.emit(committed('profile.setSetupStep'));
    await settle();
    expect(s.persist).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asks when the app is installed or launched as an installed app', async () => {
    const s = stubStorage(true);
    const target = new EventTarget();
    const win = { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), matchMedia: () => ({ matches: false }) as MediaQueryList };
    const stop = startStoragePersistence({ ...env(CHROME, s), subscribe: bus().subscribe, win: win as never });
    await settle();
    expect(s.persist).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('appinstalled'));
    await settle();
    expect(s.persist).toHaveBeenCalledTimes(1);
    stop();
  });
});
