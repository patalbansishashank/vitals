import '@/features/charts/test/setupDom';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonProfile, Schedule } from '@/engine';
import { setSimulationClient, type PreviewSeries, type SimulationClient } from '@/workers/simulationClient';
import { MAN, schedule } from '../__tests__/fixtures';
import { SchedulePreview } from './Preview';

type Call = {
  profile: PersonProfile;
  schedule: Schedule;
  resolve: (series: PreviewSeries) => void;
  reject: (reason: unknown) => void;
};

const series = (last: number): PreviewSeries => ({
  fatMass: new Float32Array([20, last]),
  ketosis: new Float32Array([0, 2]),
});

function previewClient() {
  const calls: Call[] = [];
  setSimulationClient({
    preview: (profile, schedule) =>
      new Promise((resolve, reject) => calls.push({ profile, schedule, resolve, reject })),
  } as SimulationClient);
  return calls;
}

async function startPreview() {
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe('SchedulePreview input binding', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setSimulationClient(null);
    vi.useRealTimers();
  });

  it('hides A while B is pending and shows B failure without A values or B date attached to A', async () => {
    const calls = previewClient();
    const a = schedule(14);
    const b = schedule(21, [0], a.programs, '2026-11-01');
    const { container, rerender } = render(<SchedulePreview profile={MAN} schedule={a} cautions={0} />);
    await startPreview();
    await act(async () => calls[0]!.resolve(series(19)));
    expect(screen.getByText('Fat mass')).toBeInTheDocument();
    expect(screen.getByText(/By 18 Oct/)).toBeInTheDocument();

    rerender(<SchedulePreview profile={MAN} schedule={b} cautions={0} />);
    expect(container.querySelector('.sim-preview')).toHaveAttribute('data-pending', 'true');
    expect(screen.queryByText('Fat mass')).toBeNull();
    expect(screen.queryByText(/By 21 Nov/)).toBeNull();
    expect(container.querySelector('.sim-preview__empty')).toBeInTheDocument();

    await startPreview();
    await act(async () => calls[1]!.reject(new Error('worker failed')));
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Fat mass')).toBeNull();
    expect(container.querySelector('.sim-preview__empty')).toBeInTheDocument();
  });

  it('invalidates a success when only the profile changes, including a failed replacement', async () => {
    const calls = previewClient();
    const plan = schedule(14);
    const changed: PersonProfile = { ...MAN, body: { ...MAN.body, weightKg: 90 } };
    const { rerender } = render(<SchedulePreview profile={MAN} schedule={plan} cautions={0} />);
    await startPreview();
    await act(async () => calls[0]!.resolve(series(19)));
    expect(screen.getByText('Fat mass')).toBeInTheDocument();

    rerender(<SchedulePreview profile={changed} schedule={plan} cautions={0} />);
    expect(screen.queryByText('Fat mass')).toBeNull();
    await startPreview();
    expect(calls[1]!.profile.body.weightKg).toBe(90);
    await act(async () => calls[1]!.reject(new Error('worker failed')));
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Fat mass')).toBeNull();
  });

  it('ignores a stale completion and clears a debounced request on dispose', async () => {
    const calls = previewClient();
    const a = schedule(14);
    const b = schedule(21);
    const { rerender, unmount } = render(<SchedulePreview profile={MAN} schedule={a} cautions={0} />);
    await startPreview();
    rerender(<SchedulePreview profile={MAN} schedule={b} cautions={0} />);
    await startPreview();
    await act(async () => calls[0]!.resolve(series(18)));
    expect(screen.queryByText('Fat mass')).toBeNull();
    await act(async () => calls[1]!.resolve(series(19)));
    expect(screen.getByText('Fat mass')).toBeInTheDocument();

    rerender(<SchedulePreview profile={MAN} schedule={a} cautions={0} />);
    unmount();
    await startPreview();
    expect(calls).toHaveLength(2);
  });
});
