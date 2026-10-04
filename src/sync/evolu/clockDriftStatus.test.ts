import { describe, expect, it } from 'vitest';
import { withClockDriftStatus } from './adapter';
import type { SyncStatus } from '../types';

const synced: SyncStatus = {
  state: 'synced',
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
  pendingChanges: 0,
  pendingBlobs: 0,
};

describe('clock drift quarantine status', () => {
  it('does not claim synced when local messages are waiting in drift quarantine', () => {
    const s = withClockDriftStatus(synced, 2, 0);
    expect(s.state).toBe('error');
    expect(s.pendingChanges).toBe(2);
    expect(s.lastError?.code).toBe('clock_drift');
    expect(s.lastError?.message).toMatch(/date and time.*restart the app/);
  });

  it('reports received quarantined messages and clears the error when the table empties', () => {
    const waiting = withClockDriftStatus(synced, 0, 1);
    expect(waiting.state).toBe('error');
    expect(waiting.pendingChanges).toBe(0);
    expect(withClockDriftStatus(synced, 0, 0)).toEqual(synced);
  });
});
