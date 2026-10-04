/**
 * "Connect your AI tools" (desktop app only, SUITE_SPEC §15.6): adds the Vitals MCP entry to the AI tools on this
 * computer, one row per tool. Add opens a consent dialog with the file that changes, the exact lines and what the tool
 * may do; nothing is written before the person confirms. With a server paired, each added tool gets its own agent key
 * (scope `edit`), handed straight to the app's secret store: never shown, never kept in React state.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Engraved, Faceplate, FaceplateHeader, InlineWarning, Key, Dialog } from '@/components';
import { ServerError, type AgentClient, type ServerClient } from '@/net/server';
import { useServerClient, useServerPairing } from '../server/hooks';
import { agentKeyIds, setAgentKeyIds } from './agentKeyIds';
import { CONNECT_TOOLS_COPY as C } from './copy';
import { desktopBridge, type AiToolId, type AiToolRow, type DesktopMcpBridge } from './desktop';

const wrap = 'break-words [overflow-wrap:anywhere]';
const CLIENT: Record<AiToolId, AgentClient> = { 'claude-code': 'claude', codex: 'codex', opencode: 'opencode', 'chatgpt-desktop': 'chatgpt-desktop' };
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** A label as the server lists it: the home server drops characters such as "·", and both cut it to 40 characters. */
const serverLabel = (s: string) => s.replace(/[^\p{L}\p{N} ._:/@()'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Keeps a key's id when revoking it failed, so the next Add or Remove tries again. */
const keepForRetry = (tool: AiToolId, id: string) => setAgentKeyIds(tool, [...agentKeyIds(tool), id]);

/**
 * Revokes this tool's earlier keys on the server, all but `keep`: by the ids this computer kept, or, when it kept none
 * (keys made before it kept ids), by this app's label for the tool. Ids that could not be revoked stay kept for the
 * next try; the first failure is thrown.
 */
async function revokeOldKeys(client: ServerClient, row: AiToolRow, keep?: string): Promise<void> {
  let ids = agentKeyIds(row.id).filter((id) => id !== keep);
  if (!ids.length) {
    const label = serverLabel(C.agentLabel(row.label));
    ids = (await client.agentTokens()).filter((t) => t.client === CLIENT[row.id] && serverLabel(t.label) === label && t.id !== keep).map((t) => t.id);
  }
  const results = await Promise.allSettled(ids.map((id) => client.revokeAgentToken(id)));
  // a key the server does not know any more is gone already
  const failed = results.flatMap((r, i) => (r.status === 'rejected' && !(r.reason instanceof ServerError && r.reason.code === 'not_found') ? [{ id: ids[i]!, reason: r.reason as unknown }] : []));
  setAgentKeyIds(row.id, [...(keep ? [keep] : []), ...failed.map((f) => f.id)]);
  if (failed.length) throw failed[0]!.reason;
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
  const toolList = useRef<HTMLUListElement>(null);
  const focusAfterLoad = useRef<AiToolId | null>(null);

  const load = useCallback((focusTool?: AiToolId) => {
    bridge.mcp.tools().then((next) => {
      if (focusTool) focusAfterLoad.current = focusTool;
      setRows(next);
    }, () => setError(C.loadFailed));
  }, [bridge]);

  useLayoutEffect(() => {
    const id = focusAfterLoad.current;
    if (!id) return;
    toolList.current?.querySelector<HTMLButtonElement>(`button[data-tool-id="${id}"]`)?.focus();
    focusAfterLoad.current = null;
  }, [rows]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const finishAdd = async (row: AiToolRow, added: Promise<AiToolRow>, minted: Promise<{ token: string; id: string } | null>) => {
    const [a, m] = await Promise.allSettled([added, minted]);
    const key = m.status === 'fulfilled' ? m.value : null;
    if (a.status === 'rejected') {
      if (key) void client.revokeAgentToken(key.id).catch(() => keepForRetry(row.id, key.id));
      setError(message(a.reason));
    } else if (m.status === 'rejected') {
      setError(C.keyFailed(row.label, message(m.reason)));
    } else if (key) {
      let stored = false;
      try {
        await bridge.secrets.set(`agentToken:${row.id}`, key.token);
        stored = true;
      } catch (e) {
        void client.revokeAgentToken(key.id).catch(() => keepForRetry(row.id, key.id));
        setError(C.keyFailed(row.label, message(e)));
      }
      if (stored) {
        keepForRetry(row.id, key.id);
        await revokeOldKeys(client, row, key.id).catch((e: unknown) => setError(C.oldKeyLeft(row.label, message(e))));
      }
    }
    setBusy(false);
    setConsent(null);
    load(row.id);
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
      if (pairing) await revokeOldKeys(client, row).catch((e: unknown) => setError(C.keyLeft(row.label, message(e))));
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
    setRemoving(null);
    load(row.id);
  };

  return (
    <Faceplate as="section" id="connect-tools" aria-labelledby="settings-connect-tools-title" className="scroll-mt-2">
      <FaceplateHeader title={C.title} titleId="settings-connect-tools-title" />
      <div className="grid gap-3">
        <p className="m-0 text-sm leading-[1.5] text-ink">{C.intro}</p>
        {pairing && bridge.secrets.persistent === false ? <InlineWarning severity="caution">{C.keysNotKept}</InlineWarning> : null}
        <ul ref={toolList} className="m-0 grid list-none gap-3 p-0">
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
          <Key data-tool-id={row.id} size="sm" variant="quiet" aria-label={C.removeName(row.label)} onClick={onRemove}>
            {C.remove}
          </Key>
        ) : canAdd ? (
          <Key data-tool-id={row.id} size="sm" aria-label={C.addName(row.label)} onClick={onAdd}>
            {C.add}
          </Key>
        ) : null}
      </div>
      {row.note ? <p className={`m-0 whitespace-pre-line text-xs leading-[1.45] text-ink-2 ${wrap}`}>{row.note}</p> : null}
    </li>
  );
}
