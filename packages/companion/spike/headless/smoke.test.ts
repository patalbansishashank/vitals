// Step 0: does the command registry import at all in plain Node (no jsdom)?
import { expect, it } from 'vitest';

it('imports the command bus in Node', async () => {
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const c = await import('@/commands');
  const ms = performance.now() - t0;
  console.log(`[R17] import @/commands: ${ms.toFixed(0)} ms, +${((process.memoryUsage().rss - rss0) / 2 ** 20).toFixed(0)} MiB, ${c.allCommands().length} commands`);
  expect(c.allCommands().length).toBeGreaterThan(50);
});
