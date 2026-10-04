/** The shared Companion fixture manifest (7 tools), for tests. */
import raw from '../../../packages/companion/fixtures/tool-manifest.json?raw';
import type { ToolManifest } from '../manifest';

export function fixtureManifest(): ToolManifest {
  return JSON.parse(raw) as ToolManifest;
}
