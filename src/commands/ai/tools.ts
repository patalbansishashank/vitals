/**
 * The Coach's tools and command port, both from the command registry (SUITE_SPEC §1.8, §5.2): the `ToolRegistry` is
 * built from the app's `vitals.tools/1` manifest for the `ai` surface (`fromManifest` per entry, plus the per-turn
 * limits the manifest does not carry), and the `CommandPort` dispatches through the bus.
 *
 * Not imported by `./index.ts`: the Coach (E9b) loads it with its own chunk.
 *
 *   const registry = createAiToolRegistry();
 *   const runner = new ToolRunner({ registry, port: createBusCommandPort(), now, newId });
 */
import { registryFromManifest } from '@/ai/tools/manifest';
import type { ToolRegistry } from '@/ai/tools/registry';
import { toolManifest } from '../manifest';
import { getCommand } from '../registry';

export { createBusCommandPort, aiIdempotencyKey, toPortResult } from './port';

/** The Coach's tool registry: every `ai`-surface command, named, grouped and rendered from the manifest. */
export function createAiToolRegistry(): ToolRegistry {
  return registryFromManifest(toolManifest('ai'), {
    extras: (id) => {
      const limit = getCommand(id)?.aiLimit;
      return limit ? { aiLimit: limit } : undefined;
    },
  });
}
