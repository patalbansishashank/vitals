import { useEffect, useRef, useState } from 'react';
import { Activity, QrCode as QrIcon, RefreshCw } from 'lucide-react';
import { Chip, Dialog, Field, InlineWarning, Key, KeyLink, KeyValueList, TextInput } from '@/components';
import { originOf } from '@/net/net';
import { useServerPairing } from '../server/hooks';
import { dispatch, mintConfirmation } from '@/commands';
import { readPairingCode, useSyncView, type SyncView } from '@/state/sync';
import { normalizeRelayUrl } from '@/sync/pairing';
import type { PairingCode, SyncStatus } from '@/sync/types';
import { SettingsSection } from '../sections';
import { SYNC_COPY } from './copy';
import { PairingCodePanel } from './PairingCodePanel';
import { testRelay, type RelayTestResult } from './relayTest';
import { describeStatus, formatSyncTime } from './status';
import { unwrap } from './unwrap';
import { UnpairedView } from './UnpairedView';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function safeNormalize(url: string): string | null {
  try {
    return normalizeRelayUrl(url);
  } catch {
    return null;
  }
}

/** Settings › Sync: status, "Sync now", set up / join, the pairing code and "Stop syncing". Writes are `sync.*` commands. */
export function SyncSection() {
  return (
    <SettingsSection id="sync" title="Sync">
      <SyncPanel />
    </SettingsSection>
  );
}

function SyncPanel() {
  const view = useSyncView();
  const server = useServerPairing();
  const [firstCode, setFirstCode] = useState<PairingCode | null>(null);
  // with a paired server, sync runs through it: its address is the sync address (SUITE_SPEC §14.2)
  const throughServer = Boolean(server && view.relayUrl && originOf(view.relayUrl) === originOf(server.baseUrl));

  return (
    <div className="grid gap-4">
      <StatusLine status={view.status} />
      {throughServer ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
          <span>● {SYNC_COPY.throughServer}</span>
          <KeyLink size="sm" variant="quiet" to="/settings/server">
            {SYNC_COPY.serverSettings} ›
          </KeyLink>
        </div>
      ) : null}
      {view.paired && view.relayUrl ? (
        <PairedView key={firstCode ? 'first' : 'later'} view={view} relayUrl={view.relayUrl} firstCode={firstCode} onChanged={() => setFirstCode(null)} />
      ) : (
        <>
          {server && !view.relayUrl ? <p className="m-0 text-xs leading-[1.45] text-ink-2">{SYNC_COPY.fromServer}</p> : null}
          <UnpairedView key={server?.baseUrl ?? ''} initialUrl={view.relayUrl ?? server?.baseUrl ?? ''} onPaired={setFirstCode} />
        </>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: SyncStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = describeStatus(status);
  const syncing = busy || status.state === 'syncing';

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await dispatch('sync.now', {}));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="lm-sr">Sync status:</span>
          <Chip kind="status" severity={view.severity}>
            {view.label}
          </Chip>
          {view.detail ? <span className="text-xs text-ink-2">{view.detail}</span> : null}
        </div>
        {status.state === 'off' ? null : (
          <Key size="sm" icon={RefreshCw} loading={syncing} onClick={() => void syncNow()}>
            {syncing ? SYNC_COPY.syncing : SYNC_COPY.syncNow}
          </Key>
        )}
      </div>
      {view.problem || error ? (
        <InlineWarning severity={status.state === 'error' || error ? 'danger' : 'caution'} alert>
          {error ?? view.problem}
        </InlineWarning>
      ) : null}
    </div>
  );
}

