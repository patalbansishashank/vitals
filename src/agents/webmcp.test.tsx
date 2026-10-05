import { act, render, waitFor } from '@testing-library/react';
import { getAgentActivity, resetAgentActivityForTests, stopAgents } from './activity';
import { setAgentDispatcher } from './dispatcher';
import { toolsFor, type ToolManifest, type ToolResultEnvelope } from './manifest';
import { fixtureManifest } from './testing/fixture';
import { createMockDispatcher } from './testing/mockDispatcher';
import {
  getModelContext,
  isWebMcpEnabled,
  isWebMcpSupported,
  registerWebMcpTools,
  setWebMcpEnabled,
  useWebMcpRegistration,
  webMcpFlag,
  type ModelContextLike,
  type WebMcpToolDescriptor,
} from './webmcp';

const M = fixtureManifest();
const WEBMCP_NAMES = toolsFor(M, 'webmcp').map((t) => t.name);

/** Signal-based registration (current spec draft) plus unregisterTool. */
function fakeModelContext() {
  const tools = new Map<string, WebMcpToolDescriptor>();
  const ctx = {
    tools,
    registerTool: vi.fn((tool: WebMcpToolDescriptor, opts?: { signal?: AbortSignal }) => {
      if (tools.has(tool.name)) throw new Error('duplicate');
      tools.set(tool.name, tool);
      opts?.signal?.addEventListener('abort', () => tools.delete(tool.name));
    }),
    unregisterTool: vi.fn((name: string) => void tools.delete(name)),
  };
  return ctx;
}

function installOnDocument(ctx: ModelContextLike | undefined) {
  Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true, writable: true });
}

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text) as { ok: boolean; status: string; error?: { code: string } };

beforeEach(() => {
  localStorage.clear();
  resetAgentActivityForTests();
  setAgentDispatcher(null);
  installOnDocument(undefined);
  delete (navigator as unknown as { modelContext?: unknown }).modelContext;
});

describe('feature detection', () => {
  it('is unsupported without modelContext', () => {
    expect(isWebMcpSupported()).toBe(false);
    expect(getModelContext()).toBeNull();
  });
  it('finds document.modelContext, then navigator.modelContext', () => {
    const nav = fakeModelContext();
    Object.defineProperty(navigator, 'modelContext', { value: nav, configurable: true });
    expect(getModelContext()).toBe(nav);
    const doc = fakeModelContext();
    installOnDocument(doc);
    expect(getModelContext()).toBe(doc);
  });
});

describe('setting', () => {
  it('defaults off and is stored device-locally outside vitals.*', () => {
    expect(isWebMcpEnabled()).toBe(false);
    setWebMcpEnabled(true);
    expect(webMcpFlag.key).toBe('vitals-agents.webmcp');
    expect(localStorage.getItem('vitals-agents.webmcp')).toBe('true');
    expect(Object.keys(localStorage).some((k) => k.startsWith('vitals.'))).toBe(false);
  });
});

