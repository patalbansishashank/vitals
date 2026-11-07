import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { dispatch } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { formatBytes } from '@/components';
import { StorageCard, storageRows, type StorageUsage } from '../StorageCard';

beforeEach(() => freshState());

describe('Storage', () => {
  it('shows the five largest collections and accounts for every remaining byte, including the cache', () => {
    const collections = Object.fromEntries(
      ['messages', 'scenarios', 'dailyLogs', 'recipes', 'measurements', 'profile'].map((id, i) => [
        id,
        { docs: 1, bytes: (6 - i) * 100 },
      ]),
    );
    const usage: StorageUsage = { engine: 'idb', collections, bootCacheBytes: 300, totalBytes: 2400 };
    const rows = storageRows(usage);
    expect(rows.map((r) => r.label)).toEqual([
      'Coach messages',
      'Simulations',
      'Daily logs',
      'Recipes',
      'Measurements',
      'Other and app cache',
    ]);
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
    expect(rows[5]!.valueText).toBe(formatBytes(400));
  });

  it('an empty store has no invented collection or quota', () => {
    expect(storageRows({ engine: 'memory', collections: {}, bootCacheBytes: 0, totalBytes: 0 })).toEqual([]);
  });

  it('reads data.usage and refreshes after a document is saved', async () => {
    render(
      <MemoryRouter>
        <StorageCard privacy="Saved on this device." />
      </MemoryRouter>,
    );
    await screen.findByText('On this device');
    await act(async () => {
      await dispatch('settings.update', { patch: { units: 'imperial' } });
    });
    const usage = await dispatch('data.usage', {});
    expect(usage.ok).toBe(true);
    if (!usage.ok || !('output' in usage)) throw new Error('Storage estimate failed');
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: `Storage on this device: ${formatBytes(usage.output.totalBytes)}` }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Preferences')).toBeInTheDocument();
  });
});
