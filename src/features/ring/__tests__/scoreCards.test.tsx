/** Scores keep their named source, missing inputs and quiet form in day and period cards. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { VitalsIndexHistory } from '../history';
import type { RingIndex, RingScores } from '../indices';
import { VitalsScoreCards } from '../views/ScoreCards';
import { expectWordsOnly } from './screenKit';

const index = (id: RingIndex['id'], value: number | null): RingIndex => ({ id, label: id, value, confidence: 'low', contributors: [{ id: 'hrv', label: 'HRV vs usual', score: 70, weight: 25, applied: 0.25, context: false }], version: 'recovery-index/6', needs: value === null ? 'needs 3 more nights' : null });
const scores = (value: number | null = 70): RingScores => ({ source: 'vitals', recovery: index('recovery', value), sleep: index('sleep', value), activity: index('activity', value), day: { value, confidence: 'low', basedOn: 3, effectiveSleepShare: 0.46, contributors: [], version: 'day-index/1', reason: null }, learning: null });
const history: VitalsIndexHistory = { from: '2026-10-28', dates: ['2026-10-28', '2026-10-29', '2026-10-30'], recovery: [50, NaN, 90], sleep: [60, NaN, 80], activity: [40, NaN, 60], day: [50, NaN, 70], versions: { recovery: ['recovery-index/6'], sleep: ['sleep-index/5'], activity: ['activity-index/4'], day: ['day-index/1'] }, reduced: false };
const show = (props: Parameters<typeof VitalsScoreCards>[0]) => render(<MemoryRouter><VitalsScoreCards {...props} /></MemoryRouter>);

it('missing inputs show the reason, never a zero score', () => {
  show({ scores: scores(null), history: null, quiet: false });
  expect(screen.getAllByText('needs 3 more nights')).toHaveLength(3);
  expect(screen.queryByRole('img', { name: /0 of 100/ })).toBeNull();
  expect(document.querySelectorAll('[data-missing]')).toHaveLength(3);
});

it('period heroes average only measured days and keep a missing day empty', () => {
  show({ scores: scores(), history, quiet: false, period: true });
  const recovery = screen.getByRole('heading', { name: 'Vitals Recovery' }).closest('section')!;
  expect(within(recovery).getByRole('img', { name: 'Vitals Recovery 70 of 100' })).toBeInTheDocument();
  expect(within(recovery).getByText('Avg 70 · 2 d')).toBeInTheDocument();
  const bars = recovery.querySelectorAll('.lmz-bars__bar');
  expect(bars).toHaveLength(2);
});

it('legacy values explicitly name Gauge and do not borrow Vitals history', () => {
  show({ scores: { ...scores(), source: 'legacy' }, history, quiet: false });
  expect(screen.getByRole('heading', { name: 'On-device (legacy) Recovery' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Vitals Recovery' })).toBeNull();
  expect(document.querySelector('.lmz-line')).toBeNull();
});

it('quiet score cards and the contributor panel contain words only, including aria', () => {
  show({ scores: scores(), history, quiet: true });
  for (const card of document.querySelectorAll<HTMLElement>('.lm-gcard')) expectWordsOnly(card);
  fireEvent.click(screen.getByRole('button', { name: 'What went into Recovery' }));
  const panel = screen.getByRole('dialog', { name: 'What went into Recovery' });
  expectWordsOnly(panel);
  expect(within(panel).getByText('A main part')).toBeInTheDocument();
});
