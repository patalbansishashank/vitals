import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, jobs, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { stageFile } from '@/biometrics/app/handoff';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';
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
afterEach(() => vi.useRealTimers());

describe('Settings › Devices', () => {
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
});
