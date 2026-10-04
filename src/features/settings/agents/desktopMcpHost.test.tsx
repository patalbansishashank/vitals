import { render, renderHook } from '@testing-library/react';
import { AgentSurfaces } from '@/agents/AgentSurfaces';
import { notifyAgentManifestChanged, setAgentDispatcher, setDirectApplyPolicy } from '@/agents/dispatcher';
import type { ToolManifest } from '@/agents/manifest';
import { fixtureManifest } from '@/agents/testing/fixture';
import { createMockDispatcher } from '@/agents/testing/mockDispatcher';
import { BASE, fakeClient } from '../server/__tests__/fakeServer';
import type { DesktopMcpBridge } from './desktop';
import { startDesktopMcpHost, useDesktopMcpHost } from './desktopMcpHost';

type CallHandler = Parameters<DesktopMcpBridge['mcp']['onCall']>[0];

function fakeBridge() {
  const host: { handler: CallHandler | null } = { handler: null };
  const bridge = {
    mcp: {
      tools: vi.fn(async () => []),
      add: vi.fn(),
      remove: vi.fn(),
      onCall: vi.fn((h: CallHandler) => {
        host.handler = h;
        return () => {
          if (host.handler === h) host.handler = null;
        };
      }),
      setManifest: vi.fn(),
      setServer: vi.fn(),
    },
    secrets: { set: vi.fn(async () => undefined) },
  } satisfies DesktopMcpBridge;
  return { bridge, host };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  setAgentDispatcher(null);
  setDirectApplyPolicy(null);
  delete (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop;
});

describe('startDesktopMcpHost', () => {
  it('does nothing outside the desktop app', () => {
    const stop = startDesktopMcpHost(undefined);
    expect(stop).toBeTypeOf('function');
    stop();
  });

  it('publishes the manifest (null until the bus is ready) and again when it changes', async () => {
    const { bridge } = fakeBridge();
    const stop = startDesktopMcpHost(bridge, fakeClient().client);
    expect(bridge.mcp.setManifest).toHaveBeenLastCalledWith(null);
    const m = fixtureManifest();
    const dispatcher = createMockDispatcher(m);
    setAgentDispatcher(dispatcher);
    await flush();
    expect(bridge.mcp.setManifest).toHaveBeenLastCalledWith(m);
    // a change with the same hash is not sent again
    const count = bridge.mcp.setManifest.mock.calls.length;
    notifyAgentManifestChanged();
    await flush();
    expect(bridge.mcp.setManifest.mock.calls.length).toBe(count);
    const next: ToolManifest = { ...m, hash: 'changed', tools: m.tools.slice(0, 3) };
    dispatcher.setManifest(next);
    notifyAgentManifestChanged();
    await flush();
    expect(bridge.mcp.setManifest).toHaveBeenLastCalledWith(next);
    stop();
    dispatcher.setManifest({ ...m, hash: 'after-stop' });
    notifyAgentManifestChanged();
    await flush();
    expect(bridge.mcp.setManifest).toHaveBeenLastCalledWith(next);
  });

  it('runs calls through guardedCall as an MCP client: destructive refused, consequential writes staged', async () => {
    const { bridge, host } = fakeBridge();
    const dispatcher = createMockDispatcher(fixtureManifest());
    setAgentDispatcher(dispatcher);
    const stop = startDesktopMcpHost(bridge, fakeClient().client);
    expect(host.handler).not.toBeNull();

    const end = (await host.handler!({ client: 'codex', tool: 'plan_end', args: {} })) as { ok: boolean; error?: { code: string } };
    expect(end.ok).toBe(false);
    expect(end.error?.code).toBe('surface_forbidden');
    expect(dispatcher.calls).toHaveLength(0);

    const shift = (await host.handler!({ client: 'codex', tool: 'plan_shift', args: { days: 1 } })) as { status: string };
    expect(shift.status).toBe('pending_user');
    expect(dispatcher.calls[0]).toMatchObject({ commandId: 'plan.shift', opts: { actor: { kind: 'mcp', id: 'codex' }, stage: true } });

    const read = (await host.handler!({ client: 'codex', tool: 'today_get', args: {} })) as { status: string };
    expect(read.status).toBe('applied');
    expect(dispatcher.calls[1]).toMatchObject({ commandId: 'today.get', opts: { stage: false } });

    // a tool not on the MCP surface is refused too
    const nav = (await host.handler!({ client: 'codex', tool: 'nav_open', args: {} })) as { ok: boolean };
    expect(nav.ok).toBe(false);
    expect(dispatcher.calls).toHaveLength(2);
    stop();
    expect(host.handler).toBeNull();
  });

  it('answers not ready while the bus has no dispatcher', async () => {
    const { bridge, host } = fakeBridge();
    const stop = startDesktopMcpHost(bridge, fakeClient().client);
    const r = (await host.handler!({ client: 'codex', tool: 'today_get', args: {} })) as { ok: boolean; status: string };
    expect(r).toMatchObject({ ok: false, status: 'rejected' });
    stop();
  });

  it('setServer follows the pairing', async () => {
    const { bridge } = fakeBridge();
    const { client } = fakeClient();
    const stop = startDesktopMcpHost(bridge, client);
    expect(bridge.mcp.setServer).toHaveBeenLastCalledWith(null);
    await client.pair({ baseUrl: BASE, code: '12345678' });
    expect(bridge.mcp.setServer).toHaveBeenLastCalledWith({ mcpUrl: `${BASE}/mcp` });
    client.forget();
    expect(bridge.mcp.setServer).toHaveBeenLastCalledWith(null);
    stop();
    const calls = bridge.mcp.setServer.mock.calls.length;
    await client.pair({ baseUrl: BASE, code: '12345678' });
    expect(bridge.mcp.setServer.mock.calls.length).toBe(calls);
  });

  it('useDesktopMcpHost starts it from window.vitalsDesktop and stops on unmount', () => {
    const { bridge, host } = fakeBridge();
    (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop = bridge;
    const view = renderHook(() => useDesktopMcpHost());
    expect(bridge.mcp.onCall).toHaveBeenCalled();
    expect(host.handler).not.toBeNull();
    view.unmount();
    expect(host.handler).toBeNull();
  });

  it('the app shell\'s AgentSurfaces mounts it in the desktop app (an AI tool gets the manifest and its calls)', () => {
    const { bridge, host } = fakeBridge();
    (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop = bridge;
    const view = render(<AgentSurfaces />);
    expect(bridge.mcp.setManifest).toHaveBeenCalled();
    expect(bridge.mcp.setServer).toHaveBeenCalled();
    expect(host.handler).not.toBeNull();
    view.unmount();
    expect(host.handler).toBeNull();
  });
});
