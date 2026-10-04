/**
 * "Connect your AI tools" (desktop app only, SUITE_SPEC §15.6): adds the Vitals MCP entry to the AI tools on this
 * computer, one row per tool. Add opens a consent dialog with the file that changes, the exact lines and what the tool
 * may do; nothing is written before the person confirms. With a server paired, each added tool gets its own agent key
 * (scope `edit`), handed straight to the app's secret store: never shown, never kept in React state.
 */
import { useCallback, useEffect, useState } from 'react';
import { Engraved, Faceplate, FaceplateHeader, InlineWarning, Key, Dialog } from '@/components';
import type { AgentClient, ServerClient } from '@/net/server';
import { useServerClient, useServerPairing } from '../server/hooks';
import { CONNECT_TOOLS_COPY as C } from './copy';
import { desktopBridge, type AiToolId, type AiToolRow, type DesktopMcpBridge } from './desktop';

const wrap = 'break-words [overflow-wrap:anywhere]';
const CLIENT: Record<AiToolId, AgentClient> = { 'claude-code': 'claude', codex: 'codex', opencode: 'opencode', 'chatgpt-desktop': 'chatgpt-desktop' };
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** Revokes this tool's earlier desktop keys on the server (best effort): one live key per tool. */
async function revokeOldKeys(client: ServerClient, row: AiToolRow, keep?: string): Promise<void> {
  try {
    const label = C.agentLabel(row.label);
    const old = (await client.agentTokens()).filter((t) => t.label === label && t.client === CLIENT[row.id] && t.id !== keep);
    await Promise.all(old.map((t) => client.revokeAgentToken(t.id).catch(() => undefined)));
  } catch {
    // the person can still revoke it in the keys list above
  }
}

export function ConnectTools() {
  const [bridge] = useState(desktopBridge);
  return bridge ? <ConnectToolsBlock bridge={bridge} /> : null;
}