function PairedView({
  view: config,
  relayUrl,
  firstCode,
  onChanged,
}: {
  view: SyncView;
  relayUrl: string;
  firstCode: PairingCode | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState(relayUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState<PairingCode | null>(firstCode);
  // right after setting up sync, the words must be confirmed as saved before the code can be closed
  const [mustAck, setMustAck] = useState(firstCode !== null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showRef = useRef<HTMLButtonElement>(null);

  const changed = (safeNormalize(url) ?? url.trim()) !== (safeNormalize(relayUrl) ?? relayUrl);

  const saveRelay = async () => {
    let next: string;
    try {
      next = normalizeRelayUrl(url);
    } catch (e) {
      return setUrlError(messageOf(e));
    }
    setSaving(true);
    setError(null);
    try {
      unwrap(await dispatch('sync.configure', { relayUrl: next }));
      setUrl(next);
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const showCode = async () => {
    setLoadingCode(true);
    setError(null);
    try {
      setShown(await readPairingCode());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoadingCode(false);
    }
  };

  const hideCode = (acknowledged: boolean) => {
    setShown(null);
    if (acknowledged) setMustAck(false);
    window.setTimeout(() => showRef.current?.focus(), 0);
  };

  return (
    <div className="grid gap-4">
      <ServerFacts key={relayUrl} relayUrl={relayUrl} label={config.label} lastSyncedAt={config.status.lastSyncedAt} />
      <div className="grid gap-2">
        <Field label={SYNC_COPY.serverLabel} help={SYNC_COPY.serverHelp} error={urlError}>
          <TextInput
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
          />
        </Field>
        <div>
          <Key size="sm" loading={saving} disabledReason={changed ? undefined : 'Nothing to save.'} onClick={() => void saveRelay()}>
            {SYNC_COPY.saveAddress}
          </Key>
        </div>
      </div>
      <div className="grid gap-3 border-t border-line pt-4">
        {shown ? (
          <PairingCodePanel code={shown} requireAck={mustAck} onHide={hideCode} />
        ) : (
          <div>
            <Key ref={showRef} icon={QrIcon} loading={loadingCode} onClick={() => void showCode()}>
              {SYNC_COPY.showCode}
            </Key>
          </div>
        )}
      </div>
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Key variant="danger" onClick={() => setConfirmStop(true)}>
          {SYNC_COPY.stop}
        </Key>
      </div>
      <Dialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        role="alertdialog"
        title={SYNC_COPY.stopTitle}
        footer={
          <>
            <Key onClick={() => setConfirmStop(false)}>Cancel</Key>
            <Key
              variant="danger"
              loading={stopping}
              onClick={async () => {
                setStopping(true);
                try {
                  unwrap(await dispatch('sync.unpair', {}, { confirmation: mintConfirmation('sync.unpair', {}) }));
                  setConfirmStop(false);
                  onChanged();
                } catch (e) {
                  setError(messageOf(e));
                  setConfirmStop(false);
                } finally {
                  setStopping(false);
                }
              }}
            >
              {SYNC_COPY.stopConfirm}
            </Key>
          </>
        }
      >
        <p className="m-0">{SYNC_COPY.stopBody}</p>
      </Dialog>
    </div>
  );
}

type ServerCheck = { state: 'checking' } | ({ state: 'done' } & RelayTestResult);

/** The server in use, whether it answers right now (GET /health), its version and the last sync. Checked on open and on "Check server". */
function ServerFacts({ relayUrl, label, lastSyncedAt }: { relayUrl: string; label: string | null; lastSyncedAt?: string | null }) {
  const [check, setCheck] = useState<ServerCheck>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void testRelay(relayUrl).then(
      (r) => alive && setCheck({ state: 'done', ...r }),
      (e: unknown) => alive && setCheck({ state: 'done', ok: false, message: messageOf(e) }),
    );
    return () => {
      alive = false;
    };
  }, [relayUrl, attempt]);
  const run = () => {
    setCheck({ state: 'checking' });
    setAttempt((n) => n + 1);
  };

  const answers =
    check.state === 'checking' ? SYNC_COPY.answersChecking : check.ok ? SYNC_COPY.answersYes(check.ms) : SYNC_COPY.answersNo;
  const version = check.state === 'done' && check.ok ? check.version : null;
  const lastSync = lastSyncedAt ? formatSyncTime(lastSyncedAt) : '';
  return (
    <div className="grid gap-2">
      <KeyValueList
        items={[
          { key: SYNC_COPY.serverKey, value: <span className="break-words [overflow-wrap:anywhere]">{relayUrl}</span> },
          ...(label ? [{ key: SYNC_COPY.nameKey, value: label }] : []),
          { key: SYNC_COPY.answersKey, value: answers },
          ...(version ? [{ key: SYNC_COPY.serverVersionKey, value: version }] : []),
          { key: SYNC_COPY.lastSyncKey, value: lastSync || SYNC_COPY.lastSyncNever },
        ]}
      />
      {check.state === 'done' && !check.ok ? <p className="m-0 text-xs leading-[1.45] text-ink-2">{check.message}</p> : null}
      <div>
        <Key size="sm" icon={Activity} loading={check.state === 'checking'} onClick={run}>
          {SYNC_COPY.checkServer}
        </Key>
      </div>
    </div>
  );
}
