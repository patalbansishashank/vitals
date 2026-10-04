/**
 * Settings › Devices › "Lumen Health over MQTT" (design/screens/settings-data.md §11.1). Reads the person's server for
 * the broker status, makes and removes broker logins (the password is shown once, then gone) and explains events the
 * server set aside. Stream switches stay the ones in the list below; this card only points to them.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Dialog, Engraved, Key, KeyLink, StatusMark, toast } from '@/components';
import {
  allowNewPhone,
  createMqttCredential,
  getMqttStatus,
  getServerConnection,
  MqttRequestError,
  revokeMqttCredential,
  subscribeServerConnection,
  type MqttCredential,
  type MqttStatus,
} from '@/net/mqtt';
import { streamName } from './copy';
import { RingBatteryLine, whenText } from './RingBatteryLine';

export const MQTT = {
  title: 'Lumen Health over MQTT',
  intro: 'Your ring’s data can arrive through the Lumen Health app on your phone. The app sends each event to your own server, and Vitals reads it from there.',
  notPaired: 'Pair a server first. Your ring’s data is sent to your server, so this needs one.',
  pair: 'Open Server settings',
  loading: 'Asking your server…',
  error: 'Your server did not answer, so Vitals can’t show this. Check that it is running and that this device can reach it, then try again.',
  unauthorized: 'Your server no longer accepts this device. Pair it again in Server settings.',
  retry: 'Try again',
  disabled: 'The feed from Lumen Health is switched off on your server. Turn it on in the server’s settings to use it.',
  noLogins: 'No broker login yet. Make one, then paste its values into Lumen Health.',
  create: 'Create broker login',
  creating: 'Creating…',
  full: 'You already have two broker logins. Remove one to make another.',
  historyTitle: 'Your Lumen Health history',
  historyHelp: 'Import your Lumen Health history before connecting live, so older days are filled in first. Events that arrive later are not counted twice.',
  historyKey: 'Import your Lumen Health history…',
  address: 'address',
  state: { connected: 'connected', waiting: 'not connected now', never: 'never connected' },
  lastConnect: (t: string) => `last connected ${t}`,
  lastEvent: 'last event',
  ring: 'ring',
  noEvent: 'Nothing has arrived yet. Check the values in Lumen Health and that your phone can reach your server.',
  today: 'today',
  noneToday: 'nothing yet',
  setAside: 'set aside',
  setAsideCount: (today: number, week: number) => `${today} today · ${week} in the last 7 days`,
  seeWhy: 'See why',
  whyTitle: 'Events set aside',
  whyIntro: 'Your server keeps these out of your data because it couldn’t use them. Nothing to do unless the count keeps rising.',
  whyLast: 'Most recent reason',
  whyWeek: 'In the last 7 days',
  close: 'Close',
  removeLogin: 'Remove login',
  newPhone: 'Allow a new phone',
  newPhoneDone: 'Done. The next phone that connects with this login will be accepted.',
  removeTitle: (u: string) => `Remove login ${u}?`,
  removeBody: 'Lumen Health is disconnected at once and stops sending until you paste a different login. Nothing already received is lost.',
  cancel: 'Cancel',
  removed: 'Login removed.',
  switchesNote: 'What is used from these events is chosen with the switches for each stream in the list below. Nothing drives your scores or your plan until you switch it on.',
  onceTitle: 'Shown once',
  onceBody: 'Copy these into Lumen Health now. You will not see this password again. If you lose it, remove the login and make a new one.',
  saved: 'I’ve pasted these into Lumen Health',
  done: 'Done',
  copy: 'Copy',
  copied: 'Copied',
  copyAll: 'Copy all',
  fields: { address: 'address', baseTopic: 'base topic', clientId: 'client id', username: 'username', password: 'password' },
  clientIdHint: 'anything you like, for example “vitals-phone”',
  reason: {
    too_large: 'The event was far bigger than any real one, so it was not read.',
    not_json: 'The event was not readable text, so it was not read.',
    not_cloudevent: 'The event did not have the envelope Lumen Health puts around its events.',
    wrong_installation: 'The event came from a different phone than the one this login is tied to. Use “Allow a new phone” if you changed phones.',
    unknown_type: 'The event is a type Vitals doesn’t know yet.',
    invalid_payload: 'The event was damaged or incomplete.',
    validation_failed: 'The event had values that don’t make sense, such as a heart rate of 900.',
    import_error: 'Vitals could not store the event. It was kept aside rather than lost.',
  } as Record<string, string>,
  reasonOther: 'The server set the event aside for a reason this version of Vitals can’t explain.',
};

type Load = { kind: 'loading' } | { kind: 'ok'; status: MqttStatus } | { kind: 'error'; text: string };

const errText = (e: unknown): string => (e instanceof MqttRequestError && (e.status === 401 || e.status === 403) ? MQTT.unauthorized : MQTT.error);
/** Same style as the ring's battery line in this card: "19:28", "yesterday 19:28", "28 Sep 19:28". */
const when = (iso: string | null): string => (iso ? (whenText(iso) ?? iso) : '');

