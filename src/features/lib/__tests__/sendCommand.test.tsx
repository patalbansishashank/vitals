/** sendCommand: a command sent from a screen that does not go through is shown in plain words; the result comes back. */
import { act, render, screen } from '@testing-library/react';
import { Toaster } from '@/components/Toast';
import { freshState } from '@/commands/__tests__/harness';
import { SAVE_FAILED_NOTICE } from '@/commands/types';
import { useSettingsStore } from '@/state/settingsStore';
import '@/commands';
import { failureMessage, GENERIC_FAILURE, sendCommand, setCommandFailureNotifier } from '../sendCommand';

beforeEach(() => {
  freshState();
});
afterEach(() => setCommandFailureNotifier(null));

describe('sendCommand', () => {
  it('sends the command and shows nothing when it goes through', async () => {
    const shown = vi.fn();
    setCommandFailureNotifier(shown);
    const r = await sendCommand('settings.update', { patch: { units: 'imperial' } });
    expect(r.ok).toBe(true);
    expect(useSettingsStore.getState().units).toBe('imperial');
    expect(shown).not.toHaveBeenCalled();
  });

  it('shows the reason in the live region when the command is refused, and resolves with the failed result', async () => {
    render(<Toaster />);
    let r: Awaited<ReturnType<typeof sendCommand>> | undefined;
    await act(async () => {
      r = await sendCommand('settings.update', { patch: { units: 'furlongs' } } as never);
    });
    expect(r?.ok).toBe(false);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('That value wasn’t accepted.');
    expect(status.textContent).not.toMatch(/Invalid input|\/patch/);
  });

  it('a thrown dispatch becomes a failed result with a plain message, never a rejection', async () => {
    const shown = vi.fn();
    setCommandFailureNotifier(shown);
    const r = await sendCommand('no.such.command' as never, {} as never);
    expect(r.ok).toBe(false);
    expect(shown).toHaveBeenCalledWith(GENERIC_FAILURE);
  });

  it('silent: returns the failure without showing it', async () => {
    const shown = vi.fn();
    setCommandFailureNotifier(shown);
    const r = await sendCommand('settings.update', { patch: { units: 'furlongs' } } as never, { silent: true });
    expect(r.ok).toBe(false);
    expect(shown).not.toHaveBeenCalled();
  });

  it('keeps messages written for people and hides the ones written for developers', () => {
    expect(failureMessage({ code: 'safety_blocked', message: 'Not with your safety answers.' })).toBe('Not with your safety answers.');
    expect(failureMessage({ code: 'precondition_failed', message: 'Set up your body first.' })).toBe('Set up your body first.');
    expect(failureMessage({ code: 'internal', message: 'TypeError: x is undefined' })).toBe(GENERIC_FAILURE);
    expect(failureMessage({ code: 'internal', message: SAVE_FAILED_NOTICE })).toBe(SAVE_FAILED_NOTICE);
    expect(failureMessage({ code: 'invalid_input', message: 'Invalid input: /patch/units must be one of' })).toBe('That value wasn’t accepted.');
    expect(failureMessage({ code: 'not_found', message: 'Unknown command "x".' })).toBe(GENERIC_FAILURE);
    expect(failureMessage({ code: 'cancelled', message: 'Cancelled.' })).toBeNull();
    expect(failureMessage({ code: 'conflict', message: '' })).toBe(GENERIC_FAILURE);
  });
});
