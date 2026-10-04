/**
 * Parity test (SUITE_SPEC §1.10, required green for release).
 *
 * 1. UI census (static): every literal command id the screens pass to `dispatch` / `dispatchSync` / `useCommand` /
 *    `<CommandButton command>` (TypeScript compiler API); a non-literal id fails.
 * 2. No bypass (static): store internals and `transact` only where the spec allows them.
 * 3. No bypass (dynamic): the screen suites run with the strict-store guard on (checked here).
 * 4. Registry closure: census ⊆ registry; UI commands are used or say why not; every command without the `ai` surface
 *    says why, and the reviewed `ai-excluded.json` equals that set.
 * 5. Tool closure: the manifest per surface equals the registry filtered by surface; OpenAI (plain, strict, namespaced)
 *    and Anthropic projections build for every tool; each fixture validates against the original schema and the strict
 *    projection; the manifest JSON and `TOOLSET_HASH` are snapshot-tested.
 * 6. Behavioural parity: three flows (edit profile, edit a schedule day, run a simulation) give identical documents from
 *    the UI path and the tool path (AI with the approval mocked as the person applying the proposal).
 * 7. Docs: descriptions pass the copy guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { patchProfile } from '@/features/body/commands';
import { editSchedule, templatePatch } from '@/features/simulator/commands';
import { dayTemplate } from '@/features/simulator/lib/ops';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { guardMode } from '@/state/scope';
import { useScheduleStore } from '@/state/scheduleStore';
import { useRunScenario, useSimulationStore } from '@/state/simulationStore';
import { getSimulationClient } from '@/workers/simulationClient';
import { allCommands, dispatch, jobs, manifest, settleCommits, type Actor, type CommandResult, type Surface } from '..';
import { toAnthropicTools } from '../adapters/anthropic';
import { fromStrictInput, strictSchema, toOpenAIChatTools, toOpenAIResponsesTools, NotStrict } from '../adapters/openai';
import { manifestSummary, toolsetHash } from '../manifest';
import { Value, type JsonSchema } from '../schema';
import aiExcluded from './ai-excluded.json';
import { AI, freshState } from './harness';
import type { instantClient } from './harness';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === '__fixtures__') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const DISPATCHERS = new Set(['dispatch', 'dispatchSync', 'useCommand', 'sendCommand']);

/** Literal command ids passed by UI code; non-literal ones are reported. */
function census(files: readonly string[]): { ids: Set<string>; nonLiteral: string[] } {
  const ids = new Set<string>();
  const nonLiteral: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!/dispatch|useCommand|CommandButton|sendCommand/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // the bus's dispatchers as this file names them (imports from @/commands or @/commands/bus)
    const local = new Set<string>();
    const busNamespaces = new Set<string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      // `sendCommand` (src/features/lib/sendCommand.ts) wraps dispatch for screens (review V1h-09): counted like dispatch
      if (!/^@\/commands(\/bus)?$/.test(st.moduleSpecifier.text) && !/sendCommand$/.test(st.moduleSpecifier.text)) continue;
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) if (DISPATCHERS.has((e.propertyName ?? e.name).text) || e.name.text === 'commandBus') (e.name.text === 'commandBus' ? busNamespaces : local).add(e.name.text);
      if (b && ts.isNamespaceImport(b)) busNamespaces.add(b.name.text);
    }
    if (local.size === 0 && busNamespaces.size === 0 && !/CommandButton/.test(text)) continue;
    const where = (n: ts.Node) => `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const take = (arg: ts.Expression | undefined, n: ts.Node) => {
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) ids.add(arg.text);
      else nonLiteral.push(where(n));
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const isBus =
          (ts.isIdentifier(callee) && local.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) && DISPATCHERS.has(callee.name.text) && ts.isIdentifier(callee.expression) && busNamespaces.has(callee.expression.text));
        if (isBus) take(n.arguments[0], n);
      }
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === 'CommandButton') {
        const attr = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'command');
        const init = attr && ts.isJsxAttribute(attr) ? attr.initializer : undefined;
        take(init && ts.isStringLiteral(init) ? init : undefined, n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { ids, nonLiteral };
}

/** UI code: features, the app shell, components and the state hooks (UI tier); not the store internals. */
const UI_FILES = [
  ...walk(join(SRC, 'features')),
  ...walk(join(SRC, 'app')),
  ...walk(join(SRC, 'components')),
  ...readdirSync(join(SRC, 'state'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => join(SRC, 'state', f)),
];

describe('1–3: census and bypass checks', () => {
  it('collects only literal command ids from UI code', () => {
    const { ids, nonLiteral } = census(UI_FILES);
    expect(nonLiteral).toEqual([]);
    expect(ids.size).toBeGreaterThan(20);
  });

  it('keeps store internals and transactions inside commands, state and the store', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      const allowedInternal = rel.startsWith('commands/') || rel.startsWith('state/');
      if (!allowedInternal && /from ['"]@\/state\/internal\//.test(text)) offenders.push(`${rel}: imports @/state/internal`);
      const allowedTx = rel.startsWith('commands/') || rel.startsWith('state/') || rel.startsWith('store/') || rel.startsWith('sync/');
      if (!allowedTx && /\.transact\(/.test(text)) offenders.push(`${rel}: calls transact`);
    }
    expect(offenders).toEqual([]);
  });

  it('runs the screen suites with the strict-store guard (a write outside a command throws)', () => {
    expect(guardMode()).toBe('strict');
  });
});

describe('4: registry closure', () => {
  it('every UI command id exists; UI commands are used or say why not', () => {
    const { ids } = census(UI_FILES);
    const registry = new Set(allCommands().map((d) => d.id as string));
    expect([...ids].filter((id) => !registry.has(id))).toEqual([]);
    const unexplained = allCommands().filter((d) => d.surfaces.includes('ui') && !ids.has(d.id) && !d.excludedReason?.ui).map((d) => d.id);
    expect(unexplained).toEqual([]);
  });

  it('every command without the ai surface says why, and the reviewed allowlist matches', () => {
    const excluded = allCommands().filter((d) => !d.surfaces.includes('ai'));
    expect(excluded.filter((d) => !d.excludedReason?.ai).map((d) => d.id)).toEqual([]);
    expect(excluded.map((d) => d.id).sort()).toEqual([...aiExcluded].sort());
  });
});

describe('5: tool closure', () => {
  const surfaces: Surface[] = ['ai', 'webmcp', 'mcp'];
  it.each(surfaces)('the %s manifest is the registry filtered by surface', (s) => {
    expect(manifest(s).map((t) => t.commandId)).toEqual(allCommands().filter((d) => d.surfaces.includes(s)).map((d) => d.id));
  });

  it('every tool projects to OpenAI (plain, strict, namespaced) and Anthropic', () => {
    const tools = manifest('ai');
    expect(toOpenAIChatTools(tools)).toHaveLength(tools.length);
    const strict = toOpenAIResponsesTools(tools, { namespace: 'vitals' });
    expect(strict.every((t) => /^[a-z0-9_]{1,64}$/.test(t.name))).toBe(true);
    expect(toAnthropicTools(tools).every((t) => t.input_schema.type === 'object')).toBe(true);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  const fixtures = import.meta.glob('../__fixtures__/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const fixtureOf = (id: string) => fixtures[`../__fixtures__/${id}.json`];

  it('has one fixture per command, valid against the original schema and the strict projection', () => {
    const problems: string[] = [];
    for (const def of allCommands()) {
      const input = fixtureOf(def.id);
      if (input === undefined) {
        problems.push(`${def.id}: no fixture`);
        continue;
      }
      const errs = Value.Errors(def.input, input);
      if (errs.length) problems.push(`${def.id}: ${errs[0]!.path} ${errs[0]!.message}`);
      let strict: JsonSchema | null = null;
      try {
        strict = strictSchema(JSON.parse(JSON.stringify(def.input)) as JsonSchema);
      } catch (e) {
        if (!(e instanceof NotStrict)) throw e;
      }
      if (strict) {
        const filled = fillNulls(input, def.input);
        const serrs = Value.Errors(strict, filled);
        if (serrs.length) problems.push(`${def.id} (strict): ${serrs[0]!.path} ${serrs[0]!.message}`);
        expect(fromStrictInput(filled, def.input)).toEqual(input);
      }
    }
    expect(problems).toEqual([]);
  });

  it('snapshots the manifest and the toolset hash', async () => {
    await expect(`${JSON.stringify(manifestSummary(), null, 1)}\n`).toMatchFileSnapshot('./__snapshots__/tool-manifest.json');
    await expect(toolsetHash()).toMatchFileSnapshot('./__snapshots__/TOOLSET_HASH.txt');
  });
});

/** What the strict projection makes a model send: every optional property present, null when unused. */
function fillNulls(v: unknown, s: JsonSchema): unknown {
  if (s.anyOf) {
    const alt = s.anyOf.find((a) => Value.Errors(a, v, 1).length === 0) ?? s.anyOf[0]!;
    return fillNulls(v, alt);
  }
  if (Array.isArray(v)) return v.map((x, i) => (s.prefixItems?.[i] ? fillNulls(x, s.prefixItems[i]!) : s.items && typeof s.items === 'object' ? fillNulls(x, s.items) : x));
  if (v && typeof v === 'object' && s.properties && s.additionalProperties === false) {
    const out: Record<string, unknown> = {};
    for (const [k, ps] of Object.entries(s.properties)) {
      const x = (v as Record<string, unknown>)[k];
      out[k] = x === undefined ? null : fillNulls(x, ps);
    }
    return out;
  }
  return v;
}

describe('6: behavioural parity (UI path = tool path)', () => {
  const strip = (doc: Record<string, unknown> | null) => {
    if (!doc) return doc;
    const b = bodyOf(doc);
    delete b.updatedAt;
    delete b.at;
    return b;
  };

  /** Through the Anthropic tool shape as the AI; consequential edits are applied by the person (mocked approval). */
  async function viaTool(id: string, input: unknown, actor: Actor = AI): Promise<CommandResult> {
    const tool = manifest('ai').find((t) => t.commandId === id)!;
    expect(toAnthropicTools([tool])[0]!.input_schema).toBeTruthy();
    const r = await dispatch(id, JSON.parse(JSON.stringify(input)), { actor, idempotencyKey: `${actor.conversationId}:${id}` });
    if (r.ok && 'pending' in r) return dispatch('coach.applyPending', { pendingId: r.pending.pendingId });
    return r;
  }

  async function bothPaths<T>(seed: () => void, ui: () => void | Promise<void>, tool: () => Promise<unknown>, read: () => T): Promise<[T, T]> {
    freshState({ cleared: true });
    seed();
    await ui();
    await settleCommits();
    const a = read();
    freshState({ cleared: true });
    seed();
    await tool();
    await settleCommits();
    return [a, read()];
  }

  beforeEach(() => freshState({ cleared: true }));

  it('edit profile', async () => {
    const [a, b] = await bothPaths(
      () => undefined,
      () => patchProfile({ weightKg: 84, heightCm: 179, habits: { typicalSteps: 9500, smoker: undefined }, shape: { belly: 0.3 } }),
      () => viaTool('profile.patch', { weightKg: 84, heightCm: 179, habits: { typicalSteps: 9500, smoker: null }, shape: { belly: 0.3 } }),
      () => strip(getDocumentStore().peek('profile', 'me')),
    );
    expect(a).toMatchObject({ weightKg: 84, heightCm: 179, shape: { belly: 0.3 }, habits: { typicalSteps: 9500 } });
    expect(b).toEqual(a);
  });

  it('edit a schedule day', async () => {
    const recipe = (t: Parameters<typeof dayTemplate>[0]['programs'][number]) => ({ ...t, steps: 12500, energy: { kind: 'pctMaintenance' as const, pct: 85 } });
    const sid = () => useScheduleStore.getState().activeId!;
    const [a, b] = await bothPaths(
      () => undefined,
      () => {
        // what the day editor does: the recipe as a patch of the shown day, then one scenario.edit
        const s = useScheduleStore.getState().scenarios.find((x) => x.id === sid())!.schedule;
        editSchedule(sid(), [{ op: 'editDays', days: [9], patch: templatePatch(dayTemplate(s, 9), recipe)! }]);
      },
      () => viaTool('scenario.edit', { id: sid(), ops: [{ op: 'editDays', days: [9], patch: { steps: 12500, energy: { kind: 'pctMaintenance', pct: 85 } } }] }),
      () => {
        const d = strip(getDocumentStore().peek('scenarios', sid()));
        return d ? { schedule: d.schedule, started: d.started, name: d.name } : null;
      },
    );
    expect((a!.schedule as { days: Array<{ override?: { steps?: number } }> }).days[9]!.override?.steps).toBe(12500);
    expect(b).toEqual(a);
  });

  it('run a simulation (the hook and the command run the same engine inputs)', async () => {
    const client = () => getSimulationClient() as ReturnType<typeof instantClient>;
    const sid = () => useScheduleStore.getState().activeId!;
    const inputs: unknown[] = [];
    const [a, b] = await bothPaths(
      () => undefined,
      async () => {
        const { result } = renderHook(() => useRunScenario(sid()));
        act(() => result.current.run());
        // a read waits for writes still landing before it starts its job (Q3-J5-10), so the job may start a tick later
        await vi.waitFor(() => expect(client().runs.length).toBeGreaterThan(0));
        await waitJobs();
        inputs.push(client().runs[0]);
      },
      async () => {
        const r = await viaTool('sim.run', { scenarioId: sid() });
        if (r.ok && 'job' in r) await jobs.wait(r.job.jobId);
        await vi.waitFor(() => expect(getDocumentStore().peek('derived', `sim:${sid()}`)).toBeTruthy());
        inputs.push(client().runs[0]);
      },
      () => {
        const last = useSimulationStore.getState().lastRuns[sid()];
        const doc = strip(getDocumentStore().peek('derived', `sim:${sid()}`));
        return { hash: last?.hash, doc };
      },
    );
    expect(a.hash).toBeTruthy();
    expect(b).toEqual(a);
    expect(inputs[1]).toEqual(inputs[0]);
  });
});

async function waitJobs() {
  for (const j of jobs.list()) if (j.state === 'running') await jobs.wait(j.jobId);
}

describe('7: copy guard', () => {
  it('descriptions and titles carry no dossier numbers, section marks or package ids', () => {
    const bad = /dossier|§|\bR-[A-Z]|\bWP\d|MODEL_SPEC/;
    expect(allCommands().filter((d) => bad.test(d.description) || bad.test(d.title)).map((d) => d.id)).toEqual([]);
    expect(allCommands().filter((d) => d.description.length > 600 || d.title.length > 60).map((d) => d.id)).toEqual([]);
  });
});