function CopyKey({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Key
      size="sm"
      variant="quiet"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }, () => toast('Couldn’t copy. Select the value and copy it by hand.'));
      }}
    >
      {done ? MQTT.copied : MQTT.copy}
      <span className="sr-only"> {label}</span>
    </Key>
  );
}

/** The shown-once block (design/COMPONENTS.md §15.2, variant credentials). The password lives only in this component. */
function ShownOnce({ cred, onDone }: { cred: MqttCredential; onDone: () => void }) {
  const [ticked, setTicked] = useState(false);
  const rows: Array<[string, string, string]> = [
    ['address', MQTT.fields.address, cred.address],
    ['baseTopic', MQTT.fields.baseTopic, cred.baseTopic],
    ['username', MQTT.fields.username, cred.username],
    ['password', MQTT.fields.password, cred.password],
  ];
  const all = [...rows.map(([, l, v]) => `${l}: ${v}`), `${MQTT.fields.clientId}: ${MQTT.clientIdHint}`].join('\n');
  return (
    <div role="group" aria-label={MQTT.onceTitle} className="mt-3 rounded-md border border-line p-3">
      <p className="m-0 flex items-start gap-2 text-sm font-medium text-ink">
        <StatusMark severity="caution" size={16} />
        <span>
          <strong>{MQTT.onceTitle}.</strong> {MQTT.onceBody}
        </span>
      </p>
      <dl className="m-0 mt-3 grid gap-2">
        {rows.map(([k, label, value]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2">
            <dt className="text-xs text-ink-2">{label}</dt>
            <dd className="m-0 select-all break-all rounded bg-well px-2 py-1 text-[15px] tabular-nums" data-testid={`once-${k}`}>
              {value}
            </dd>
            <CopyKey value={value} label={label} />
          </div>
        ))}
        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
          <dt className="text-xs text-ink-2">{MQTT.fields.clientId}</dt>
          <dd className="m-0 text-xs text-ink-2">{MQTT.clientIdHint}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyKey value={all} label={MQTT.copyAll} />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ticked} onChange={(e: ChangeEvent<HTMLInputElement>) => setTicked(e.target.checked)} />
        {MQTT.saved}
      </label>
      <div className="mt-2">
        <Key size="sm" disabledReason={ticked ? undefined : 'Tick the box once you have pasted the values.'} onClick={onDone}>
          {MQTT.done}
        </Key>
      </div>
    </div>
  );
}