describe('registerWebMcpTools', () => {
  it('registers exactly the webmcp tools with annotations, and unregisters them', () => {
    const ctx = fakeModelContext();
    const unregister = registerWebMcpTools(M, createMockDispatcher(M), ctx);
    expect([...ctx.tools.keys()]).toEqual(WEBMCP_NAMES);
    expect(ctx.tools.has('plan_end')).toBe(false);
    expect(ctx.tools.has('settings_update')).toBe(false);
    const shift = ctx.tools.get('plan_shift')!;
    expect(shift.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(shift.inputSchema).toEqual(M.tools.find((t) => t.name === 'plan_shift')!.inputSchema);
    unregister();
    expect(ctx.tools.size).toBe(0);
  });

  it('execute dispatches with actor webmcp and a fresh idempotency key, staging plan_shift', async () => {
    setWebMcpEnabled(true);
    const ctx = fakeModelContext();
    const d = createMockDispatcher(M);
    registerWebMcpTools(M, d, ctx);
    const r1 = await ctx.tools.get('log_measurement')!.execute({ kind: 'weight', value: 81 });
    const r2 = await ctx.tools.get('plan_shift')!.execute({ days: 1 });
    expect(parse(r1)).toMatchObject({ ok: true, status: 'applied' });
    expect(parse(r2)).toMatchObject({ ok: true, status: 'pending_user' });
    expect(d.calls.map((c) => [c.commandId, c.opts.actor, c.opts.stage])).toEqual([
      ['log.measurement', { kind: 'webmcp', id: 'webmcp' }, false],
      ['plan.shift', { kind: 'webmcp', id: 'webmcp' }, true],
    ]);
    const keys = d.calls.map((c) => c.opts.idempotencyKey);
    expect(keys[0]).toMatch(/^webmcp:/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('hands a needs_choice answer to the agent whole: nothing saved, the candidates, not "applied" (J3-02)', async () => {
    setWebMcpEnabled(true);
    const ctx = fakeModelContext();
    const d = createMockDispatcher(M);
    const asked: ToolResultEnvelope = {
      ok: true,
      status: 'needs_choice',
      saved: false,
      summary: 'Nothing logged yet. Pick one of these foods (or ask the person) and call log_measurement again with its foodId.',
      candidates: [{ component: 'poha', foodId: 'poha_thin', name: 'Poha, thin' }],
    };
    d.respond = () => asked;
    registerWebMcpTools(M, d, ctx);
    const r = await ctx.tools.get('log_measurement')!.execute({ kind: 'weight', value: 81 });
    expect(parse(r)).toEqual(asked);
    expect(r.isError).toBeUndefined();
    expect(getAgentActivity()[0]).toMatchObject({ tool: 'log_measurement', status: 'needs_choice' });
  });

  it('refuses calls after unregistering or while the setting is off', async () => {
    const ctx = fakeModelContext();
    const d = createMockDispatcher(M);
    const unregister = registerWebMcpTools(M, d, ctx);
    const tool = ctx.tools.get('today_get')!;
    const r = await tool.execute({});
    expect(parse(r).error?.code).toBe('surface_forbidden');
    expect(r.isError).toBe(true);
    setWebMcpEnabled(true);
    unregister();
    expect(parse(await tool.execute({})).ok).toBe(false);
    expect(d.calls).toHaveLength(0);
  });

  it('uses a returned {unregister} handle when the API gives one', () => {
    const handles: Array<ReturnType<typeof vi.fn>> = [];
    const ctx: ModelContextLike = {
      registerTool: vi.fn(() => {
        const h = { unregister: vi.fn() };
        handles.push(h.unregister);
        return h;
      }),
    };
    registerWebMcpTools(M, createMockDispatcher(M), ctx)();
    expect(handles).toHaveLength(WEBMCP_NAMES.length);
    handles.forEach((h) => expect(h).toHaveBeenCalledTimes(1));
  });

  it('replaces a stale registration with the same name', () => {
    const ctx = fakeModelContext();
    registerWebMcpTools(M, createMockDispatcher(M), ctx);
    // a second registration without cleanup (e.g. HMR) must not throw and ends with one of each
    registerWebMcpTools(M, createMockDispatcher(M), ctx);
    expect([...ctx.tools.keys()].sort()).toEqual([...WEBMCP_NAMES].sort());
  });
});

/**
 * The shape Chromium 153 ships behind `--enable-features=WebMCP` (probed over CDP in E22): methods on the prototype,
 * `registerTool(tool, {signal})` → `Promise<undefined>` that REJECTS (InvalidStateError) on a duplicate or invalid name
 * or an empty description, no `unregisterTool`, unregister by aborting the signal, `getTools()` → Promise.
 */
class Chromium153ModelContext {
  readonly tools = new Map<string, WebMcpToolDescriptor>();
  ontoolchange: (() => void) | null = null;
  registerTool(tool: WebMcpToolDescriptor, opts?: { signal?: AbortSignal }): Promise<undefined> {
    const invalid = (m: string) => Promise.reject(new DOMException(m, 'InvalidStateError'));
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) return invalid('Invalid tool name');
    if (!tool.description) return invalid('Description is required');
    if (this.tools.has(tool.name)) return invalid('Duplicate tool name');
    if (opts?.signal?.aborted) return Promise.resolve(undefined);
    this.tools.set(tool.name, tool);
    opts?.signal?.addEventListener('abort', () => this.tools.delete(tool.name));
    return Promise.resolve(undefined);
  }
  getTools(): Promise<Array<{ name: string }>> {
    return Promise.resolve([...this.tools.values()].map((t) => ({ name: t.name })));
  }
  executeTool(): Promise<never> {
    return Promise.reject(new TypeError("parameter 1 is not of type 'RegisteredTool'"));
  }
}

describe('Chromium 153 modelContext shape', () => {
  it('is detected on document.modelContext (prototype methods, no unregisterTool)', () => {
    const ctx = new Chromium153ModelContext();
    installOnDocument(ctx as unknown as ModelContextLike);
    expect(getModelContext()).toBe(ctx);
    expect('unregisterTool' in ctx).toBe(false);
  });

  it('registers every webmcp tool, executes through the dispatcher, and unregisters by abort', async () => {
    setWebMcpEnabled(true);
    const ctx = new Chromium153ModelContext();
    const d = createMockDispatcher(M);
    const unregister = registerWebMcpTools(M, d, ctx as unknown as ModelContextLike);
    expect((await ctx.getTools()).map((t) => t.name)).toEqual(WEBMCP_NAMES);
    expect(parse(await ctx.tools.get('today_get')!.execute({}))).toMatchObject({ ok: true, status: 'applied' });
    expect(parse(await ctx.tools.get('plan_shift')!.execute({ days: 1 }))).toMatchObject({ ok: true, status: 'pending_user' });
    unregister();
    expect(await ctx.getTools()).toEqual([]);
  });

  it('swallows a rejected registration (duplicate name) without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const ctx = new Chromium153ModelContext();
      const first = registerWebMcpTools(M, createMockDispatcher(M), ctx as unknown as ModelContextLike);
      // a second registration without cleanup: every call rejects with "Duplicate tool name"
      const second = registerWebMcpTools(M, createMockDispatcher(M), ctx as unknown as ModelContextLike);
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(ctx.tools.size).toBe(WEBMCP_NAMES.length);
      second();
      first();
      expect(ctx.tools.size).toBe(0);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('re-registers through unregisterTool when an API that has it rejects asynchronously', async () => {
    const ctx = fakeModelContext();
    const asyncCtx: ModelContextLike = {
      registerTool: (tool, opts) => {
        try {
          ctx.registerTool(tool, opts);
          return Promise.resolve(undefined);
        } catch (e) {
          return Promise.reject(e);
        }
      },
      unregisterTool: ctx.unregisterTool,
    };
    registerWebMcpTools(M, createMockDispatcher(M), asyncCtx);
    const d2 = createMockDispatcher(M);
    registerWebMcpTools(M, d2, asyncCtx);
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.unregisterTool).toHaveBeenCalledTimes(WEBMCP_NAMES.length);
    expect([...ctx.tools.keys()].sort()).toEqual([...WEBMCP_NAMES].sort());
    setWebMcpEnabled(true);
    await ctx.tools.get('today_get')!.execute({});
    expect(d2.calls).toHaveLength(1);
  });
});

function Harness() {
  useWebMcpRegistration();
  return null;
}

describe('useWebMcpRegistration', () => {
  it('registers nothing while the setting is off', async () => {
    const ctx = fakeModelContext();
    installOnDocument(ctx);
    setAgentDispatcher(createMockDispatcher(M));
    render(<Harness />);
    await act(async () => undefined);
    expect(ctx.registerTool).not.toHaveBeenCalled();
  });

  it('registers nothing without a dispatcher, then registers once E4 sets one', async () => {
    const ctx = fakeModelContext();
    installOnDocument(ctx);
    setWebMcpEnabled(true);
    render(<Harness />);
    await act(async () => undefined);
    expect(ctx.tools.size).toBe(0);
    act(() => setAgentDispatcher(createMockDispatcher(M)));
    await waitFor(() => expect([...ctx.tools.keys()]).toEqual(WEBMCP_NAMES));
  });

  it('does nothing when WebMCP is unsupported', async () => {
    setWebMcpEnabled(true);
    setAgentDispatcher(createMockDispatcher(M));
    expect(() => render(<Harness />)).not.toThrow();
    await act(async () => undefined);
    expect(isWebMcpSupported()).toBe(false);
  });

  it('unregisters when disabled or stopped, and re-registers on a new manifest hash', async () => {
    const ctx = fakeModelContext();
    installOnDocument(ctx);
    const d = createMockDispatcher(M);
    setAgentDispatcher(d);
    render(<Harness />);
    act(() => setWebMcpEnabled(true));
    await waitFor(() => expect(ctx.tools.size).toBe(WEBMCP_NAMES.length));

    act(() => setWebMcpEnabled(false));
    expect(ctx.tools.size).toBe(0);

    act(() => setWebMcpEnabled(true));
    await waitFor(() => expect(ctx.tools.size).toBe(WEBMCP_NAMES.length));

    // the registry drops nav.open: new hash → re-registration without it
    const smaller: ToolManifest = { ...M, hash: 'other', tools: M.tools.filter((t) => t.id !== 'nav.open') };
    d.setManifest(smaller);
    act(() => setAgentDispatcher(d));
    await waitFor(() => expect(ctx.tools.has('nav_open')).toBe(false));
    expect(ctx.tools.size).toBe(WEBMCP_NAMES.length - 1);

    act(() => stopAgents());
    expect(isWebMcpEnabled()).toBe(false);
    expect(ctx.tools.size).toBe(0);
  });
});
