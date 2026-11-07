/**
 * Optional measurement facts (C4): a blood-pressure sitting is one paired episode (systolic and diastolic share its id,
 * D4-05) with an optional setting; a ketone reading carries its sample type only when stated (D2-08). Unanswered facts are
 * left out (unknown), never defaulted.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { MeasurementPanel } from './MeasurementPanel';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

describe('MeasurementPanel optional facts', () => {
  it('pairs systolic and diastolic in one episode and sends a stated setting', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<MeasurementPanel open date={FIXTURE_TODAY} initial="bloodPressure" onClose={() => undefined} />, { path: '/x', route: 'x' });
    const log = vi.spyOn(h.stub.actions, 'logMeasurement');
    const panel = await screen.findByRole('dialog');
    await user.type(within(panel).getByRole('spinbutton', { name: 'Systolic' }), '128');
    await user.type(within(panel).getByRole('spinbutton', { name: 'Diastolic' }), '82');
    await user.click(within(panel).getByRole('radio', { name: 'Home' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(2));
    const [sbp, dbp] = [log.mock.calls[0]![1], log.mock.calls[1]![1]];
    expect(sbp).toMatchObject({ metric: 'sbpMmHg', value: 128, setting: 'home' });
    expect(dbp).toMatchObject({ metric: 'dbpMmHg', value: 82, setting: 'home' });
    expect(sbp.episodeId).toBeTruthy();
    expect(dbp.episodeId).toBe(sbp.episodeId);
  });

  it('a ketone reading has no sample type unless one is chosen', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<MeasurementPanel open date={FIXTURE_TODAY} initial="ketones" onClose={() => undefined} />, { path: '/x', route: 'x' });
    const log = vi.spyOn(h.stub.actions, 'logMeasurement');
    const panel = await screen.findByRole('dialog');
    await user.type(within(panel).getByRole('spinbutton', { name: 'Ketones' }), '1.2');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![1]).not.toHaveProperty('specimen');
  });

  it('a stated urine sample is sent as urine (never blood BHB)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<MeasurementPanel open date={FIXTURE_TODAY} initial="ketones" onClose={() => undefined} />, { path: '/x', route: 'x' });
    const log = vi.spyOn(h.stub.actions, 'logMeasurement');
    const panel = await screen.findByRole('dialog');
    await user.type(within(panel).getByRole('spinbutton', { name: 'Ketones' }), '1.2');
    await user.click(within(panel).getByRole('radio', { name: 'Urine' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![1]).toMatchObject({ metric: 'ketonesMmolL', specimen: 'urine' });
  });
});
