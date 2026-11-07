import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { reviewSheetModel } from '@/living/activityCandidates';
import { ActivityDataProvider } from '../../activity/data';
import { renderLiving } from '../../testing';
import { dayFixture, fixtureActivityData, commandsFixture } from '../__screens__/fixtures';
import { cumulativeEnergy, EnergyContent, StepsContent, HeartPointsContent } from '../cards/ActivityCards';
import { COMPONENT_LABEL, COMPONENT_ORDER } from '../../energy/model';
import { expectWordsOnly } from '../../__tests__/wordsOnly';
import { useRecordActivity } from '../useRecordActivity';
const DATE = '2026-10-30';
const NOW = Date.parse(`${DATE}T13:00:00`);
function fixture(quiet = false) {
  const f = dayFixture(DATE, NOW, 'pending');
  const data = fixtureActivityData(f, { quiet, commands: commandsFixture(f) });
  const props = {
    date: DATE,
    isToday: true,
    quiet,
    review: reviewSheetModel([], { quiet }),
    onOpenRow: () => undefined,
    nowMs: NOW,
  };
  return { data, props };
}
describe('r071 independent activity cards', () => {
  it('the cumulative curve pro-rates now and conserves the complete day', () => {
    const bins15 = [
      { start: 0, kcal: 20 },
      { start: 900000, kcal: 40 },
      { start: 1800000, kcal: 10 },
      { start: 2700000, kcal: 10 },
    ] as Parameters<typeof cumulativeEnergy>[0]['bins15'];
    expect(cumulativeEnergy({ bins15 }, 1350000).past.at(-1)).toEqual({ t: 1350000, v: 30 });
    expect(cumulativeEnergy({ bins15 }, Infinity).past.at(-1)?.v).toBe(80);
  });
  it('Energy opens the dated page and keeps explanation, ranges and removal in its info panel', async () => {
    const { data, props } = fixture();
    const remove = vi.fn();
    renderLiving(
      <ActivityDataProvider value={data}>
        <EnergyContent {...props} onRemove={remove} />
      </ActivityDataProvider>,
      { path: '/today', route: 'today' },
    );
    expect(screen.getByRole('link', { name: 'Energy' })).toHaveAttribute('href', '/energy');
    const card = screen.getByRole('region', { name: 'Energy' });
    expect(card).toHaveTextContent(/Likely \d/);
    expect(within(card).queryByText('Estimated, with likely ranges.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About Energy' }));
    const panel = await screen.findByRole('dialog', { name: 'Energy' });
    expect(panel).toHaveTextContent(/Estimated, with likely ranges/);
    fireEvent.click(within(panel).getByRole('button', { name: /Remove from Today/ }));
    expect(remove).toHaveBeenCalledOnce();
  });
  it('Energy by kind keeps its seven ledger terms in the table while collapsing displayed zero rows', async () => {
    const { data, props } = fixture();
    renderLiving(
      <ActivityDataProvider value={data}>
        <EnergyContent {...props} kinds />
      </ActivityDataProvider>,
      { path: '/today', route: 'today' },
    );
    const card = screen.getByRole('region', { name: 'Energy by kind' });
    const parts = within(card).getByRole('list', { name: 'Energy components' });
    expect(within(parts).getByText('Walking')).toBeInTheDocument();
    expect(within(parts).queryByText('Walking outside activities')).toBeNull();
    expect(within(parts).getAllByRole('listitem').length).toBeLessThan(COMPONENT_ORDER.length);
    for (const row of within(parts).getAllByRole('listitem')) {
      expect(row.querySelector('.lm-overflow')).toBeInTheDocument();
      expect(row.querySelector('.lm-overflow')!.textContent).toMatch(/^~[\d,]+ kcal$/);
    }
    expect(within(card).queryByText(/Not counted today/)).toBeNull();
    const forecast = card.querySelector('.lm-cardfoot__right')!;
    expect(forecast).toHaveTextContent(/^By bedtime ~[\d,]+ kcal$/);
    fireEvent.click(within(card).getByRole('button', { name: 'About Energy by kind' }));
    const panel = await screen.findByRole('dialog', { name: 'Energy by kind' });
    const table = within(panel).getByRole('region', { name: 'Energy figures and components table' });
    for (const id of COMPONENT_ORDER) expect(within(table).getByRole('row', { name: new RegExp(COMPONENT_LABEL[id].replace(/[()]/g, '\\$&')) })).toBeInTheDocument();
  });
  it('Steps keeps its goal meter and opens the source panel', async () => {
    const { data, props } = fixture();
    renderLiving(
      <ActivityDataProvider value={data}>
        <StepsContent {...props} />
      </ActivityDataProvider>,
      { path: '/today', route: 'today' },
    );
    expect(screen.getByRole('meter', { name: 'Steps' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Steps by source' }));
    expect(await screen.findByRole('dialog', { name: 'Steps by source' })).toBeInTheDocument();
  });
  it('quiet compact desktop cards retain the Steps meter without digits in the DOM or accessible labels', () => {
    const { data, props } = fixture(true);
    renderLiving(
      <ActivityDataProvider value={data}>
        <StepsContent {...props} size="tile" />
        <HeartPointsContent {...props} />
        <EnergyContent {...props} />
      </ActivityDataProvider>,
      { path: '/today', route: 'today' },
    );
    expect(screen.queryByRole('region', { name: 'Energy' })).toBeNull();
    const stepsMeter = screen.getByRole('meter', { name: 'Steps' });
    expect(stepsMeter).not.toHaveAttribute('aria-valuenow');
    const fill = stepsMeter.querySelector<HTMLElement>('.lmz-track__bar')!;
    expect(Number.parseFloat(fill.style.getPropertyValue('--lit'))).toBeGreaterThan(0);
    expectWordsOnly(screen.getByRole('region', { name: 'Steps' }), 'Steps');
    expectWordsOnly(screen.getByRole('region', { name: 'Heart Points' }), 'Heart Points');
  });
  it('the record deep link opens at page level without an Activities card', async () => {
    const { data } = fixture();
    function PageRecorder() {
      return useRecordActivity({ isToday: true }).sheet;
    }
    const h = renderLiving(
      <ActivityDataProvider value={data}>
        <PageRecorder />
      </ActivityDataProvider>,
      { path: '/today?record=1', route: 'today' },
    );
    expect(await screen.findByRole('dialog', { name: 'Record an activity' })).toBeInTheDocument();
    expect(h.router.state.location.search).toBe('?record=1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(h.router.state.location.search).toBe(''));
  });
  it('consumes a record deep link when a recording is already under way', async () => {
    const f = dayFixture(DATE, NOW, 'recording');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    function PageRecorder() {
      return useRecordActivity({ isToday: true }).sheet;
    }
    const h = renderLiving(
      <ActivityDataProvider value={data}><PageRecorder /></ActivityDataProvider>,
      { path: '/today?record=1', route: 'today' },
    );
    await waitFor(() => expect(h.router.state.location.search).toBe(''));
    expect(screen.queryByRole('dialog', { name: 'Record an activity' })).toBeNull();
  });
});
