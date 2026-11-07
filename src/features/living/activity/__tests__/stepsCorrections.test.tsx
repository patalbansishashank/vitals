/**
 * The correction form under Steps by source (energy SPEC §2.3 4(a)): the whole day or some hours, ring or phone, saved
 * through `log.stepsCorrection`, listed with Remove (`log.retract`); quiet mode offers the whole day in words only.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import type { LogEntry } from '@/living/types';
import { CORRECT_WORDS, StepsCorrections, correctionText } from '../StepsSourceChart';
import type { StepsHour } from '../model';

vi.mock('@/state/gaugeImport', () => ({ runGaugeImport: vi.fn(async () => ({ ran: false, reason: 'off' })) }));

const HOUR = 3_600_000;
// a day that started 30 hours ago and ended 6 hours ago: every hour has begun
const dayStart = Math.floor((Date.now() - 30 * HOUR) / HOUR) * HOUR;
const hours: StepsHour[] = Array.from({ length: 24 }, (_, i) => ({ start: dayStart + i * HOUR, ring: 100, phone: 120, selected: 100, from: 'ring', disagree: false }));

async function stored(): Promise<Array<Extract<LogEntry, { kind: 'stepsCorrection' }>>> {
  const r = await dispatch('log.get', { from: '2020-01-01', to: '2099-12-31', kinds: ['stepsCorrection'] });
  return (r as { output: Array<Extract<LogEntry, { kind: 'stepsCorrection' }>> }).output;
}

describe('StepsCorrections', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('saves "phone for the whole day", lists it, and removes it', async () => {
    render(<StepsCorrections hours={hours} nowMs={Date.now()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Phone' }));
    fireEvent.click(screen.getByRole('button', { name: CORRECT_WORDS.save }));
    await screen.findByText(CORRECT_WORDS.saved);
    await settleCommits();
    const [c] = await stored();
    expect(c).toMatchObject({ use: 'phone', start: new Date(dayStart).toISOString(), end: new Date(dayStart + 24 * HOUR).toISOString() });
    const row = await screen.findByText('Phone for the whole day');
    fireEvent.click(within(row.closest('li')!).getByRole('button', { name: /Remove/ }));
    await screen.findByText(CORRECT_WORDS.removed);
    await settleCommits();
    expect(await stored()).toEqual([]);
  });

  it('saves "ring for some hours" with the chosen span', async () => {
    render(<StepsCorrections hours={hours} nowMs={Date.now()} />);
    fireEvent.click(screen.getByRole('radio', { name: CORRECT_WORDS.someHours }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ring' }));
    fireEvent.click(screen.getByRole('button', { name: CORRECT_WORDS.save }));
    await screen.findByText(CORRECT_WORDS.saved);
    await settleCommits();
    await waitFor(async () => expect((await stored()).map((c) => [c.use, Date.parse(c.end) - Date.parse(c.start)])).toEqual([['ring', HOUR]]));
  });

  it('quiet mode: the whole day only, in words (no digits on screen or in labels)', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    await dispatch('log.stepsCorrection', { start: new Date(dayStart + 8 * HOUR).toISOString(), end: new Date(dayStart + 9 * HOUR).toISOString(), use: 'phone' });
    await settleCommits();
    const { container } = render(<StepsCorrections hours={hours} nowMs={Date.now()} />);
    await screen.findByText('Phone for part of the day');
    expect(screen.queryByRole('radio', { name: CORRECT_WORDS.someHours })).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
    for (const el of container.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(/\d/);
  });

  it('names a correction by its source and span', () => {
    const day = { startMs: 0, endMs: 24 * HOUR };
    expect(correctionText({ startMs: 0, endMs: 24 * HOUR, use: 'ring' }, day, false)).toBe('Ring for the whole day');
    expect(correctionText({ startMs: 8 * HOUR, endMs: 9 * HOUR, use: 'phone' }, day, true)).toBe('Phone for part of the day');
    expect(correctionText({ startMs: 8 * HOUR, endMs: 9 * HOUR, use: 'phone' }, day, false)).toMatch(/^Phone · /);
  });
});
