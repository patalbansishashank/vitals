/**
 * Settings › Server (design/screens/server.md; SUITE_SPEC §14.2, §14.7): pair this device with the person's server once,
 * see that it answers, add and remove devices, and read in plain words what the server holds. Every control here is
 * UI-only: pairing, revoking and forgetting are server calls through `src/net/server.ts`, never commands, so neither the
 * Coach nor an agent can reach them. Right after pairing, a home server hands this device the person's sync key once and
 * sync starts on the words' own path (`sync.join`, see `./serverSync.ts`).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, KeyRound, Link2, RefreshCw, ScanLine, Trash2 } from 'lucide-react';
import { RingMark } from '@/components/brand/RingMark';
import { Chip, Dialog, Faceplate, FaceplateHeader, Field, InlineWarning, Key, KeyValueList, Notice, TextInput, toast, type Severity } from '@/components';
import { mintConfirmation } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { platformCaps } from '@/platform';
import { useSyncView, type SyncView } from '@/state/sync';
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
import { ExistingDataDialog } from '../sync/ExistingDataDialog';
import { QrCode } from '../sync/QrCode';
import { SyncPillView } from '../sync/SyncPill';
import { countdown, formatDay, relativeTime, SERVER_COPY as C } from './copy';
import { useServerClient, useServerConnection, useServerPairing } from './hooks';
import { PairingCodeField } from './PairingCodeField';
import { dropHeldSyncKey, joinSyncFromServer, syncsThroughServer } from './serverSync';

const ScanDialog = lazy(() => import('../sync/ScanDialog'));

const TITLE_ID = 'settings-server-title';
const wrap = 'break-words [overflow-wrap:anywhere]';
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
      <Chip kind="status" severity={severity}>
        {word}
      </Chip>
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
  const [existing, setExisting] = useState<{ summary: string; resolve: (c: 'merge' | 'replace') => void } | null>(null);
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
    <div id="server" className="grid scroll-mt-2 gap-4">
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
  const removed = connection.state === 'revoked' || ended?.reason === 'revoked' || ended?.reason === 'unauthorized';
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
    <Faceplate as="section" aria-labelledby={TITLE_ID}>
      <FaceplateHeader title={C.title} titleId={TITLE_ID} actions={<ServerPill connection={removed ? { state: 'revoked' } : { state: 'unpaired' }} />} />
      <div className="grid gap-4">
        {removed ? (
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
        ) : null}
        {forgotten ? (
          <Notice severity="info" layout="ruled" title={C.forgotten} onDismiss={onDismissForgotten} />
        ) : null}
        <div className="flex items-start gap-3">
          <RingMark size={36} className="mt-0.5 shrink-0" />
          <div className="grid gap-1">
            <p className="m-0 text-[15px] leading-[1.5] text-ink">{C.intro}</p>
            <p className="m-0 text-sm text-ink-2">{C.introOnce}</p>
          </div>
        </div>
        {platformCaps().installedApp ? null : <p className="m-0 max-w-[68ch] text-xs leading-[1.45] text-ink-2">{C.localNetwork}</p>}
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
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Key ref={enterRef} icon={KeyRound} block className="sm:w-auto" onClick={() => setOpen(true)}>
              {C.enterCode}
            </Key>
            <Key icon={ScanLine} block className="sm:w-auto" onClick={() => setScan(true)}>
              {C.scan}
            </Key>
          </div>
        )}
        <div className="grid gap-1 border-t border-line pt-4">
          <a className="lm-link text-sm" href={C.noServerUrl} target="_blank" rel="noreferrer noopener">
            {C.noServer} ›
          </a>
          <p className="m-0 text-xs leading-[1.45] text-ink-2">{C.noServerHelp}</p>
        </div>
      </div>
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
    </Faceplate>
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
        if (err.code === 'invalid_code' || err.code === 'expired' || err.code === 'locked' || err.code === 'bad_request') {
          setCodeError(err.code === 'invalid_code' && err.attemptsLeft !== undefined ? `${err.message} ${C.attemptsLeft(err.attemptsLeft)}` : err.message);
        } else if (err.code === 'invalid_address' || err.code === 'http_address' || err.code === 'not_vitals') {
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
    <div className="grid gap-3 rounded-md border border-line p-3">
      {fromLink && initial ? <p className="m-0 text-sm font-[550] text-ink">{C.linkAsk(hostOf(initial.baseUrl))}</p> : null}
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
      <Field label={C.nameLabel}>
        <TextInput autoComplete="off" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="m-0 min-h-[1.25rem] text-sm text-ink-2" aria-live="polite">
        {step === 'reach' ? C.stepReach : step === 'code' ? C.stepCode : ''}
      </p>
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Key variant="solid" loading={busy} disabledReason={busy ? C.pairing : complete ? undefined : C.codeIncomplete} onClick={() => void pair()}>
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
  retrying: boolean;
}) {
  const client = useServerClient();
  const sync = useSyncView();
  const [checking, setChecking] = useState(false);
  const [devicesRev, setDevicesRev] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);
  const status = connection.state === 'reachable' || connection.state === 'version' ? connection.status : null;
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
  const syncWord: ReactNode = sync.status.state === 'synced' || sync.status.state === 'syncing' ? C.syncOn : <SyncPillView status={sync.status} />;
  const syncState: ReactNode = !sync.paired ? (
    C.syncOff
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
    {
      key: C.keys.answers,
      value: connection.state === 'reachable' ? C.answersYes(connection.latencyMs) : connection.state === 'checking' ? C.answersChecking : connection.state === 'version' ? 'yes' : C.answersNo,
    },
    { key: C.keys.lastContact, value: relativeTime(lastContact) },
    ...(status?.server.version ? [{ key: C.keys.version, value: status.server.version }] : []),
    ...(role ? [{ key: C.keys.role, value: role }] : []),
    { key: C.keys.sync, value: syncState },
    { key: C.keys.device, value: status?.label || pairing.deviceId },
  ];

  return (
    <>
      <Faceplate as="section" aria-labelledby={TITLE_ID}>
        <FaceplateHeader title={C.title} titleId={TITLE_ID} actions={<ServerPill connection={connection} />} />
        <div className="grid gap-4">
          {connection.state === 'unreachable' ? (
            <Notice
              severity={connection.error.code === 'server_busy' ? 'info' : 'caution'}
              layout="ruled"
              title={connection.error.code === 'local_network_denied' || connection.error.code === 'server_busy' ? connection.error.message : C.unreachable}
              actions={
                <Key size="sm" icon={RefreshCw} loading={checking} onClick={() => void checkNow()}>
                  {C.tryAgain}
                </Key>
              }
            >
              {lastContact ? C.lastContactAt(relativeTime(lastContact)) : null}
            </Notice>
          ) : null}
          {connection.state === 'version' ? <Notice severity="caution" layout="ruled" title={C.versionOld(connection.status.server.version, MIN_SERVER_VERSION)} /> : null}
          <div className="grid gap-4 min-[1200px]:grid-cols-2">
            <div className="grid gap-2">
              <KeyValueList items={items} />
              <p className="m-0 text-xs leading-[1.45] text-ink-2">{C.readable}</p>
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
              {!sync.paired ? <p className="m-0 text-xs leading-[1.45] text-ink-2">{C.syncHint}</p> : null}
              <div>
                <Key size="sm" icon={RefreshCw} loading={checking || connection.state === 'checking'} onClick={() => void checkNow()}>
                  {C.checkNow}
                </Key>
              </div>
            </div>
            <div className="border-t border-line pt-4 min-[1200px]:border-0 min-[1200px]:pt-0">
              <AddDevice baseUrl={pairing.baseUrl} onPaired={() => setDevicesRev((n) => n + 1)} disabled={connection.state === 'unreachable' && connection.error.code !== 'server_busy'} />
            </div>
          </div>
        </div>
      </Faceplate>

      <DevicesFaceplate rev={devicesRev} disabled={connection.state === 'unreachable' && connection.error.code !== 'server_busy'} />

      <Faceplate as="section" aria-labelledby="settings-server-holds-title">
        <FaceplateHeader title={C.holdsTitle} titleId="settings-server-holds-title" />
        <div className="grid gap-3">
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm leading-[1.5] text-ink">
            {C.holds.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="m-0 max-w-[68ch] text-sm leading-[1.5] text-ink-2">{C.holdsRead}</p>
          <div className="grid gap-1 border-t border-line pt-4">
            <div>
              <Key variant="danger" onClick={() => setConfirmForget(true)}>
                {C.forget}
              </Key>
            </div>
            <p className="m-0 text-xs text-ink-2">{C.forgetHelp}</p>
          </div>
        </div>
      </Faceplate>

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
              onClick={() => {
                setConfirmForget(false);
                // the confirm says this device stops syncing: the relay on this server does not check the device token,
                // so forgetting the pairing alone would leave sync running through it. Stopping keeps this device's data.
                const stopSync = syncsThroughServer(sync, pairing.baseUrl);
                client.forget();
                onForgot();
                if (stopSync)
                  void sendCommand('sync.unpair', {}, { confirmation: mintConfirmation('sync.unpair', {}), silent: true }).then((r) => {
                    if (!r.ok) toast(C.forgetSyncFailed(r.error.message));
                  });
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

function AddDevice({ baseUrl, onPaired, disabled }: { baseUrl: string; onPaired: () => void; disabled: boolean }) {
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
      void client.devices().then((d) => {
        const added = d.find((x) => !known!.has(x.id));
        if (added) {
          setAnnounce(`${added.label} paired.`);
          onPaired();
          setCode(null);
        }
      }, () => undefined);
    }, 4000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(poll);
    };
  }, [client, code, onPaired]);

  const display = code ? `${code.code.slice(0, 4)}–${code.code.slice(4)}` : '';
  const link = code ? pairingLinkFor(code.qr, typeof window === 'undefined' ? undefined : window.location.origin) : '';
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast(C.newCodeCopied), () => undefined);
  return (
    <div className="grid gap-2">
      <p className="lm-sr" aria-live="polite">
        {announce}
      </p>
      {code ? (
        <div role="region" aria-labelledby="server-new-code-title" className="grid gap-3 rounded-md border border-line p-3">
          <h3 id="server-new-code-title" className="lm-eng m-0">
            {C.newCodeTitle}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[28px] font-[500] tabular-nums tracking-[0.08em] text-ink">{display}</span>
            <Key size="sm" icon={Copy} onClick={() => copy(code.code)}>
              {C.newCodeCopy}
            </Key>
            <Key size="sm" icon={Link2} onClick={() => copy(link)}>
              {C.newCodeCopyLink}
            </Key>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <QrCode text={link} label={C.newCodeTitle} className="w-[200px] max-w-full shrink-0 rounded-sm" />
            <p className={`m-0 min-w-[12rem] flex-1 text-sm leading-[1.5] text-ink-2 ${wrap}`}>{C.newCodeHow(baseUrl)}</p>
          </div>
          <p className="m-0 text-sm tabular-nums text-ink">{left > 0 ? C.newCodeExpires(countdown(left)) : C.newCodeExpired}</p>
          <InlineWarning severity="caution">{C.newCodeCaution}</InlineWarning>
          <div className="flex flex-wrap gap-2">
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
          <Key ref={openRef} loading={busy} disabledReason={disabled ? C.unreachable : undefined} onClick={() => void make()}>
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

function DevicesFaceplate({ rev, disabled }: { rev: number; disabled: boolean }) {
  const client = useServerClient();
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
      (e: unknown) => live && !(e instanceof ServerError && (e.code === 'unauthorized' || e.code === 'revoked')) && setError(e instanceof Error ? e.message : String(e)),
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

  const sorted = devices ? [...devices].sort((a, b) => (a.current ? -1 : b.current ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt))) : [];
  return (
    <Faceplate as="section" aria-labelledby="settings-server-devices-title">
      <FaceplateHeader title={C.devicesTitle} titleId="settings-server-devices-title" actions={devices ? <span className="text-sm tabular-nums text-ink-2">{devices.length}</span> : null} />
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      {devices && devices.length === 0 ? <p className="m-0 text-sm text-ink-2">{C.devicesNone}</p> : null}
      <ul className={`m-0 grid list-none p-0 ${disabled ? 'opacity-60' : ''}`}>
        {sorted.map((d) => {
          const gone = removed.has(d.id);
          return (
            <li key={d.id} className="grid gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
              <div className="grid min-w-0 gap-0.5">
                <span className={`text-sm font-[550] text-ink ${wrap}`}>
                  {d.label || d.id}
                  <span className="font-normal text-ink-2"> · {d.kind === 'agent' ? C.kindAgent : C.kindBrowser}</span>
                  {d.current ? <span className="font-normal text-ink-2"> · {C.thisDevice}</span> : null}
                </span>
                <span className="text-xs text-ink-2">{gone ? C.removedNow : `${C.pairedOn(formatDay(d.createdAt))} · ${C.seen(relativeTime(d.lastSeenAt))}`}</span>
              </div>
              {!d.current && !gone ? (
                <div className="justify-self-end">
                  <Key size="sm" variant="quiet" icon={Trash2} aria-label={C.revokeName(d.label || d.id)} onClick={() => setConfirm(d)}>
                    {C.revoke}
                  </Key>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        role="alertdialog"
        title={confirm ? (confirm.kind === 'agent' ? C.revokeAgentTitle : C.revokeTitle)(confirm.label || confirm.id) : ''}
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
    </Faceplate>
  );
}
