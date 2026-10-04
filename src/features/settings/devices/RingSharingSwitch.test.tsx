import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import { sendCommand } from '@/features/lib/sendCommand';
import { RingSharingSwitch, type RingSharing } from './RingSharingSwitch';

// `bio.setRingSharing` and the ring fields on `bio.sources` belong to another package: the bus is faked here
vi.mock('@/features/lib/sendCommand', () => ({ sendCommand: vi.fn() }));
const send = vi.mocked(sendCommand);

let sources: { sources: unknown[]; policies: unknown[]; ringSharing?: RingSharing; ringDefaultsNotice?: unknown };
const ok = (output: unknown) => Promise.resolve({ ok: true as const, output });

beforeEach(() => {
  freshState({ cleared: true });
  sources = { sources: [], policies: [], ringSharing: 'on' };
  send.mockReset();
  send.mockImplementation(((id: string) => ok(id === 'bio.sources' ? sources : {})) as unknown as typeof sendCommand);
});

const ui = () =>
  render(
    <MemoryRouter>
      <RingSharingSwitch />
    </MemoryRouter>,
  );
const sw = () => screen.findByRole('switch', { name: 'Use my ring data in my plan and Coach' });
const calls = (id: string) => send.mock.calls.filter((c) => c[0] === id).map((c) => c[1]);

describe('RingSharingSwitch', () => {
  it('on: checked, with the line saying what is shared and where to turn it off', async () => {
    ui();
    expect(((await sw()) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Your ring data is used for your plan and scores, and the Coach and your AI tools can see it\. Turn it off here or per signal in Settings › Devices\./)).toBeTruthy();
    expect(screen.queryByText(/Some of it is shared/)).toBeNull();
  });

  it('turning it off sends bio.setRingSharing { on: false } and reads the sources again', async () => {
    ui();
    fireEvent.click(await sw());
    await waitFor(() => expect(calls('bio.setRingSharing')).toEqual([{ on: false }]));
    await waitFor(() => expect(calls('bio.sources').length).toBeGreaterThan(1));
  });

  it('off: unchecked, and turning it on sends { on: true }', async () => {
    sources.ringSharing = 'off';
    ui();
    const s = (await sw()) as HTMLInputElement;
    expect(s.checked).toBe(false);
    fireEvent.click(s);
    await waitFor(() => expect(calls('bio.setRingSharing')).toEqual([{ on: true }]));
  });

  it('some: says some of it is shared and links to the per-signal switches', async () => {
    sources.ringSharing = 'some';
    ui();
    await sw();
    expect(screen.getByText(/Some of it is shared\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See each signal' }).getAttribute('href')).toBe('/settings#devices');
  });

  it('is hidden without a ring source, and while the build has no ring field', async () => {
    sources.ringSharing = 'none';
    const a = ui();
    await waitFor(() => expect(calls('bio.sources').length).toBeGreaterThanOrEqual(1));
    await act(() => new Promise((r) => setTimeout(r, 0))); // the answer has been read
    expect(a.container.textContent).toBe('');
    a.unmount();
    send.mockClear();
    delete sources.ringSharing;
    const b = ui();
    await waitFor(() => expect(calls('bio.sources').length).toBeGreaterThanOrEqual(1));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(b.container.textContent).toBe('');
  });

  it('shows the one-time notice and dismisses it', async () => {
    sources.ringDefaultsNotice = true;
    ui();
    expect(await screen.findByText(/Your ring data is now used for your plan and scores/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Your ring data is now used/)).toBeNull();
    expect(calls('bio.dismissRingDefaultsNotice')).toEqual([{}]);
  });

  it('never mentions a password or code', async () => {
    sources.ringSharing = 'some';
    sources.ringDefaultsNotice = true;
    const { container } = ui();
    await sw();
    expect(container.textContent).not.toMatch(/password|passcode|pin\b|key/i);
  });
});
