// A refused heart-rate change is shown in place (with a retry) and the earlier value stays in force.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { setProgressGauge } from '@/features/living/progress/data/gauge';
import { demoGauge } from '@/features/living/progress/__fixtures__/activity';
import SettingsPage from '../../SettingsPage';
import type * as sendModule from '@/features/lib/sendCommand';
import { readHeartSettings, resetHeartSettings, setHrEvidence } from '../v3Adapter';

const gate = vi.hoisted(() => ({ fail: false }));

vi.mock('@/features/lib/sendCommand', async (orig) => {
  const real = await orig<typeof sendModule>();
  return {
    ...real,
    sendCommand: (async (id: string, input: unknown, opts?: unknown) => {
      if (gate.fail && id === 'settings.update') return { ok: false, error: { code: 'internal', message: 'Could not write.' } };
      return (real.sendCommand as (...a: unknown[]) => unknown)(id, input, opts);
    }) as typeof real.sendCommand,
  };
});

const at = () =>
  render(
    <MemoryRouter initialEntries={['/settings/heart']}>
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  gate.fail = false;
  freshState();
  await resetHeartSettings();
  setProgressGauge(demoGauge());
  act(() => {
    const p = useProfileStore.getState();
    p.setSex('male');
    p.setAge(40);
    p.setHeight(178);
    p.setWeight(84);
  });
});

afterEach(async () => {
  gate.fail = false;
  setHrEvidence(null);
  setProgressGauge(null);
  await resetHeartSettings();
});

describe('Settings › Heart rate: a change that fails', () => {
  it('says so in an alert, keeps the old value, and a retry that goes through clears it', async () => {
    const user = userEvent.setup();
    at();
    const rest = await screen.findByRole('spinbutton', { name: /resting heart rate/i });
    gate.fail = true;
    await user.type(rest, '60{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/wasn’t saved, so the earlier value is still in use/);
    expect(alert).toHaveTextContent(/Couldn’t make that change|Could not write|wasn’t saved/);
    expect(readHeartSettings().hrProfile.hrRestOverride).toBeNull();
    expect(screen.getByRole('spinbutton', { name: /resting heart rate/i })).toHaveValue('');
    // a toggle fails the same way and keeps its position
    const sw = screen.getByRole('switch', { name: 'Heart-rate calories' });
    await user.click(sw);
    expect(sw).toBeChecked();
    expect(readHeartSettings().keytelEnabled).toBe(true);
    // retry once the command works again
    gate.fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('spinbutton', { name: /resting heart rate/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(readHeartSettings().keytelEnabled).toBe(false);
  });

  it('can be dismissed', async () => {
    const user = userEvent.setup();
    at();
    gate.fail = true;
    await user.click(await screen.findByRole('switch', { name: 'Heart-rate calories' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
