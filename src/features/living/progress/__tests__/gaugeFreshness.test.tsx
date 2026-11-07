import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GaugeFreshnessNotice, GaugeFreshnessProvider, useReportGaugeFreshness } from '../components/GaugeFreshness';
import type { GaugeRead } from '../data/gauge';
function Section({ query }: { query: GaugeRead<unknown> }) {
  useReportGaugeFreshness(query.status === 'ready', query);
  return null;
}
function Page({ a, b }: { a: GaugeRead<unknown>; b: GaugeRead<unknown> }) {
  return <GaugeFreshnessProvider><GaugeFreshnessNotice /><Section query={a} /><Section query={b} /></GaugeFreshnessProvider>;
}
it('shows one saved-data cue across sections and clears it after validation or refusal', () => {
  const saved: GaugeRead<unknown> = { status: 'ready', data: {}, cached: true, savedAt: Date.parse('2026-10-31T10:00:00Z') };
  const fresh: GaugeRead<unknown> = { status: 'ready', data: {} };
  const { rerender } = render(<Page a={saved} b={saved} />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Saved ring data · Last checked');
  rerender(<Page a={fresh} b={saved} />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  rerender(<Page a={fresh} b={fresh} />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<Page a={saved} b={saved} />);
  rerender(<Page a={{ status: 'unavailable' }} b={{ status: 'unavailable' }} />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('the Progress page labels deferred saved Steps and Overnight answers once', async () => {
  const [{ renderLiving }, { default: ProgressPage }, { demoGauge }, { setProgressGauge }] = await Promise.all([
    import('../../testing'), import('../ProgressPage'), import('../__fixtures__/activity'), import('../data/gauge'),
  ]);
  const saved = demoGauge();
  const waiting = () => new Promise<never>(() => undefined);
  setProgressGauge({ ...saved, steps: waiting, sleep: waiting, baselines: waiting,
    snapshot: async (load) => ({ data: await load(saved as never), savedAt: Date.parse('2026-10-31T10:00:00Z') }),
  });
  const { result } = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
  const cue = await screen.findByText(/Saved ring data/);
  expect(cue).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Steps', level: 2 })).toBeVisible();
  expect(screen.getAllByText(/Saved ring data/)).toHaveLength(1);
  result.unmount();
  setProgressGauge(null);
});
