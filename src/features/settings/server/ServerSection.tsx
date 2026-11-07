/**
 * Settings › Server (design/screens/server.md; SUITE_SPEC §14.2, §14.7): pair this device with the person's server once,
 * see that it answers, add and remove devices, and read in plain words what the server holds. Every control here is
 * UI-only: pairing, revoking and forgetting are server calls through `src/net/server.ts`, never commands, so neither the
 * Coach nor an agent can reach them. Right after pairing, a home server hands this device the person's sync key once and
 * sync starts on the words' own path (`sync.join`, see `./serverSync.ts`).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  Circle,
  ChevronRight,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Monitor,
  RefreshCw,
  ScanLine,
  Server,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  Field,
  Icon,
  InlineWarning,
  Key,
  IconKey,
  KeyLink,
  MonoMeta,
  Notice,
  StatusDot,
  TextInput,
  toast,
  type Severity,
} from '@/components';
import { mintConfirmation } from '@/commands';
import { platform } from '@/platform';
import { sendCommand } from '@/features/lib/sendCommand';
import { useSyncView, type SyncView } from '@/state/sync';
import { clearGaugeEngineServer } from '@/state/gaugeEngine';
import {
  defaultDeviceLabel,
  MIN_SERVER_VERSION,
  normalizeServerCode,
  normalizeServerUrl,
  pairingLinkFor,
  parsePairingLink,
  ServerError,
  type PairCode,
  type ParsedPairingLink,
  type ServerConnection,
  type ServerDevice,
  type ServerPairing,
} from '@/net/server';
import { SettingsCard, SettingsGroup, SettingsItem } from '../SettingRow';
import { GaugeImportRow } from '../GaugeImportRow';
import { LinkStrip } from './LinkStrip';
import { ExistingDataDialog } from '../sync/ExistingDataDialog';
import { QrCode } from '../sync/QrCode';
import { SyncPillView } from '../sync/SyncPill';
import { countdown, formatDay, relativeTime, SERVER_COPY as C } from './copy';
import { useServerClient, useServerConnection, useServerNow, useServerPairing } from './hooks';
import { PairingCodeField } from './PairingCodeField';
import { dropHeldSyncKey, joinSyncFromServer, syncsThroughServer } from './serverSync';

const ScanDialog = lazy(() => import('../sync/ScanDialog'));

const wrap = 'settings-wrap';
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The status pill (COMPONENTS §15.3): a word and a mark, never colour alone. */
export function ServerPill({ connection }: { connection: ServerConnection }) {
  const map: Record<ServerConnection['state'], [Severity, string]> = {
    unpaired: ['info', C.pill.unpaired],
    checking: ['info', C.pill.checking],
    reachable: ['ok', C.pill.reachable],
    version: ['caution', C.pill.version],
    unreachable: ['caution', C.pill.unreachable],
    revoked: ['danger', C.pill.revoked],
  };
  // a full server answers; it is a passing state, not a broken one
  const busy = connection.state === 'unreachable' && connection.error.code === 'server_busy';
  const [severity, word] = busy ? (['info', C.pill.busy] as [Severity, string]) : map[connection.state];
  return (
    <span role="status" className="inline-flex">
      <span className="lm-sr">Server: </span>
      <StatusDot
        tone={
          severity === 'ok'
            ? 'live'
            : severity === 'caution'
              ? 'caution'
              : severity === 'danger'
                ? 'danger'
                : 'neutral'
        }
        label={word}
        pulse={connection.state === 'checking'}
      />
    </span>
  );
}