function SeeWhy({ open, status, onClose }: { open: boolean; status: MqttStatus; onClose: () => void }) {
  const r = status.deadLetters.lastReason;
  const byReason = Object.entries(status.deadLetters.byReason ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Dialog open={open} onClose={onClose} title={MQTT.whyTitle} footer={<Key onClick={onClose}>{MQTT.close}</Key>}>
      <p className="m-0">{MQTT.whyIntro}</p>
      <p className="m-0 mt-2 text-sm">{MQTT.setAsideCount(status.deadLetters.today, status.deadLetters.last7d)}</p>
      {r ? (
        <p className="m-0 mt-2 text-sm">
          <strong>{MQTT.whyLast}:</strong> {MQTT.reason[r] ?? MQTT.reasonOther}
        </p>
      ) : null}
      {byReason.length ? (
        <>
          <p className="m-0 mt-3 text-sm">
            <strong>{MQTT.whyWeek}</strong>
          </p>
          <ul className="m-0 mt-1 grid gap-1 pl-5 text-sm" aria-label={MQTT.whyWeek}>
            {byReason.map(([k, n]) => (
              <li key={k}>
                <span className="tabular-nums">{n}</span> · {MQTT.reason[k] ?? MQTT.reasonOther}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="m-0 mt-3 grid gap-1 pl-5 text-sm">
          {Object.entries(MQTT.reason).map(([k, text]) => (
            <li key={k}>{text}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function MqttCard({ onImportFile }: { onImportFile: (f: File) => void }) {
  const conn = useSyncExternalStore(subscribeServerConnection, () => getServerConnection()?.baseUrl ?? null, () => null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<MqttCredential | null>(null);
  const [why, setWhy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pinCleared, setPinCleared] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: 'ok', status: await getMqttStatus() });
    } catch (e) {
      setLoad({ kind: 'error', text: errText(e) });
    }
  }, []);
  useEffect(() => {
    if (!conn) return;
    let live = true;
    getMqttStatus().then(
      (status) => live && setLoad({ kind: 'ok', status }),
      (e: unknown) => live && setLoad({ kind: 'error', text: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [conn]);

  const create = async () => {
    setBusy(true);
    try {
      setFresh(await createMqttCredential());
      await refresh();
    } catch (e) {
      toast(e instanceof MqttRequestError && e.status === 409 ? MQTT.full : errText(e));
    }
    setBusy(false);
  };

  let body;
  if (!conn) {
    body = (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="m-0 text-sm text-ink-2">{MQTT.notPaired}</p>
        <KeyLink to="/settings/server" size="sm" trailingIcon={ChevronRight}>
          {MQTT.pair}
        </KeyLink>
      </div>
    );
  } else if (load.kind === 'loading') {
    body = <p className="m-0 mt-2 text-sm text-ink-2">{MQTT.loading}</p>;
  } else if (load.kind === 'error') {
    body = (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p role="alert" className="m-0 text-sm">{load.text}</p>
        <Key size="sm" onClick={() => void refresh()}>
          {MQTT.retry}
        </Key>
      </div>
    );
  } else {
    const st = load.status;
    const total = st.eventsToday.reduce((n, e) => n + e.count, 0);
    body = !st.enabled ? (
      <p className="m-0 mt-2 text-sm text-ink-2">{MQTT.disabled}</p>
    ) : (
      <>
        {fresh ? <ShownOnce cred={fresh} onDone={() => setFresh(null)} /> : null}
        <dl className="m-0 mt-3 grid gap-2 text-sm">
          {st.address ? (
            <Row label={MQTT.address}>
              <span className="break-all tabular-nums">{st.address}</span> <CopyKey value={st.address} label={MQTT.address} />
            </Row>
          ) : null}
          {st.credentials.length === 0 ? <p className="m-0 text-ink-2">{MQTT.noLogins}</p> : null}
          {st.credentials.map((c) => {
            const word = c.connected ? MQTT.state.connected : c.lastConnectAt ? MQTT.state.waiting : MQTT.state.never;
            return (
              <Row key={c.username} label={MQTT.fields.username}>
                <span className="tabular-nums">{c.username}</span>
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <StatusMark severity={c.connected ? 'ok' : 'info'} size={16} />
                  {word}
                  {!c.connected && c.lastConnectAt ? ` · ${MQTT.lastConnect(when(c.lastConnectAt))}` : ''}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Key size="sm" variant="quiet" onClick={() => void allowNewPhone(c.username).then(() => setPinCleared(c.username), (e) => toast(errText(e)))}>
                    {MQTT.newPhone}
                    <span className="sr-only"> for {c.username}</span>
                  </Key>
                  <Key size="sm" variant="quiet" onClick={() => setRemoving(c.username)}>
                    {MQTT.removeLogin}
                    <span className="sr-only"> {c.username}</span>
                  </Key>
                </span>
                {pinCleared === c.username ? <span role="status" className="basis-full text-xs text-ink-2">{MQTT.newPhoneDone}</span> : null}
              </Row>
            );
          })}
          <Row label={MQTT.lastEvent}>{st.lastEventAt ? <span className="tabular-nums">{when(st.lastEventAt)}</span> : <span className="text-ink-2">{MQTT.noEvent}</span>}</Row>
          {st.battery || st.lastEventAt ? (
            <Row label={MQTT.ring}>
              <RingBatteryLine className="m-0" battery={st.battery ?? null} lastDataAt={st.lastEventAt} />
            </Row>
          ) : null}
          <Row label={MQTT.today}>
            {st.eventsToday.length === 0 ? (
              <span className="text-ink-2">{MQTT.noneToday}</span>
            ) : (
              <span className="tabular-nums" title={`${total}`}>
                {st.eventsToday.map((e) => `${streamName(e.stream)} ${e.count}`).join(' · ')}
              </span>
            )}
          </Row>
          {st.deadLetters.last7d > 0 || st.deadLetters.today > 0 ? (
            <Row label={MQTT.setAside}>
              <span className="tabular-nums">{MQTT.setAsideCount(st.deadLetters.today, st.deadLetters.last7d)}</span>
              <Key size="sm" variant="quiet" onClick={() => setWhy(true)}>
                {MQTT.seeWhy}
              </Key>
            </Row>
          ) : null}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Key size="sm" loading={busy} disabledReason={st.credentials.length >= 2 ? MQTT.full : fresh ? 'Finish with the values shown above first.' : undefined} onClick={() => void create()}>
            {MQTT.create}
          </Key>
        </div>
        <p className="m-0 mt-3 text-xs text-ink-2">{MQTT.switchesNote}</p>
        <SeeWhy open={why} status={st} onClose={() => setWhy(false)} />
        <Dialog
          open={removing !== null}
          onClose={() => setRemoving(null)}
          role="alertdialog"
          title={MQTT.removeTitle(removing ?? '')}
          footer={
            <>
              <Key onClick={() => setRemoving(null)}>{MQTT.cancel}</Key>
              <Key
                variant="danger"
                onClick={async () => {
                  const u = removing;
                  setRemoving(null);
                  if (!u) return;
                  try {
                    await revokeMqttCredential(u);
                    toast(MQTT.removed);
                  } catch (e) {
                    toast(errText(e));
                  }
                  await refresh();
                }}
              >
                {MQTT.removeLogin}
              </Key>
            </>
          }
        >
          <p className="m-0">{MQTT.removeBody}</p>
        </Dialog>
      </>
    );
  }

  return (
    <section className="mt-4 border-t border-line pt-4" aria-label={MQTT.title}>
      <Engraved as="p" className="m-0">
        {MQTT.title}
      </Engraved>
      <p className="m-0 mt-1 text-xs text-ink-2">{MQTT.intro}</p>
      {body}
      {conn ? (
        <div className="mt-3">
          <p className="m-0 text-xs text-ink-2">{MQTT.historyHelp}</p>
          <div className="mt-2">
            <Key size="sm" onClick={() => file.current?.click()}>
              {MQTT.historyKey}
            </Key>
            <input
              ref={file}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label={MQTT.historyKey}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImportFile(f);
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-2">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">{children}</dd>
    </div>
  );
}
