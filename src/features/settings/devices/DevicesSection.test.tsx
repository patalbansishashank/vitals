import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, jobs, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { stageFile } from '@/biometrics/app/handoff';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { setRingServiceForTests, type RingService, type RingStatus } from '@/biometrics/service';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';
import { setPlatformForTests } from '@/platform';
import { DevicesSection } from './DevicesSection';
import { formatDay } from './copy';

type Sources = { sources: Array<{ sourceKey: string; label: string; policies: Array<{ stream: string; coach: string; imported: boolean }> }> };
const out = <T,>(r: CommandResult) => (r.ok && 'output' in r ? (r.output as T) : null)!;

async function importCsv(): Promise<void> {
  const r = await dispatch('bio.import', { fileRef: stageFile(new Blob([CSV]), 'vitals.csv') });
  if (!r.ok || !('job' in r)) throw new Error('no job');
  await jobs.wait(r.job.jobId);
}

const ui = () =>
  render(
    <MemoryRouter>
      <DevicesSection />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
});
afterEach(() => {
  vi.useRealTimers();
  setRingServiceForTests(null);
  setPlatformForTests(undefined);
});

/** A ring service with fixed rings and one ring nearby. */
function ringService(rings: RingStatus[], availability: ReturnType<RingService['availability']> = 'ready'): RingService {
  const none = async () => undefined;
  return {
    start: none, stop: none, rings: () => rings, subscribe: () => () => undefined, availability: () => availability,
    async *scan() {
      yield { candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -70, known: false };
    },
    pair: () => new Promise<RingStatus>(() => undefined), connectHere: none, syncNow: none,
    checkNow: () => Promise.reject(new Error('no')), watchLiveHeartRate: () => () => undefined, disconnect: none, forget: none,
    syncLink: () => Promise.reject(new Error('no')),
  };
}
const RING_KEY = 'ble:jstyle2301|j-style:2301#0a1b';

describe('Settings › Devices', () => {
  it.each(['android', 'electron'] as const)('in the %s app the limits line does not talk about a web page or a browser (J2-05)', async (p) => {
    setPlatformForTests(p);
    setRingServiceForTests(ringService([], 'unsupported'));
    const { container } = ui();
    expect(await screen.findByText(/Vitals can’t read Apple Health or Health Connect directly/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/web page|browser|Chrome/i);
  });

  it('on the web the limits line still says a web page cannot read them', async () => {
    setPlatformForTests('web');
    ui();
    expect(await screen.findByText(/A web page can’t read Apple Health or Health Connect/)).toBeTruthy();
  });

  it('says so when no device has brought data in, and offers import and the intake chapter', async () => {
    ui();
    expect(await screen.findByText(/No devices yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Choose devices and what they share/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a file…' })).toBeTruthy();
  });

  it('no longer offers a source priority', async () => {
    ui();
    await screen.findByText(/No devices yet/);
    expect(screen.queryByText(/Source priority|which source wins/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'Lumen Health over MQTT' })).toBeTruthy();
  });

  it('lists a source with its tier and streams, and changes what the Coach sees through bio.setPolicy', async () => {
    await importCsv();
    const { sources } = out<Sources>(await dispatch('bio.sources', {}));
    const src = sources.find((s) => s.policies.some((p) => p.stream === 'hr'))!;
    ui();
    const block = await screen.findByRole('region', { name: src.label });
    expect(within(block).getByText(/tier [ABC] ·/)).toBeTruthy();
    expect(within(block).getByRole('region', { name: 'Stream sharing settings' })).toHaveAttribute('tabindex', '0');
    const bank = within(block).getByRole('radiogroup', { name: 'Coach sees: heart rate' });
    fireEvent.click(within(bank).getByRole('radio', { name: 'daily' }));
    await waitFor(async () => {
      await settleCommits();
      const after = out<Sources>(await dispatch('bio.sources', {}));
      expect(after.sources.find((s) => s.sourceKey === src.sourceKey)!.policies.find((p) => p.stream === 'hr')?.coach).toBe('daily');
    });
  });

  it('writes "last data" in the date style from Settings', async () => {
    expect(formatDay('2026-03-10', 'day-month')).toBe('10 Mar 2026');
    expect(formatDay('2026-03-10', 'month-day')).toBe('Mar 10, 2026');
    expect(formatDay('not a date', 'day-month')).toBe('not a date');
    await importCsv();
    await dispatch('settings.update', { patch: { dateStyle: 'month-day' } });
    ui();
    await screen.findAllByRole('region');
    expect(screen.getAllByText(/last data [A-Z][a-z]{2} \d{1,2}, \d{4}/).length).toBeGreaterThan(0);
  });

  it('removes a source only after the typed confirmation', async () => {
    await importCsv();
    const { sources } = out<Sources>(await dispatch('bio.sources', {}));
    ui();
    const block = await screen.findByRole('region', { name: sources[0]!.label });
    fireEvent.click(within(block).getByRole('button', { name: 'Remove this device…' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'remove' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove device' }));
    await waitFor(async () => {
      await settleCommits();
      expect(out<Sources>(await dispatch('bio.sources', {})).sources.map((s) => s.sourceKey)).not.toContain(sources[0]!.sourceKey);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: sources[0]!.label })).toBeNull());
  });

  it('shows the rings from the ring service, and nothing in the section asks for a password, code or key', async () => {
    const at = new Date('2026-03-12T11:48:00.000Z').toISOString();
    const states: RingStatus[] = (['idle', 'connected', 'syncing', 'elsewhere', 'error', 'permission_needed'] as const).map((state, i) => ({
      ringKey: `${RING_KEY}${i}`,
      label: 'J-Style 2301',
      state,
      battery: 70,
      lastSyncAt: at,
      lastSyncBy: 'Pixel 8',
      ...(state === 'elsewhere' ? { heldBy: { deviceId: 'd2', deviceLabel: 'Pixel 8', platform: 'android' as const, since: at } } : {}),
      ...(state === 'error' ? { error: { code: 'refused' as const, message: 'The ring refused the connection. Try again.' } } : {}),
    }));
    setRingServiceForTests(ringService(states));
    const { container } = ui();
    await screen.findByText(/No devices yet/);
    const block = screen.getByRole('group', { name: 'rings' });
    expect(within(block).getAllByRole('heading', { name: 'J-Style 2301' })).toHaveLength(6);
    expect(within(block).getByText(/^Connected to Pixel 8 since \d\d:\d\d$/)).toBeTruthy();
    expect(within(block).getAllByText('Battery 70 % · Last read 12 min ago on Pixel 8')).toHaveLength(6);
    fireEvent.click(within(block).getByRole('button', { name: 'Add a ring' }));
    await within(block).findByRole('list', { name: 'rings nearby' });
    fireEvent.click(within(block).getAllByRole('button', { name: 'Forget…' })[0]!);
    await screen.findByRole('alertdialog');
    // "key" also catches "ring key" and "passkey"; nothing in Settings › Devices may name one (decision 13)
    expect(container.textContent).not.toMatch(/password|passcode|pin\b|key/i);
    expect(document.body.textContent).not.toMatch(/password|passcode|pin\b|key/i);
  });

  it('in a browser without Bluetooth the rings block is one line', async () => {
    setRingServiceForTests(ringService([], 'unsupported'));
    ui();
    const block = await screen.findByRole('group', { name: 'rings' });
    expect(within(block).getByText('This browser can’t reach rings. Use the Vitals app for Android or your computer.')).toBeTruthy();
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });
});
