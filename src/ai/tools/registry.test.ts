// @vitest-environment node
/** Tool registry (SUITE_SPEC §1.8, R8 §5.1): names, validation, tiers, groups, rendering, manifest hash. */
import { describe, expect, it } from 'vitest';
import { MOCK_COMMANDS } from './__fixtures__/mockCommands';
import { canonicalJson, perTurnLimit, toolNameOf, ToolRegistry } from './registry';
import { aiCommand, confirmClassOf } from './types';

const reg = () => new ToolRegistry(MOCK_COMMANDS);
const simple = (id: string) =>
  aiCommand({ id: id as `${string}.${string}`, title: 't', description: 'd', input: { type: 'object', properties: {} }, confirm: 'read' });

describe('confirmClassOf', () => {
  it('maps perm and impact per SUITE_SPEC §1.4', () => {
    expect(confirmClassOf({ perm: 'read' })).toBe('read');
    expect(confirmClassOf({ perm: 'write', impact: 'low' })).toBe('log');
    expect(confirmClassOf({ perm: 'write' })).toBe('log');
    expect(confirmClassOf({ perm: 'write', impact: 'consequential' })).toBe('edit');
    expect(confirmClassOf({ perm: 'destructive' })).toBe('destructive');
  });
});

describe('tool names', () => {
  it('converts id to snake_case per SUITE_SPEC §1.8', () => {
    expect(toolNameOf('log.mealFromPhoto')).toBe('log_meal_from_photo');
    expect(toolNameOf('sim.whatIf')).toBe('sim_what_if');
    expect(toolNameOf('today.get')).toBe('today_get');
    expect(toolNameOf('catalogue.searchFoods')).toBe('catalogue_search_foods');
  });

  it('looks up by tool name and derives namespace', () => {
    const def = reg().byToolName('log_meal');
    expect(def?.id).toBe('log.meal');
    expect(def?.namespace).toBe('log');
    expect(reg().byToolName('log.meal')).toBeUndefined();
  });

  it('rejects bad ids, namespace mismatch, long names, long descriptions and duplicates', () => {
    expect(() => new ToolRegistry([simple('Log.meal')])).toThrow(/Invalid command id/);
    expect(() => new ToolRegistry([simple('log_meal')])).toThrow(/Invalid command id/);
    expect(() => new ToolRegistry([simple('log.Meal')])).toThrow(/Invalid command id/);
    expect(() => new ToolRegistry([{ ...simple('log.meal'), namespace: 'food' }])).toThrow(/namespace/);
    expect(() => new ToolRegistry([simple(`log.${'a'.repeat(70)}`)])).toThrow(/a-z0-9_/);
    expect(() => new ToolRegistry([{ ...simple('log.meal'), description: 'x'.repeat(601) }])).toThrow(/600/);
    expect(() => new ToolRegistry([simple('log.meal'), simple('log.meal')])).toThrow(/Duplicate/);
  });
});

describe('toolSpecs', () => {
  it('full tier lists every command and omits idempotencyKey from the model schema', () => {
    const specs = reg().toolSpecs();
    expect(specs).toHaveLength(MOCK_COMMANDS.length);
    const meal = specs.find((s) => s.name === 'log_meal')!;
    expect(Object.keys(meal.inputSchema.properties as object)).not.toContain('idempotencyKey');
    expect(meal.inputSchema.required).toEqual(['components', 'method']);
    // The def itself is untouched.
    expect(Object.keys(MOCK_COMMANDS.find((d) => d.id === 'log.meal')!.input.properties as object)).toContain('idempotencyKey');
  });

  it('basic tier keeps only read and log', () => {
    const names = reg().toolSpecs({ tier: 'basic' }).map((s) => s.name);
    expect(names).toContain('today_get');
    expect(names).toContain('log_meal');
    expect(names).not.toContain('plan_shift');
    expect(names).not.toContain('plan_end');
    expect(names).not.toContain('log_bulk');
  });

  it('basic flag overrides the default', () => {
    const r = new ToolRegistry([{ ...simple('sim.whatIf'), basic: false }, { ...simple('plan.shift'), confirm: 'edit', basic: true }]);
    expect(r.toolSpecs({ tier: 'basic' }).map((s) => s.name)).toEqual(['plan_shift']);
  });

  it('filters by groups with extra includes', () => {
    const names = reg().toolSpecs({ groups: ['log'], include: ['today.get'] }).map((s) => s.name);
    expect(names.sort()).toEqual(['log_bulk', 'log_get', 'log_meal', 'log_measurement', 'today_get']);
    const basic = reg().toolSpecs({ tier: 'basic', groups: ['log'] }).map((s) => s.name);
    expect(basic).not.toContain('log_bulk');
  });
});

describe('render', () => {
  it('renders each dialect', () => {
    const chat = reg().render('openai-chat', { strict: true, groups: ['today'] }) as { type: string; function: { name: string; strict?: boolean } }[];
    expect(chat).toEqual([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'today_get', strict: true }) })]);
    const resp = reg().render('openai-responses', { strict: true, namespace: 'vitals', groups: ['plan'] }) as { type: string; name: string; tools: { name: string }[] }[];
    expect(resp[0]!.type).toBe('namespace');
    expect(resp[0]!.name).toBe('vitals');
    expect(resp[0]!.tools.map((t) => t.name)).toEqual(['plan_shift', 'plan_end']);
    const anth = reg().render('anthropic-messages', { tier: 'basic', groups: ['log'] }) as { name: string; input_schema: object }[];
    expect(anth.map((t) => t.name)).toEqual(['log_get', 'log_meal', 'log_measurement']);
    expect(anth[0]).toHaveProperty('input_schema');
  });
});

describe('manifestHash', () => {
  it('is a deterministic SHA-256 independent of def order', async () => {
    const a = await reg().manifestHash();
    const b = await new ToolRegistry([...MOCK_COMMANDS].reverse()).manifestHash();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('changes with description, version and limits', async () => {
    const base = await reg().manifestHash();
    const edit = (patch: object) => new ToolRegistry(MOCK_COMMANDS.map((d) => (d.id === 'today.get' ? { ...d, ...patch } : d))).manifestHash();
    expect(await edit({ description: 'other' })).not.toBe(base);
    expect(await edit({ version: 2 })).not.toBe(base);
    expect(await edit({ aiLimit: { perTurn: 2 } })).not.toBe(base);
  });

  it('canonical JSON sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
  });
});

describe('perTurnLimit', () => {
  it('defaults by class and honours aiLimit', () => {
    const by = (id: string) => perTurnLimit(MOCK_COMMANDS.find((d) => d.id === id)!);
    expect(by('today.get')).toBe(20);
    expect(by('log.meal')).toBe(5);
    expect(by('plan.shift')).toBe(5);
    expect(by('plan.end')).toBe(1);
    expect(by('job.status')).toBe(3);
  });
});
