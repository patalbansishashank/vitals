import { useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink, QrCode as QrIcon, RefreshCw } from 'lucide-react';
import {
  Chip,
  Dialog,
  Field,
  Icon,
  InlineWarning,
  Key,
  KeyValueList,
  MonoMeta,
  TextInput,
} from '@/components';
import { originOf } from '@/net/net';
import { useServerPairing } from '../server/hooks';
import { SERVER_COPY } from '../server/copy';
import { dispatch, mintConfirmation } from '@/commands';
import { readPairingCode, useSyncView, type SyncView } from '@/state/sync';
import { normalizeRelayUrl } from '@/sync/pairing';
import type { PairingCode, SyncStatus } from '@/sync/types';
import { SettingsDisclosure, SettingsGroup, SettingsItem } from '../SettingRow';
import { SYNC_COPY } from './copy';
import { PairingCodePanel } from './PairingCodePanel';
import { testRelay, type RelayTestResult } from './relayTest';
import { describeStatus, formatSyncTime } from './status';
import { unwrap } from './unwrap';
import { UnpairedView } from './UnpairedView';

const WORDS_INFO = {
  title: 'The 24 words',
  body: 'The 24 words are your sync key and your backup. Anyone with them can read and change your Vitals data. Lose every device and these words, and the data is gone. The code hides itself after a minute.',
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function safeNormalize(url: string): string | null {
  try {
    return normalizeRelayUrl(url);
  } catch {
    return null;
  }
}

/**
 * Settings › Sync, under the server's pairing: status, "Sync now", the pairing code and "Stop syncing"; set up or join
 * when sync is off. Writes are `sync.*` commands. Without a paired server, setting up sync with a sync server address or
 * the 24 words is the other way in, behind "Other ways to join". With sync through a paired home server it is the backup
 * area: the 24 words and QR, "Sync now", "Stop syncing".
 */
export function SyncSection() {
  return <SyncPanel />;
}

function SyncPanel() {
  const view = useSyncView();
  const server = useServerPairing();
  const [firstCode, setFirstCode] = useState<PairingCode | null>(null);
  // with a paired server, sync runs through it: its address is the sync address (SUITE_SPEC §14.2)
  const throughServer = Boolean(
    server && view.relayUrl && originOf(view.relayUrl) === originOf(server.baseUrl),
  );
  // only the home role pairs devices, and it owns the person's sync group: it can read the data (R20-PAIR-02), it hands
  // the key over at pairing, and this device joins that group rather than making a new one
  const homeServer = Boolean(server);

  if (view.paired && view.relayUrl) {
    return (
      <SettingsGroup label={SYNC_COPY.groupLabel} info={WORDS_INFO}>
        <SettingsItem>
          <StatusLine status={view.status} />
        </SettingsItem>
        <PairedView
          key={firstCode ? 'first' : 'later'}
          view={view}
          relayUrl={view.relayUrl}
          firstCode={firstCode}
          onChanged={() => setFirstCode(null)}
          throughServer={throughServer}
        />
      </SettingsGroup>
    );
  }
  // without a server, its pairing (above) is the page's primary action: these keys are secondary
  const join = (
    <UnpairedView
      key={server?.baseUrl ?? ''}
      initialUrl={view.relayUrl ?? server?.baseUrl ?? ''}
      onPaired={setFirstCode}
      canSetUp={!homeServer}
      primary={homeServer}
    />
  );
  // a paired server hands over the key at pairing; when it did not, join its group with the words or QR
  if (server) {
    return (
      <SettingsGroup label={SYNC_COPY.groupLabel} info={WORDS_INFO}>
        <SettingsItem>
          {!view.relayUrl ? <p className="settings-note">{SYNC_COPY.fromServer}</p> : null}
          {join}
        </SettingsItem>
      </SettingsGroup>
    );
  }
  // no server: the other ways into sync, and how to set a server up, as two rows of one group (r068 V10)
  return (
    <SettingsGroup label={SYNC_COPY.noServerLabel} info={WORDS_INFO}>
      {view.status.state === 'off' ? null : (
        <SettingsItem>
          <StatusLine status={view.status} />
        </SettingsItem>
      )}
      <SettingsDisclosure title={SYNC_COPY.otherWays}>{join}</SettingsDisclosure>
      <a className="settings-row" href={SERVER_COPY.noServerUrl} target="_blank" rel="noreferrer noopener">
        <span className="settings-row__title">{SERVER_COPY.setUpServer}</span>
        <Icon icon={ExternalLink} size={18} className="settings-row__chev" label="opens in a new tab" />
      </a>
    </SettingsGroup>
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
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="lm-sr">Sync status:</span>
          <Chip kind="status" severity={view.severity}>
            {view.label}
          </Chip>
          {view.detail ? <MonoMeta className="settings-wrap">{view.detail}</MonoMeta> : null}
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
  throughServer,
}: {
  view: SyncView;
  relayUrl: string;
  firstCode: PairingCode | null;
  onChanged: () => void;
  /** The sync address is the paired server's: it is set in Settings › Server, so this page is the backup area. */
  throughServer: boolean;
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
    <>
      {throughServer ? null : (
        <SettingsItem>
          <ServerFacts
            key={relayUrl}
            relayUrl={relayUrl}
            label={config.label}
            lastSyncedAt={config.status.lastSyncedAt}
          />
        </SettingsItem>
      )}
      {throughServer ? null : (
        <SettingsItem>
          <Field label={SYNC_COPY.serverLabel} error={urlError}>
            <TextInput
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={SYNC_COPY.serverPlaceholder}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
            />
          </Field>
          <div>
            <Key
              size="sm"
              loading={saving}
              disabledReason={changed ? undefined : 'Nothing to save.'}
              onClick={() => void saveRelay()}
            >
              {SYNC_COPY.saveAddress}
            </Key>
          </div>
        </SettingsItem>
      )}
      <SettingsItem>
        {shown ? (
          <PairingCodePanel code={shown} requireAck={mustAck} onHide={hideCode} />
        ) : (
          <div>
            <Key ref={showRef} icon={QrIcon} loading={loadingCode} onClick={() => void showCode()}>
              {SYNC_COPY.showCode}
            </Key>
          </div>
        )}
        {error ? (
          <InlineWarning severity="danger" alert>
            {error}
          </InlineWarning>
        ) : null}
      </SettingsItem>
      <SettingsItem>
        <div>
          <Key variant="danger" onClick={() => setConfirmStop(true)}>
            {SYNC_COPY.stop}
          </Key>
        </div>
      </SettingsItem>
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
                  unwrap(
                    await dispatch('sync.unpair', {}, { confirmation: mintConfirmation('sync.unpair', {}) }),
                  );
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
    </>
  );
}

type ServerCheck = { state: 'checking' } | ({ state: 'done' } & RelayTestResult);

/** The server in use, whether it answers right now (GET /health), its version and the last sync. Checked on open and on "Check server". */
function ServerFacts({
  relayUrl,
  label,
  lastSyncedAt,
}: {
  relayUrl: string;
  label: string | null;
  lastSyncedAt?: string | null;
}) {
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
    check.state === 'checking'
      ? SYNC_COPY.answersChecking
      : check.ok
        ? SYNC_COPY.answersYes(check.ms)
        : SYNC_COPY.answersNo;
  const version = check.state === 'done' && check.ok ? check.version : null;
  const lastSync = lastSyncedAt ? formatSyncTime(lastSyncedAt) : '';
  return (
    <div className="grid gap-3">
      <KeyValueList
        items={[
          {
            key: SYNC_COPY.serverKey,
            value: <span className="break-words [overflow-wrap:anywhere]">{relayUrl}</span>,
          },
          ...(label ? [{ key: SYNC_COPY.nameKey, value: label }] : []),
          { key: SYNC_COPY.answersKey, value: answers },
          ...(version ? [{ key: SYNC_COPY.serverVersionKey, value: version }] : []),
          { key: SYNC_COPY.lastSyncKey, value: lastSync || SYNC_COPY.lastSyncNever },
        ]}
      />
      {check.state === 'done' && !check.ok ? <p className="settings-note">{check.message}</p> : null}
      <div>
        <Key size="sm" icon={Activity} loading={check.state === 'checking'} onClick={run}>
          {SYNC_COPY.checkServer}
        </Key>
      </div>
    </div>
  );
}
