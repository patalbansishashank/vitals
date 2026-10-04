/**
 * The tool manifest contract shared with the Companion (SUITE_SPEC §1.8, §7.3). Single source:
 * `packages/companion/src/toolManifest.ts` (no Node or DOM APIs), so the app's WebMCP registration and the Companion's
 * MCP server agree on exactly the same tools.
 */
export * from '../../packages/companion/src/toolManifest.ts';
export * from '../../packages/companion/src/bridgeProtocol.ts';
