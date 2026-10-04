// @vitest-environment node
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import {
  buildToolManifest,
  canonicalJson,
  confirmClassOf,
  ManifestError,
  mustStage,
  parseToolManifest,
  portableSchema,
  toMcpTools,
  toolNameOf,
  toolsFor,
  type ToolManifest,
} from './toolManifest.ts';

const fixtureJson = JSON.parse(readFileSync(new URL('../fixtures/tool-manifest.json', import.meta.url), 'utf8')) as ToolManifest;

describe('tool names (SUITE_SPEC §1.8)', () => {
  it('maps command ids to snake_case tool names', () => {
    expect(toolNameOf('log.mealFromPhoto')).toBe('log_meal_from_photo');
    expect(toolNameOf('today.get')).toBe('today_get');
    expect(toolNameOf('catalogue.searchFoods')).toBe('catalogue_search_foods');
    expect(() => toolNameOf(`log.${'x'.repeat(70)}`)).toThrow(ManifestError);
  });

  it('derives the confirmation class from perm and impact', () => {
    expect(confirmClassOf('read')).toBe('read');
    expect(confirmClassOf('write')).toBe('log');
    expect(confirmClassOf('write', 'consequential')).toBe('edit');
    expect(confirmClassOf('destructive')).toBe('destructive');
  });
});

