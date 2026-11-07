import { useEffect, useRef, useState } from 'react';
import { Bluetooth, HeartPulse, RefreshCw, Ellipsis, ShieldCheck, Upload } from 'lucide-react';
import {
  Columns,
  Dialog,
  CardFoot,
  ChartTwin,
  radialTwin,
  CardHead,
  GradientCard,
  HeroNumber,
  Menu,
  MonoMeta,
  RadialTicks,
  Key,
  KeyBank,
  KeyLink,
  RadioGroup,
  ResponsivePanel,
  Spinner,
  Stack,
} from '@/components';
import { gaugeEngine, RING_STATE_WORD, ringAuthenticationPending, ringCredentialIssue, ringDataReady, type EngineState, type MeasureKind } from '@/platform/gaugeEngine';
import { engine, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { useQuietMode } from '@/state/settingsStore';
import { quietAge } from '../quiet';
import { useNow } from '../useGauge';
import { batteryWord } from '../views/RingStatusCard';
import { ENGINE_COPY as C, whenText } from './copy';
import { MoveFromGauge } from './MoveFromGauge';
import { PermissionRows } from './PermissionRows';
import { PERMISSION_KEYS } from '@/platform/gaugeEngine';
import { useEngineMeasure } from './useEngineMeasure';
import './engine.css';

/**
 * (r070) Ring › Device (`/ring/device`), Android app only: the ring this phone talks to, what it sends to the server and
 * what it may do. Every control calls the engine on the phone; nothing goes through the server.
 */
export function DeviceView() {
  const eng = useGaugeEngine();
  const s = eng.state;
  if (!s) return <Spinner size={16} label={C.syncing} />;
  return (
    <Stack>
      {/* the permissions card below does step 3 here */}
      <MoveFromGauge except="permissions" />
      <Columns>
        <Stack>
          <RingCard s={s} />
          <MeasureCard s={s} />
        </Stack>
        <Stack>
          <UploadCard s={s} />
          <GradientCard
            as="section"
            domain="neutral"
            head={
              <CardHead
                as="h2"
                icon={ShieldCheck}
                title={C.permissionsTitle}
                info={{
                  title: 'Permissions',
                  body: 'What Vitals needs on this phone to talk to the ring and count short videos. A runtime permission asks in place; accessibility and battery settings open Android settings. The short-video limit is optional and only needed if you use it.',
                  source: { kind: 'phone', words: 'Android permission and settings state.' },
                }}
              />
            }
            foot={<CardFoot right="On this phone" />}
          >
            <PermissionRows
              withStatus
              items={PERMISSION_KEYS.map((key) => ({
                key,
                optional: key === 'shortVideoAccessibility' && !s.shortVideo.enabled,
              }))}
            />
          </GradientCard>
        </Stack>
      </Columns>
    </Stack>
  );
}

function RingCard({ s }: { s: EngineState }) {
  const eng = useGaugeEngine();
  const now = useNow();
  const quiet = useQuietMode().on;
  const [scanning, setScanning] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const r = s.ring;
  const credentialIssue = ringCredentialIssue(s);
  const authenticating = ringAuthenticationPending(s);
  const has = r.state !== 'none';
  const connected = ringDataReady(s);
  const syncing = isBusy(eng, 'sync');
  const failed = credentialIssue || authenticating ? null :
    eng.error && ['sync', 'forget', 'connect'].includes(eng.error.action)
      ? eng.error.message
      : r.lastError
        ? C.ringError(r.lastError)
        : null;
  return (
    <>
      <GradientCard
        as="section"
        domain="neutral"
        head={
          <CardHead
            as="h2"
            icon={Bluetooth}
            title={C.ring}
            info={{
              title: 'Your ring',
              body: 'The ring this phone talks to over Bluetooth. Sync now reads what the ring holds and sends it to your server. Connect another ring replaces this one. Forget ring stops Vitals talking to it; readings already sent stay on your server.',
              source: { kind: 'phone', words: 'The Vitals ring engine on this phone.' },
              twin: !quiet ? (
                <ChartTwin
                  data={radialTwin({ label: 'Ring battery', value: r.battery ?? null, max: 100, unit: '%' })}
                />
              ) : undefined,
              range: quiet ? 'Battery shown as Low or Fine.' : 'Battery 0–100 %. Low is 20 % or less.',
            }}
          />
        }
        foot={
          <CardFoot
            state={{ word: credentialIssue === 'missing' ? C.ringAccessPending : credentialIssue === 'rejected' ? C.ringAccessFailed : authenticating ? C.authenticating : RING_STATE_WORD[r.state], icon: Bluetooth }}
            right={has ? `${C.lastSync} ${deviceWhen(r.lastSyncAt, now, quiet)}` : undefined}
          >
            {has ? (
              <Key
                variant="primary"
                icon={RefreshCw}
                arrow
                loading={syncing}
                disabled={!connected}
                disabledReason={connected ? undefined : credentialIssue ? C.ringAccessBlocked : authenticating ? C.authenticatingWait : C.syncNeedsRing}
                onClick={() => void engine.syncNow()}
              >
                {C.syncNow}
              </Key>
            ) : null}
            {has ? (
              <Menu
                label="Ring actions"
                trigger={(props) => (
                  <Key {...props} variant="text" size="sm" icon={Ellipsis}>
                    Ring actions
                  </Key>
                )}
                items={[
                  { id: 'connect', label: C.scanOther, icon: Bluetooth, onSelect: () => setScanning(true) },
                  {
                    id: 'forget',
                    label: C.forget,
                    tone: 'danger',
                    disabled: isBusy(eng, 'forget'),
                    onSelect: () => setForgetting(true),
                  },
                ]}
              />
            ) : (
              <Key variant="primary" icon={Bluetooth} arrow onClick={() => setScanning(true)}>
                {C.scan}
              </Key>
            )}
          </CardFoot>
        }
      >
        {credentialIssue ? <p className="eg-line" role="status">{credentialIssue === 'rejected' ? C.ringAccessRejectedBody : C.ringAccessMissingBody}</p> : null}
        {has ? (
          <div className="eg-ring__hero">
            <RadialTicks
              label="Ring battery"
              value={r.battery ?? null}
              max={100}
              size={120}
              unit="%"
              lap2={false}
              quiet={quiet}
              quietFill="ratio"
              quietWord={r.battery === undefined ? 'Not reported' : batteryWord(r.battery)}
              centre={
                <HeroNumber
                  value={r.battery === undefined ? null : Math.round(r.battery)}
                  unit="%"
                  size="time"
                  numerals="proportional"
                  label={
                    quiet
                      ? r.battery === undefined
                        ? 'Battery not reported'
                        : batteryWord(r.battery)
                      : r.battery === undefined
                        ? 'Battery not reported'
                        : `${Math.round(r.battery)} percent battery`
                  }
                  quietWord={
                    quiet ? (r.battery === undefined ? 'Not reported' : batteryWord(r.battery)) : undefined
                  }
                />
              }
            />
            <MonoMeta className="eg-ring__name"><span>{quiet ? 'Your ring' : (r.name ?? 'Name not reported')}</span></MonoMeta>
          </div>
        ) : (
          <p className="rg-none">{C.noRing}</p>
        )}
        {failed ? (
          <p className="eg-error" role="status">
            {failed}
          </p>
        ) : null}
      </GradientCard>
      {scanning ? <ScanSheet onClose={() => setScanning(false)} /> : null}
      <Dialog
        open={forgetting}
        onClose={() => setForgetting(false)}
        title={C.forgetTitle}
        role="alertdialog"
        footer={
          <>
            <Key variant="text" onClick={() => setForgetting(false)}>
              {C.cancel}
            </Key>
            <Key
              variant="danger"
              onClick={() => {
                setForgetting(false);
                void engine.forget();
              }}
            >
              {C.forget}
            </Key>
          </>
        }
      >
        <p>{C.forgetBody}</p>
      </Dialog>
    </>
  );
}

/** The sheet that finds rings: scans on open, lists them by signal, connects the one chosen. */
function ScanSheet({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<Array<{ name: string; address: string; rssi: number }> | null>(null);
  const [pick, setPick] = useState<string | undefined>();
  const gen = useRef(0);
  const run = () => {
    const id = ++gen.current;
    void engine
      .scan()
      .then((r) => id === gen.current && setDevices(r ? [...r.devices].sort((a, b) => b.rssi - a.rssi) : []));
  };
  const scanAgain = () => {
    setDevices(null);
    setPick(undefined);
    run();
  };
  // scans once on open (the state starts as "scanning")
  useEffect(() => {
    run();
    return () => void (gen.current += 1);
  }, []);
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={C.findRing}
      onDone={() => {
        if (!pick) return;
        onClose();
        void engine.connect(pick);
      }}
      doneLabel={C.connect}
      doneDisabled={!pick}
      doneDisabledReason={pick ? undefined : 'Pick a ring first.'}
    >
      <div className="eg-scan">
        {devices === null ? (
          <p className="rg-none eg-scan__busy" role="status">
            <Spinner size={12} /> {C.scanning}
          </p>
        ) : devices.length ? (
          <RadioGroup
            name="ring-device"
            value={pick}
            onChange={setPick}
            options={devices.map((d) => ({
              value: d.address,
              label: d.name || d.address,
              help: C.signal(d.rssi),
            }))}
          />
        ) : (
          <p className="rg-none">{C.noneFound}</p>
        )}
        {devices !== null ? (
          <Key variant="text" size="sm" icon={RefreshCw} onClick={scanAgain}>
            {C.scanAgain}
          </Key>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}

const KINDS: MeasureKind[] = ['hr', 'spo2', 'hrv', 'temp', 'stress'];

function MeasureCard({ s }: { s: EngineState }) {
  const [kind, setKind] = useState<MeasureKind>('hr');
  const m = useEngineMeasure();
  const credentialIssue = ringCredentialIssue(s);
  const authenticating = ringAuthenticationPending(s);
  const connected = ringDataReady(s);
  return (
    <GradientCard
      as="section"
      domain="heart"
      head={
        <CardHead
          as="h2"
          icon={HeartPulse}
          title={C.measureTitle}
          info={{
            title: 'Measure now',
            body: 'Asks the ring for a spot reading of the kind you pick. Keep the ring still; heart rate takes about half a minute. The reading is sent to your server like any other.',
            source: { kind: 'ring', words: 'A spot reading from the ring on this phone.' },
          }}
        />
      }
      foot={<CardFoot state={{ word: connected ? 'Ready to measure' : credentialIssue === 'rejected' ? C.ringAccessFailed : credentialIssue ? C.ringAccessPending : authenticating ? C.authenticating : 'Not connected', icon: HeartPulse }} />}
    >
      <div className="eg-body">
        <KeyBank
          label={C.measureLabel}
          options={KINDS.map((k) => ({ value: k, label: C.kinds[k] }))}
          value={kind}
          onChange={setKind}
          block
        />
        <div className="rg-measure">
          <Key
            variant="primary"
            arrow
            icon={HeartPulse}
            loading={m.pending}
            disabled={m.pending || !connected}
            disabledReason={connected ? undefined : credentialIssue ? C.ringAccessBlocked : authenticating ? C.authenticatingWait : C.measureNeedsRing}
            onClick={() => m.measure(kind)}
          >
            {C.measure}
          </Key>
          <MonoMeta className="rg-measure__words" role="status" aria-live="polite">
            {m.words ?? ''}
          </MonoMeta>
        </div>
      </div>
    </GradientCard>
  );
}

function deviceWhen(at: string | null | undefined, now: number, quiet: boolean): string {
  if (!quiet) return whenText(at, now);
  const ms = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(ms) ? quietAge(Math.max(0, (now - ms) / 60_000)) : 'Not yet';
}

function UploadCard({ s }: { s: EngineState }) {
  const now = useNow();
  const quiet = useQuietMode().on;
  const u = s.upload;
  return (
    <GradientCard
      as="section"
      domain="neutral"
      head={
        <CardHead
          as="h2"
          icon={Upload}
          title={C.upload}
          info={{
            title: 'Upload',
            body: 'Readings leave the phone for your own server in batches. Waiting to send counts what has not left yet; it clears after a sync. If readings keep waiting, check that the phone is online and connected to your server.',
            source: { kind: 'phone', words: 'The upload queue on this phone.' },
          }}
        />
      }
      foot={
        <CardFoot
          state={{
            word: u.paired ? (u.pending ? 'Waiting to send' : 'All sent') : 'Not connected',
            icon: Upload,
          }}
          right={u.paired ? `${C.lastSent} ${deviceWhen(u.lastSentAt, now, quiet)}` : undefined}
        />
      }
    >
      <div className="eg-body">
        {u.paired ? (
          <>
            <HeroNumber
              value={u.pending}
              size="num-l"
              label={
                quiet
                  ? u.pending
                    ? 'Readings waiting to send'
                    : 'All readings sent'
                  : `${u.pending} readings waiting to send`
              }
              quietWord={quiet ? (u.pending ? 'Waiting' : 'All sent') : undefined}
            />
            {!quiet ? <MonoMeta>{C.waitingToSend}</MonoMeta> : null}
          </>
        ) : (
          <div className="eg-keys">
            <p className="rg-none">{C.notPaired}</p>
            <KeyLink to="/settings/server" variant="primary" size="sm" arrow>
              {C.connectServer}
            </KeyLink>
          </div>
        )}
        {u.lastError ? (
          <p className="eg-error" role="status">
            <span className="eg-error__label">{C.lastError}</span> {u.lastError}
          </p>
        ) : null}
      </div>
    </GradientCard>
  );
}

/** Whether the engine can be reached from here (the Device route redirects away on the web and desktop). */
export const deviceAvailable = (): boolean => gaugeEngine() !== null;