/** Reads a pairing link from the address (`#vitals-server:1?…`) once, and removes it from the address bar at once. */
function useLinkFromLocation(): [ParsedPairingLink | null, () => void] {
  const [link, setLink] = useState<ParsedPairingLink | null>(() => {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    return parsePairingLink(window.location.hash.slice(1));
  });
  useEffect(() => {
    if (!link) return;
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    window.setTimeout(() => document.getElementById('server')?.scrollIntoView?.({ block: 'start' }), 0);
    // run once for the link found at load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [link, () => setLink(null)];
}

export function ServerSection() {
  const client = useServerClient();
  const pairing = useServerPairing();
  const { connection, check } = useServerConnection();
  const [link, clearLink] = useLinkFromLocation();
  const [forgotten, setForgotten] = useState(false);
  const sync = useSyncView();
  const syncRef = useRef<SyncView>(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  const [existing, setExisting] = useState<{
    summary: string;
    resolve: (c: 'merge' | 'replace') => void;
  } | null>(null);
  const [joinNote, setJoinNote] = useState<{ text: string; retry: boolean } | null>(null);
  const [joining, setJoining] = useState(false);
  // a key held for Try again lives only as long as this pairing and this page
  useEffect(() => {
    if (!pairing) dropHeldSyncKey();
  }, [pairing]);
  useEffect(() => dropHeldSyncKey, []);

  // lives here, not in the pair panel: that panel is gone as soon as the pairing is stored
  const startSync = useCallback(
    async (paired: ServerPairing) => {
      setJoinNote(null);
      setJoining(true);
      const out = await joinSyncFromServer({
        client,
        baseUrl: paired.baseUrl,
        label: paired.person.label,
        view: syncRef.current,
        ask: (summary) => new Promise((resolve) => setExisting({ summary, resolve })),
      }).finally(() => setJoining(false));
      if (out.kind === 'other_key') setJoinNote({ text: C.alreadyOtherKey, retry: false });
      else if (out.kind === 'failed') setJoinNote({ text: C.joinFailed(out.message), retry: out.retry });
    },
    [client],
  );

  return (
    <div id="server" className="settings-section">
      {pairing ? (
        <PairedView
          pairing={pairing}
          connection={connection}
          check={check}
          onForgot={() => setForgotten(true)}
          note={joinNote?.text ?? null}
          onRetry={joinNote?.retry ? () => void startSync(pairing) : undefined}
          retrying={joining}
        />
      ) : (
        <UnpairedView
          connection={connection}
          link={link}
          onLinkUsed={clearLink}
          forgotten={forgotten}
          onDismissForgotten={() => setForgotten(false)}
          onPaired={(p) => void startSync(p)}
        />
      )}
      <ExistingDataDialog
        summary={existing?.summary ?? null}
        onChoose={(choice) => {
          existing?.resolve(choice);
          setExisting(null);
        }}
      />
    </div>
  );
}

/* ---- not paired ------------------------------------------------------------------------------------------------ */

function UnpairedView({
  connection,
  link,
  onLinkUsed,
  forgotten,
  onDismissForgotten,
  onPaired,
}: {
  connection: ServerConnection;
  link: ParsedPairingLink | null;
  onLinkUsed: () => void;
  forgotten: boolean;
  onDismissForgotten: () => void;
  onPaired: (p: ServerPairing) => void;
}) {
  const client = useServerClient();
  const ended = client.ended();
  const removed =
    connection.state === 'revoked' || ended?.reason === 'revoked' || ended?.reason === 'unauthorized';
  const [open, setOpen] = useState(Boolean(link));
  const [scan, setScan] = useState(false);
  const [prefill, setPrefill] = useState<ParsedPairingLink | null>(link);
  const [autoPair, setAutoPair] = useState(false);
  const enterRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setPrefill(null);
    onLinkUsed();
    window.setTimeout(() => enterRef.current?.focus(), 0);
  };

  return (
    <SettingsGroup
      label={C.title}
      aside={removed ? <ServerPill connection={{ state: 'revoked' }} /> : undefined}
    >
      {removed ? (
        <SettingsItem>
          <Notice
            severity="danger"
            layout="ruled"
            title={C.revoked}
            actions={
              open ? null : (
                <Key
                  size="sm"
                  onClick={() => {
                    setPrefill(ended ? { baseUrl: ended.baseUrl, code: '' } : null);
                    setOpen(true);
                  }}
                >
                  {C.connectAgain}
                </Key>
              )
            }
          />
        </SettingsItem>
      ) : null}
      {forgotten ? (
        <SettingsItem>
          <Notice severity="info" layout="ruled" title={C.forgotten} onDismiss={onDismissForgotten} />
        </SettingsItem>
      ) : null}
      <SettingsItem>
        {removed ? null : (
          <p className="settings-text" role="status">
            {C.notPaired}
          </p>
        )}
        {open ? (
          <PairPanel
            key={prefill ? `${prefill.baseUrl}|${prefill.code}` : 'blank'}
            initial={prefill ?? (ended ? { baseUrl: ended.baseUrl, code: '' } : null)}
            fromLink={Boolean(link) && prefill === link}
            autoPair={autoPair}
            onCancel={close}
            onPaired={onPaired}
          />
        ) : (
          <div className="settings-keys" data-equal="">
            <Key ref={enterRef} variant="primary" icon={KeyRound} onClick={() => setOpen(true)}>
              {C.enterCode}
            </Key>
            <Key icon={ScanLine} onClick={() => setScan(true)}>
              {C.scan}
            </Key>
          </div>
        )}
      </SettingsItem>
      {scan ? (
        <Suspense fallback={null}>
          <ScanDialog
            open
            title={C.scanTitle}
            help={C.scanHelp}
            onClose={() => setScan(false)}
            onResult={(text) => {
              setScan(false);
              const parsed = parsePairingLink(text);
              setPrefill(parsed);
              setAutoPair(Boolean(parsed));
              setOpen(true);
              if (!parsed) toast(C.scanNotServer);
            }}
          />
        </Suspense>
      ) : null}
    </SettingsGroup>
  );
}

type Step = 'reach' | 'code' | null;

function PairPanel({
  initial,
  fromLink,
  autoPair,
  onCancel,
  onPaired,
}: {
  initial: ParsedPairingLink | null;
  fromLink: boolean;
  autoPair: boolean;
  onCancel: () => void;
  onPaired: (p: ServerPairing) => void;
}) {
  const client = useServerClient();
  const [address, setAddress] = useState(initial?.baseUrl ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.label ?? defaultDeviceLabel());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  const pair = useCallback(
    async (args?: { address: string; code: string }) => {
      const addr = args?.address ?? address;
      const digits = normalizeServerCode(args?.code ?? code);
      setError(null);
      let base: string;
      try {
        base = normalizeServerUrl(addr);
        setAddressError(null);
      } catch (e) {
        setAddressError(e instanceof ServerError ? e.message : String(e));
        return;
      }
      if (!digits) return setCodeError(C.codeIncomplete);
      setCodeError(null);
      const ac = new AbortController();
      abort.current = ac;
      setStep('reach');
      const t = window.setTimeout(() => setStep((s) => (s === 'reach' ? 'code' : s)), 700);
      try {
        const done = await client.pair({ baseUrl: base, code: digits, label: name, signal: ac.signal });
        toast(C.paired(done.person.label || hostOf(done.baseUrl)));
        onPaired(done);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const err = e instanceof ServerError ? e : new ServerError('server_unreachable');
        if (
          err.code === 'invalid_code' ||
          err.code === 'expired' ||
          err.code === 'locked' ||
          err.code === 'bad_request'
        ) {
          setCodeError(
            err.code === 'invalid_code' && err.attemptsLeft !== undefined
              ? `${err.message} ${C.attemptsLeft(err.attemptsLeft)}`
              : err.message,
          );
        } else if (
          err.code === 'invalid_address' ||
          err.code === 'http_address' ||
          err.code === 'not_vitals'
        ) {
          setAddressError(err.message);
        } else {
          setError(err.message);
        }
      } finally {
        window.clearTimeout(t);
        if (abort.current === ac) abort.current = null;
        setStep(null);
      }
    },
    [address, client, code, name, onPaired],
  );

  // a scanned code carries the address and the code: pair at once, no second tap
  useEffect(() => {
    if (autoPair && initial?.code && !started.current) {
      started.current = true;
      void pair({ address: initial.baseUrl, code: initial.code });
    }
  }, [autoPair, initial, pair]);

  const busy = step !== null;
  const complete = Boolean(address.trim()) && normalizeServerCode(code) !== null;
  return (
    <div className="grid gap-3">
      {fromLink && initial ? <p className="settings-text">{C.linkAsk(hostOf(initial.baseUrl))}</p> : null}
      <Field label={C.addressLabel} help={C.addressHelp} error={addressError}>
        <TextInput
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={C.addressPlaceholder}
          value={address}
          autoFocus={!initial?.baseUrl}
          onChange={(e) => {
            setAddress(e.target.value);
            setAddressError(null);
          }}
        />
      </Field>
      <PairingCodeField
        value={code}
        autoFocus={Boolean(initial?.baseUrl) && !initial?.code}
        onChange={(v) => {
          setCode(v);
          setCodeError(null);
        }}
        onLink={(l) => {
          setAddress(l.baseUrl);
          if (l.label) setName(l.label);
        }}
        help={C.codeHelp}
        error={codeError}
      />
      <details className="settings-details">
        <summary>
          {C.codeWhere}
          <Icon icon={ChevronRight} size={16} className="settings-details__chev" />
        </summary>
        <p className="settings-note">{C.codeWhereText}</p>
      </details>
      <Field label={C.nameLabel}>
        <TextInput autoComplete="off" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {/* the step line has no height while there is no step to say (no dead gap above the keys, r068 S23) */}
      <p className="settings-note" aria-live="polite">
        {step === 'reach' ? C.stepReach : step === 'code' ? C.stepCode : ''}
      </p>
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <div className="settings-keys" data-equal="">
        <Key
          variant="solid"
          loading={busy}
          disabledReason={busy ? C.pairing : complete ? undefined : C.codeIncomplete}
          onClick={() => void pair()}
        >
          {busy ? C.pairing : fromLink ? C.pairThis : C.pair}
        </Key>
        <Key
          onClick={() => {
            abort.current?.abort();
            onCancel();
          }}
        >
          {C.cancel}
        </Key>
      </div>
    </div>
  );
}

/* ---- paired ---------------------------------------------------------------------------------------------------- */

function PairedView({
  pairing,
  connection,
  check,
  onForgot,
  note,
  onRetry,
  retrying,
}: {
  pairing: ServerPairing;
  connection: ServerConnection;
  check: () => Promise<void>;
  onForgot: () => void;
  /** Why pairing did not turn sync on (another key on this device, or the join failed). */
  note: string | null;
  /** Set when trying the join again can work (§15.4: failure shows the reason with Try again). */
  onRetry?: (() => void) | undefined;
  /** The join is running (the first one right after pairing, or Try again). */
  retrying: boolean;
}) {
  const client = useServerClient();
  const sync = useSyncView();
  const [checking, setChecking] = useState(false);
  const [devicesRev, setDevicesRev] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);
  const status =
    connection.state === 'reachable' || connection.state === 'version' ? connection.status : null;
  const lastContact = 'lastContactAt' in connection ? connection.lastContactAt : null;

  const checkNow = async () => {
    setChecking(true);
    try {
      await check();
    } finally {
      setChecking(false);
    }
    setDevicesRev((n) => n + 1);
  };

  // on and working: "on"; anything else (offline, error, waiting) shows the sync pill with its count or reason
  const syncWord: ReactNode =
    sync.status.state === 'synced' || sync.status.state === 'syncing' ? (
      C.syncOn
    ) : (
      <SyncPillView status={sync.status} />
    );
  // while the join runs (fetching the synced data can take a while after Merge or Replace) the row says so, never "Off"
  const syncState: ReactNode = !sync.paired ? (
    retrying ? (
      <span role="status">{C.syncStarting}</span>
    ) : (
      C.syncOff
    )
  ) : syncsThroughServer(sync, pairing.baseUrl) ? (
    typeof syncWord === 'string' ? (
      C.syncThrough(syncWord, hostOf(pairing.baseUrl))
    ) : (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        {syncWord}
        <span>{C.syncThrough('', hostOf(pairing.baseUrl)).trim()}</span>
      </span>
    )
  ) : (
    syncWord
  );
  const role = status?.server.role === 'home' ? C.roleHome : (status?.server.role ?? '');
  const items: Array<{ key: string; value: ReactNode }> = [
    { key: C.keys.address, value: <span className={wrap}>{pairing.baseUrl}</span> },
    ...(pairing.person.label ? [{ key: C.keys.person, value: pairing.person.label }] : []),
    ...(status?.server.version ? [{ key: C.keys.version, value: status.server.version }] : []),
    ...(role ? [{ key: C.keys.role, value: role }] : []),
    { key: C.keys.device, value: status?.label || pairing.deviceId },
  ];

  const unreachable = connection.state === 'unreachable' && connection.error.code !== 'server_busy';
  return (
    <>
      <SettingsCard
        icon={Server}
        title={C.title}
        info={{
          title: 'Your server',
          body: (
            <>
              <p>
                Your server keeps your plan, logs, body data and Coach conversations in one folder on that
                computer, and runs the Coach. It can read all of it: that is how the Coach and agents work
                while your devices are off. Anyone who can open that computer’s files can read it too.
                Reachability and speed come from the server’s own status check, once a minute.
              </p>
              <p>{C.syncHint}</p>
            </>
          ),
        }}
        className="settings-server-card"
      >
        {connection.state === 'unreachable' ? (
          <SettingsItem>
            <Notice
              severity={connection.error.code === 'server_busy' ? 'info' : 'caution'}
              layout="ruled"
              title={
                connection.error.code === 'local_network_denied' || connection.error.code === 'server_busy'
                  ? connection.error.message
                  : C.unreachable
              }
              actions={
                <Key size="sm" icon={RefreshCw} loading={checking} onClick={() => void checkNow()}>
                  {C.tryAgain}
                </Key>
              }
            >
              {lastContact ? C.lastContactAt(relativeTime(lastContact)) : null}
            </Notice>
          </SettingsItem>
        ) : null}
        {connection.state === 'version' ? (
          <SettingsItem>
            <Notice
              severity="caution"
              layout="ruled"
              title={C.versionOld(connection.status.server.version, MIN_SERVER_VERSION)}
            />
          </SettingsItem>
        ) : null}
        <SettingsItem>
          <LinkStrip
            host={hostOf(pairing.baseUrl)}
            connection={connection}
            sync={syncsThroughServer(sync, pairing.baseUrl) ? sync.status : null}
            syncState={syncState}
          />
          <div className="settings-server-foot">
            <ServerPill connection={connection} />
            <MonoMeta>Last contact {relativeTime(lastContact)}</MonoMeta>
          </div>
          <dl className="settings-server-facts">
            {items.map((item) => (
              <div key={item.key}>
                <dt>
                  <MonoMeta>{item.key}</MonoMeta>
                </dt>
                <dd>
                  <MonoMeta tone="ink">{item.value}</MonoMeta>
                </dd>
              </div>
            ))}
          </dl>
          {note ? (
            <InlineWarning
              severity="caution"
              action={
                onRetry ? (
                  <Key size="sm" icon={RefreshCw} loading={retrying} onClick={onRetry}>
                    {C.tryAgain}
                  </Key>
                ) : undefined
              }
            >
              {note}
            </InlineWarning>
          ) : null}
          <div className="settings-keys">
            <Key
              size="sm"
              variant="text"
              icon={RefreshCw}
              loading={checking || connection.state === 'checking'}
              onClick={() => void checkNow()}
            >
              {C.checkNow}
            </Key>
          </div>
        </SettingsItem>
        <SettingsItem>
          <AddDevice
            baseUrl={pairing.baseUrl}
            onPaired={() => setDevicesRev((n) => n + 1)}
            disabled={unreachable}
          />
        </SettingsItem>
        <GaugeImportRow bare />
        <SettingsItem>
          <div>
            <Key variant="danger" onClick={() => setConfirmForget(true)}>
              {C.forget}
            </Key>
          </div>
          <p className="settings-note">{C.forgetHelp}</p>
        </SettingsItem>
      </SettingsCard>

      <DevicesGroup rev={devicesRev} disabled={unreachable} />

      <Dialog
        open={confirmForget}
        onClose={() => setConfirmForget(false)}
        role="alertdialog"
        title={C.forgetTitle}
        footer={
          <>
            <Key onClick={() => setConfirmForget(false)}>{C.cancel}</Key>
            <Key
              variant="danger"
              onClick={async () => {
                setConfirmForget(false);
                // the confirm says this device stops syncing: the relay on this server does not check the device token,
                // so forgetting the pairing alone would leave sync running through it. Stopping keeps this device's data.
                const stopSync = syncsThroughServer(sync, pairing.baseUrl);
                client.forget();
                if (stopSync)
                  void sendCommand(
                    'sync.unpair',
                    {},
                    { confirmation: mintConfirmation('sync.unpair', {}), silent: true },
                  ).then((r) => {
                    if (!r.ok) toast(C.forgetSyncFailed(r.error.message));
                  });
                try {
                  await clearGaugeEngineServer();
                  onForgot();
                } catch {
                  toast('Ring uploads could not be disconnected. Open Vitals again to retry.');
                }
              }}
            >
              {C.forgetConfirm}
            </Key>
          </>
        }
      >
        <p className="m-0">{C.forgetBody}</p>
      </Dialog>
    </>
  );
}

function AddDevice({
  baseUrl,
  onPaired,
  disabled,
}: {
  baseUrl: string;
  onPaired: () => void;
  disabled: boolean;
}) {
  const client = useServerClient();
  const [code, setCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [announce, setAnnounce] = useState('');
  const openRef = useRef<HTMLButtonElement>(null);
  const announcedMinute = useRef(false);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await client.issueCode();
      announcedMinute.current = false;
      setCode(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setCode(null);
    window.setTimeout(() => openRef.current?.focus(), 0);
  };

  // countdown, and the block closes by itself when a new device appears in the list
  useEffect(() => {
    if (!code) return;
    const expires = new Date(code.expiresAt).getTime();
    let known: Set<string> | null = null;
    void client.devices().then(
      (d) => (known = new Set(d.map((x) => x.id))),
      () => undefined,
    );
    const tick = () => {
      const ms = Number.isNaN(expires) ? 600_000 : expires - Date.now();
      setLeft(ms);
      if (ms <= 60_000 && ms > 0 && !announcedMinute.current) {
        announcedMinute.current = true;
        setAnnounce(C.newCodeMinute);
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    const poll = window.setInterval(() => {
      if (!known) return;
      void client.devices().then(
        (d) => {
          const added = d.find((x) => !known!.has(x.id));
          if (added) {
            setAnnounce(`${added.label} paired.`);
            onPaired();
            setCode(null);
          }
        },
        () => undefined,
      );
    }, 4000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(poll);
    };
  }, [client, code, onPaired]);

  const display = code ? `${code.code.slice(0, 4)}–${code.code.slice(4)}` : '';
  const link = code
    ? pairingLinkFor(code.qr, typeof window === 'undefined' ? undefined : window.location.origin)
    : '';
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast(C.newCodeCopied),
      () => undefined,
    );
  return (
    <div className="grid gap-2">
      <p className="lm-sr" aria-live="polite">
        {announce}
      </p>
      {code ? (
        <div role="region" aria-labelledby="server-new-code-title" className="grid gap-3">
          <h4 id="server-new-code-title" className="settings-list__title m-0">
            {C.newCodeTitle}
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <span className="settings-code-big">{display}</span>
            <Key size="sm" icon={Copy} onClick={() => copy(code.code)}>
              {C.newCodeCopy}
            </Key>
            <Key size="sm" icon={Link2} onClick={() => copy(link)}>
              {C.newCodeCopyLink}
            </Key>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <QrCode text={link} label={C.newCodeTitle} className="w-[200px] max-w-full shrink-0 rounded-sm" />
            <p className={`settings-note min-w-[12rem] flex-1 ${wrap}`}>{C.newCodeHow(baseUrl)}</p>
          </div>
          <p className="settings-text tabular-nums">
            {left > 0 ? C.newCodeExpires(countdown(left)) : C.newCodeExpired}
          </p>
          <InlineWarning severity="caution">{C.newCodeCaution}</InlineWarning>
          <div className="settings-keys">
            {left <= 0 ? (
              <Key size="sm" loading={busy} onClick={() => void make()}>
                {C.newCodeAgain}
              </Key>
            ) : null}
            <Key size="sm" onClick={close}>
              {C.done}
            </Key>
          </div>
        </div>
      ) : (
        <div>
          <Key
            ref={openRef}
            loading={busy}
            disabledReason={disabled ? C.unreachable : undefined}
            onClick={() => void make()}
          >
            {C.addDevice}
          </Key>
        </div>
      )}
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
    </div>
  );
}

/** The apps that are not a browser (the shells' origins, as the home server allows them). */
const DESKTOP_ORIGIN = 'app://vitals';
const PHONE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

/**
 * What a paired device is, in one word: Gauge (a Lumen token), an agent, the desktop app, a phone (the Android app, or
 * a browser on a phone) or a browser. The server says where a device paired from; this device knows its own platform;
 * an older server's list falls back to the default label ("Chrome on Android").
 */
function deviceKind(d: Pick<ServerDevice, 'kind' | 'label' | 'current' | 'origin'>): string {
  if (d.kind === 'lumen') return C.kindGauge;
  if (d.kind === 'agent') return C.kindAgent;
  const here = d.current ? platform() : null;
  if (here === 'electron' || d.origin === DESKTOP_ORIGIN) return C.kindDesktop;
  if (here === 'android' || (d.origin && PHONE_ORIGINS.has(d.origin))) return C.kindPhone;
  if ((here === 'web' || here === 'pwa') && /Android|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? ''))
    return C.kindPhone;
  if (!here && /\bon (Android|iPhone)$/.test(d.label)) return C.kindPhone;
  return C.kindBrowser;
}

/** Present only the old app's generated device-name prefix differently; keep custom labels and stored ids intact. */
function deviceDisplayLabel(d: ServerDevice): string {
  const label = d.label || d.id;
  if (d.kind !== 'lumen') return label;
  return label.replace(/^Gauge(?=\s*(?:·|$))/, C.kindGauge);
}

function DevicesGroup({ rev, disabled }: { rev: number; disabled: boolean }) {
  const client = useServerClient();
  const now = useServerNow();
  const [devices, setDevices] = useState<ServerDevice[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ServerDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void client.devices().then(
      (d) => {
        if (!live) return;
        setDevices(d);
        setError(null);
      },
      (e: unknown) =>
        live &&
        !(e instanceof ServerError && (e.code === 'unauthorized' || e.code === 'revoked')) &&
        setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [client, rev]);

  const revoke = async (d: ServerDevice) => {
    setBusy(true);
    try {
      await client.revokeDevice(d.id);
      setRemoved((s) => new Set(s).add(d.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const sorted = devices
    ? [...devices].sort((a, b) => (a.current ? -1 : b.current ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt)))
    : [];
  return (
    <SettingsGroup label={C.devicesTitle}>
      {error ? (
        <SettingsItem>
          <InlineWarning severity="danger" alert>
            {error}
          </InlineWarning>
        </SettingsItem>
      ) : null}
      {devices && devices.length === 0 ? (
        <SettingsItem>
          <p className="settings-note">{C.devicesNone}</p>
        </SettingsItem>
      ) : null}
      {sorted.length ? (
        <ul className={`settings-list ${disabled ? 'opacity-60' : ''}`}>
          {sorted.map((d) => {
            const gone = removed.has(d.id);
            const label = deviceDisplayLabel(d);
            const kind = deviceKind(d);
            const showKind = kind.toLowerCase() !== label.toLowerCase() && !(d.kind === 'lumen' && label.startsWith(`${kind} ·`));
            return (
              <li key={d.id}>
                <Icon
                  icon={
                    kind === C.kindAgent
                      ? Bot
                      : kind === C.kindGauge
                        ? Circle
                        : kind === C.kindDesktop
                          ? Monitor
                          : kind === C.kindPhone
                            ? Smartphone
                            : Globe
                  }
                  size={22}
                  className="settings-device-icon"
                />
                <div className="settings-list__text">
                  <span className="settings-list__title">
                    {label}
                    {showKind ? (
                      <span className="text-ink-2"> · {kind}</span>
                    ) : null}
                    {d.current ? <span className="text-ink-2"> · {C.thisDevice}</span> : null}
                  </span>
                  <span
                    className="settings-freshness"
                    data-fresh={(!gone && now - Date.parse(d.lastSeenAt) < 300_000) || undefined}
                  >
                    <StatusDot
                      tone="neutral"
                      label={gone ? C.removedNow : C.seen(relativeTime(d.lastSeenAt, new Date(now)))}
                    />
                    {!gone ? <MonoMeta>{C.pairedOn(formatDay(d.createdAt))}</MonoMeta> : null}
                  </span>
                </div>
                {!d.current && !gone ? (
                  d.kind === 'agent' ? (
                    <KeyLink to="/settings/agents" variant="text" size="sm">
                      Agent keys
                    </KeyLink>
                  ) : (
                    <IconKey
                      icon={Trash2}
                      label={C.revokeName(label)}
                      onClick={() => setConfirm(d)}
                    />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {devices ? (
        <SettingsItem>
          <MonoMeta>
            {devices.length - removed.size} devices ·{' '}
            {
              devices.filter((d) => !removed.has(d.id) && now - Date.parse(d.lastSeenAt) < 300_000)
                .length
            }{' '}
            online
          </MonoMeta>
        </SettingsItem>
      ) : null}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        role="alertdialog"
        title={
          confirm
            ? (confirm.kind === 'agent' ? C.revokeAgentTitle : C.revokeTitle)(deviceDisplayLabel(confirm))
            : ''
        }
        footer={
          <>
            <Key onClick={() => setConfirm(null)}>{C.cancel}</Key>
            <Key variant="danger" loading={busy} onClick={() => confirm && void revoke(confirm)}>
              {confirm?.kind === 'agent' ? C.revokeAgentConfirm : C.revokeConfirm}
            </Key>
          </>
        }
      >
        <p className="m-0">{confirm?.kind === 'agent' ? C.revokeAgentBody : C.revokeBody}</p>
        {confirm?.kind === 'agent' ? null : <p className="m-0 text-sm text-ink-2">{C.revokeKeepsKey}</p>}
      </Dialog>
    </SettingsGroup>
  );
}