describe('manifest', () => {
  it('the fixture parses and its hash is the hash of its canonical tools', async () => {
    const m = await parseToolManifest(fixtureJson);
    expect(m.hash).toBe(fixtureJson.hash);
    expect(m.tools.map((t) => t.name)).toEqual(['log_get', 'log_measurement', 'nav_open', 'plan_end', 'plan_shift', 'settings_update', 'today_get']);
  });

  it('is independent of registration order and drops idempotencyKey from inputs', async () => {
    const a = { id: 'log.weight', title: 'W', description: 'd', perm: 'write' as const, surfaces: ['mcp' as const],
      input: { type: 'object', properties: { kg: { type: 'number' }, idempotencyKey: { type: 'string' } }, required: ['kg', 'idempotencyKey'], additionalProperties: false } };
    const b = { id: 'today.get', title: 'T', description: 'd', perm: 'read' as const, surfaces: ['mcp' as const], input: { type: 'object', properties: {} } };
    const m1 = await buildToolManifest([a, b]);
    const m2 = await buildToolManifest([b, a]);
    expect(m1.hash).toBe(m2.hash);
    expect(m1.tools[0]!.inputSchema).toEqual({ type: 'object', properties: { kg: { type: 'number' } }, required: ['kg'], additionalProperties: false });
    expect(m1.tools[0]!.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    expect(m1.tools[0]!.idempotency).toBe('key');
  });

  it('rejects tampered or malformed manifests', async () => {
    await expect(parseToolManifest({ ...fixtureJson, hash: 'f'.repeat(64) })).rejects.toThrow(/hash/);
    await expect(parseToolManifest({ ...fixtureJson, format: 'other/1' })).rejects.toThrow(ManifestError);
    const relabelled = structuredClone(fixtureJson);
    relabelled.tools.find((t) => t.id === 'plan.end')!.confirm = 'read';
    await expect(parseToolManifest({ ...relabelled, hash: undefined })).rejects.toThrow(/confirm/);
    const renamed = structuredClone(fixtureJson);
    renamed.tools[0]!.name = 'something_else';
    await expect(parseToolManifest({ ...renamed, hash: undefined })).rejects.toThrow(/name/);
    const dup = structuredClone(fixtureJson);
    dup.tools.push(dup.tools[0]!);
    await expect(parseToolManifest({ ...dup, hash: undefined })).rejects.toThrow(/duplicate/);
  });

  it('canonical JSON sorts keys and skips undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });
});

describe('external agents (SUITE_SPEC §1.4, §7.3)', () => {
  it('never see destructive tools or tools not listed for their surface', async () => {
    const m = await parseToolManifest(fixtureJson);
    expect(toolsFor(m, 'mcp').map((t) => t.name)).toEqual(['log_get', 'log_measurement', 'plan_shift', 'today_get']);
    expect(toolsFor(m, 'webmcp').map((t) => t.name)).toEqual(['log_get', 'log_measurement', 'nav_open', 'plan_shift', 'today_get']);
  });

  it('stage consequential writes as proposals', async () => {
    const m = await parseToolManifest(fixtureJson);
    const byName = new Map(m.tools.map((t) => [t.name, t]));
    expect(mustStage(byName.get('plan_shift')!)).toBe(true);
    expect(mustStage(byName.get('log_measurement')!)).toBe(false);
    const mcp = toMcpTools(m);
    expect(mcp.map((t) => t.name)).toEqual(['log_get', 'log_measurement', 'plan_shift', 'today_get']);
    expect(mcp.find((t) => t.name === 'plan_shift')!.description).toMatch(/Staged/);
    expect(mcp.find((t) => t.name === 'today_get')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });

  it('lists an outputSchema only when it is an object schema (MCP rule; OpenCode drops the server otherwise)', async () => {
    const m = await parseToolManifest(fixtureJson);
    const withArray = { ...m, tools: m.tools.map((t) => (t.name === 'log_get' ? { ...t, outputSchema: { type: 'array', items: { type: 'object' } } } : t.name === 'today_get' ? { ...t, outputSchema: { type: 'object', properties: {} } } : t)) };
    const mcp = toMcpTools(withArray);
    expect(mcp.find((t) => t.name === 'log_get')!.outputSchema).toBeUndefined();
    expect(mcp.find((t) => t.name === 'today_get')!.outputSchema).toEqual({ type: 'object', properties: {} });
    for (const t of mcp) if (t.outputSchema) expect((t.outputSchema as { type?: unknown }).type).toBe('object');
    const staged = { ...m, tools: m.tools.map((t) => (t.name === 'plan_shift' ? { ...t, outputSchema: { type: 'object', properties: {} } } : t)) };
    expect(toMcpTools(staged).find((t) => t.name === 'plan_shift')!.outputSchema).toBeUndefined();
  });
});

describe('schemas as MCP clients read them', () => {
  // T.Tuple([T.Number(), T.Number()]) as the app writes it (draft 2020-12)
  const band = { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false, minItems: 2, maxItems: 2 };
  const profileOut = { type: 'object', properties: { estimate: { type: 'object', properties: { bmi: { type: 'number' }, maintenanceBand80: band }, required: ['bmi', 'maintenanceBand80'], additionalProperties: false } }, required: ['estimate'], additionalProperties: false };
  // what the MCP SDK's Client checks structuredContent with (Ajv, draft-07)
  const clientCheck = (schema: Record<string, unknown>, data: unknown) => new AjvJsonSchemaValidator().getValidator(schema)(data).valid;

  it('the 2020-12 tuple fails the SDK client check, the portable one passes and still bounds the length (profile_get over MCP)', () => {
    const answer = { estimate: { bmi: 27.1, maintenanceBand80: [1912, 2607] } };
    expect(clientCheck(profileOut, answer)).toBe(false);
    const portable = portableSchema(profileOut);
    expect(JSON.stringify(portable)).not.toContain('prefixItems');
    expect(clientCheck(portable, answer)).toBe(true);
    expect(clientCheck(portable, { estimate: { bmi: 27.1, maintenanceBand80: [1912] } })).toBe(false);
    expect(clientCheck(portable, { estimate: { bmi: 27.1, maintenanceBand80: ['a', 'b'] } })).toBe(false);
  });

  it('keeps every item type of a mixed tuple, inside lists and nullable branches, and leaves other nodes as they are', () => {
    const mixed = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }, { type: 'string' }], items: false, minItems: 3, maxItems: 3 };
    const s = { type: 'object', properties: { a: { anyOf: [mixed, { type: 'null' }] }, b: { type: 'array', items: band }, c: { type: 'string' } }, additionalProperties: false };
    const p = portableSchema(s) as { properties: Record<string, { anyOf?: unknown[]; items?: unknown }> };
    expect(p.properties.a!.anyOf![0]).toEqual({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, minItems: 3, maxItems: 3 });
    expect(p.properties.b!.items).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
    expect(p.properties.c).toBe(s.properties.c);
    const plain = { type: 'object', properties: { x: { type: 'array', items: { type: 'number' } } } };
    expect(portableSchema(plain)).toBe(plain);
  });

  it('toMcpTools lists portable output schemas (input schemas stay as the app wrote them; the app checks inputs)', async () => {
    const m = await parseToolManifest(fixtureJson);
    const input = { type: 'object', properties: { days: band } };
    const withTuple = { ...m, tools: m.tools.map((t) => (t.name === 'today_get' ? { ...t, inputSchema: input, outputSchema: profileOut } : t)) };
    const today = toMcpTools(withTuple).find((t) => t.name === 'today_get')!;
    expect(JSON.stringify(today.outputSchema)).not.toContain('prefixItems');
    expect(today.inputSchema).toEqual(input);
    expect(clientCheck(today.outputSchema!, { estimate: { bmi: 1, maintenanceBand80: [1, 2] } })).toBe(true);
  });
});