function ConnectToolsBlock({ bridge }: { bridge: DesktopMcpBridge }) {
  const pairing = useServerPairing();
  const client = useServerClient();
  const [rows, setRows] = useState<AiToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<AiToolRow | null>(null);
  const [removing, setRemoving] = useState<AiToolRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    bridge.mcp.tools().then(setRows, () => setError(C.loadFailed));
  }, [bridge]);

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const finishAdd = async (row: AiToolRow, added: Promise<AiToolRow>, minted: Promise<{ token: string; id: string } | null>) => {
    const [a, m] = await Promise.allSettled([added, minted]);
    const key = m.status === 'fulfilled' ? m.value : null;
    if (a.status === 'rejected') {
      if (key) void client.revokeAgentToken(key.id).catch(() => undefined);
      setError(message(a.reason));
    } else if (m.status === 'rejected') {
      setError(C.keyFailed(row.label, message(m.reason)));
    } else if (key) {
      try {
        await bridge.secrets.set(`agentToken:${row.id}`, key.token);
        void revokeOldKeys(client, row, key.id);
      } catch (e) {
        void client.revokeAgentToken(key.id).catch(() => undefined);
        setError(C.keyFailed(row.label, message(e)));
      }
    }
    setBusy(false);
    setConsent(null);
    load();
  };

  const confirmAdd = (row: AiToolRow) => {
    setError(null);
    setBusy(true);
    // `add` is called first, synchronously inside the click: main writes only during a fresh user gesture (the preload
    // checks navigator.userActivation.isActive, about 5 s), and minting the key is a server round trip that could
    // outlast it. The key is minted at the same time and stored once both are done; main reads it only when the AI
    // tool connects. If the add fails, the new key is revoked.
    const added = (async () => bridge.mcp.add(row.id))();
    const minted = (async () =>
      pairing ? client.createAgentToken({ client: CLIENT[row.id], label: C.agentLabel(row.label), scope: 'edit' }) : null)();
    void finishAdd(row, added, minted);
  };

  const confirmRemove = async (row: AiToolRow) => {
    setError(null);
    setBusy(true);
    try {
      await bridge.mcp.remove(row.id);
      await bridge.secrets.set(`agentToken:${row.id}`, null);
      if (pairing) void revokeOldKeys(client, row);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
    setRemoving(null);
    load();
  };

  return (
    <Faceplate as="section" id="connect-tools" aria-labelledby="settings-connect-tools-title" className="scroll-mt-2">
      <FaceplateHeader title={C.title} titleId="settings-connect-tools-title" />
      <div className="grid gap-3">
        <p className="m-0 text-sm leading-[1.5] text-ink">{C.intro}</p>
        <ul className="m-0 grid list-none gap-3 p-0">
          {(rows ?? []).map((row) => (
            <ToolRow key={row.id} row={row} onAdd={() => setConsent(row)} onRemove={() => setRemoving(row)} />
          ))}
        </ul>
        {error ? (
          <InlineWarning severity="danger" alert>
            {error}
          </InlineWarning>
        ) : null}
      </div>
      <Dialog
        open={consent !== null}
        onClose={() => !busy && setConsent(null)}
        title={consent ? C.addTitle(consent.label) : ''}
        size="wide"
        footer={
          <>
            <Key disabled={busy} onClick={() => setConsent(null)}>
              {C.cancel}
            </Key>
            <Key variant="solid" loading={busy} onClick={() => consent && !busy && confirmAdd(consent)}>
              {C.confirmAdd}
            </Key>
          </>
        }
      >
        {consent ? (
          <div className="grid gap-3">
            {consent.file ? (
              <div className="grid gap-1">
                <Engraved as="p" className="m-0">
                  {C.fileLabel}
                </Engraved>
                <code className={`font-mono text-sm text-ink ${wrap}`}>{consent.file}</code>
              </div>
            ) : null}
            {consent.preview ? (
              <div className="grid gap-1">
                <Engraved as="p" className="m-0">
                  {C.linesLabel}
                </Engraved>
                <pre className={`m-0 whitespace-pre-wrap rounded-sm bg-well px-2 py-1 font-mono text-xs text-ink ${wrap}`}>{consent.preview}</pre>
              </div>
            ) : null}
            <div className="grid gap-1">
              <Engraved as="p" className="m-0">
                {C.canLabel(consent.label)}
              </Engraved>
              <p className="m-0 text-sm text-ink">{C.can}</p>
            </div>
            <p className="m-0 text-xs leading-[1.45] text-ink-2">{pairing ? C.viaServer : C.viaApp}</p>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        role="alertdialog"
        title={removing ? C.removeTitle(removing.label) : ''}
        footer={
          <>
            <Key disabled={busy} onClick={() => setRemoving(null)}>
              {C.cancel}
            </Key>
            <Key variant="danger" loading={busy} onClick={() => removing && !busy && void confirmRemove(removing)}>
              {C.confirmRemove}
            </Key>
          </>
        }
      >
        <p className="m-0">{removing ? C.removeBody(removing.label) : null}</p>
      </Dialog>
    </Faceplate>
  );
}

function ToolRow({ row, onAdd, onRemove }: { row: AiToolRow; onAdd: () => void; onRemove: () => void }) {
  const canAdd = !row.added && (row.canAdd ?? row.found);
  const status = !row.found ? C.notFound : row.added ? C.added : C.found;
  return (
    <li className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className={`min-w-0 ${wrap}`}>
          <span className="font-[550] text-ink">{row.label}</span>
          <span className="text-xs text-ink-2"> · {status}</span>
        </span>
        {row.added ? (
          <Key size="sm" variant="quiet" aria-label={C.removeName(row.label)} onClick={onRemove}>
            {C.remove}
          </Key>
        ) : canAdd ? (
          <Key size="sm" aria-label={C.addName(row.label)} onClick={onAdd}>
            {C.add}
          </Key>
        ) : null}
      </div>
      {row.note ? <p className={`m-0 whitespace-pre-line text-xs leading-[1.45] text-ink-2 ${wrap}`}>{row.note}</p> : null}
    </li>
  );
}
