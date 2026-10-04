/**
 * One source of truth on Today: a stream a device feeds shows the device value with its source and a Correct action
 * (no manual input); the correction sheet confirms "Device → Yours"; a corrected value carries its marker and
 * "Use the device value again". Runs the real command bus over a memory store with the canonical CSV as the device.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { stageFile, clearStaged } from '@/biometrics/app/handoff';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, jobs, settleCommits } from '@/commands';
import { resetBioRuntime } from '@/commands/bio/runtime';
import { freshState } from '@/commands/__tests__/harness';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';
import { proposalCard } from '@/ai/coach/cards';
import { renderLiving } from '../../testing';
import { PrescriptionRows, weighFieldId } from '../components/PrescriptionRows';
import type { TodayRow } from '../model';

const DAY = '2026-03-10';

const row = (glyph: TodayRow['glyph'], label: string): TodayRow => ({
  id: glyph,
  itemId: glyph === 'weigh' ? null : glyph,
  at: null,
  glyph,
  label,
  target: glyph === 'steps' ? '9 000' : glyph === 'sleep' ? '7 h 30' : 'once today',
  status: 'empty',
  item: (glyph === 'weigh' ? { kind: 'weigh' } : { kind: glyph, id: glyph }) as never,
  untimed: true,
});
const ROWS = [row('weigh', 'weigh in'), row('steps', 'steps'), row('sleep', 'sleep')];

async function importDevice() {
  const fileRef = stageFile(new Blob([CSV], { type: 'text/csv' }), 'vitals.csv');
  const r = await dispatch('bio.import', { fileRef });
  if (!r.ok || !('job' in r)) throw new Error('import did not start');
  await jobs.wait(r.job.jobId);
  await settleCommits();
}

const mount = () => renderLiving(<PrescriptionRows rows={ROWS} date={DAY} readOnly={false} quiet={false} />);
const ix = () => sharedBioIndex(getDocumentStore());

beforeEach(() => {
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
  clearStaged();
});

describe('Today with a device feeding the streams', () => {
  it('hides the manual inputs, shows the device value and its source, and offers Correct', async () => {
    await importDevice();
    mount();
    expect(await screen.findByRole('button', { name: 'Correct sleep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct steps' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /weight/i })).toBeNull();
    const steps = document.querySelector('[data-owned="steps"]') as HTMLElement;
    expect(steps.textContent).toContain('8,421');
    expect(steps.textContent).toContain('ring')
    expect((document.querySelector('[data-owned="weight"]') as HTMLElement).textContent).toContain('scale');
    const sleep = document.querySelector('[data-owned="sleep"]') as HTMLElement;
    expect(sleep.textContent).toContain('7 h 20 min');
  });

  it('keeps manual logging when no device owns the stream', async () => {
    mount();
    expect(document.getElementById(weighFieldId(DAY))).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Correct/ })).toBeNull();
  });

  it('the sheet shows Device → Yours live and confirms a correction; the marker clears it', async () => {
    await importDevice();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct sleep' }));
    expect(await screen.findByText(/Device: 7 h 20 min → Yours: 7 h 20 min/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'hours asleep' }), { target: { value: '6' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'minutes' }), { target: { value: '0' } });
    expect(screen.getByText(/Device: 7 h 20 min → Yours: 6 h 00 min/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /note/ }), { target: { value: 'the ring was off' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })));
    await waitFor(() => expect(ix().corrections()).toHaveLength(1));
    const c = ix().corrections()[0]!;
    expect(c.key).toBe(`sleep:${DAY}`);
    expect(c.value).toMatchObject({ asleepS: 21600 });
    expect(c.note).toBe('the ring was off');

    const marker = await waitFor(() => {
      const el = document.querySelector('[data-corrected="sleep"]') as HTMLElement | null;
      if (!el) throw new Error('no marker');
      return el;
    });
    expect(marker.textContent).toMatch(/corrected · \d{1,2} \w{3} \d{2}:\d{2}/);
    await act(async () => fireEvent.click(within(marker).getByRole('button', { name: /Use the device value again/ })));
    await waitFor(() => expect(ix().corrections()).toHaveLength(0));
    expect(document.querySelector('[data-corrected="sleep"]')).toBeNull();
  });

  it('a steps correction is a whole number', async () => {
    await importDevice();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct steps' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'steps' }), { target: { value: '9100' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })));
    await waitFor(() => expect(ix().corrections()[0]?.key).toBe(`daily:${DAY}:steps`));
    expect(ix().corrections()[0]!.value).toEqual({ fields: { steps: 9100 } });
  });
});

describe('Coach proposal to correct a reading', () => {
  it('reads "Correct your sleep for <date>: Device → Yours" with the note', () => {
    const card = proposalCard(
      'p1',
      'Correct a reading',
      { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 21600 }, note: 'slept six hours, the ring was off' },
      { deviceValue: 5 + 10 / 60 },
      { createdAt: '2026-03-12T09:00:00.000Z', commandId: 'biometrics.correct' },
    );
    expect(card.title).toMatch(/^Correct your sleep for .*: Device 5 h 10 min → Yours 6 h 00 min$/);
    expect(card.note).toBe('slept six hours, the ring was off');
    expect(card.state).toBe('pending');
  });
});
