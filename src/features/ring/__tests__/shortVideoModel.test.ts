import { describe, expect, it } from 'vitest';
import { displayVideoDay } from '../views/shortVideoModel';
import type { GaugeShortVideoDay } from '../types';

const remote: GaugeShortVideoDay = { date: '2026-10-31', total: 22, counts: { instagram: 15, youtube: 7 }, limit: 30, limitHits: 0, cancels: 0 };
describe('short-video reading source and disabled limits', () => {
  it('uses the current phone count consistently for glance and detail', () => {
    const day = displayVideoDay(remote.date, remote, { enabled: true, dailyLimit: 20, today: { instagram: 7, youtube: 4 } });
    expect(day).toMatchObject({ total: 11, counts: { instagram: 7, youtube: 4 }, limit: 20 });
    expect(remote.total).toBe(22);
  });
  it('retains a disabled native limit even when an older server limit exists', () => {
    expect(displayVideoDay(remote.date, remote, { enabled: false, dailyLimit: 30, today: { instagram: 0, youtube: 0 } }, 30)).toMatchObject({ total: 0, limit: null });
  });
  it('retains explicitly disabled recorded and reported limits', () => {
    expect(displayVideoDay(remote.date, { ...remote, limit: null }, null)?.limit).toBeNull();
    expect(displayVideoDay(remote.date, remote, null, null)?.limit).toBeNull();
  });
  it('keeps an unobserved day missing', () => {
    expect(displayVideoDay(remote.date, null, null, 30)).toBeNull();
  });
});
