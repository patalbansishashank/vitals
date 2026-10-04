/**
 * Ring settings (design/screens/ring-pages.md §5.7), per ring. Rows in order; a row whose capability the driver (or
 * this copy of Vitals) lacks is absent: firmware · keep my ring connected (Android app) · keep running in the tray
 * (desktop app) · how often your ring measures (only drivers with intervals) · battery over time · find my ring ·
 * disconnect · forget this ring (typed confirmation) · reset the ring (only with the capability) · add another ring.
 * There is no credential, password, key, "advanced", calibration or per-firmware row, for any ring (decision 13).
 */
import { useState, type ReactNode } from 'react';
import { Dialog, Engraved, Faceplate, Key, ScaleSlider, Switch, toast } from '@/components';
import { TypedConfirmDialog } from '@/features/living/components/TypedConfirmDialog';
import { useRingEnv, useRings, type RingCaps, type RingService, type RingStatus } from './data';
import { BatteryHistory } from './BatteryHistory';
import { RING_SECTIONS_COPY } from './copySections';
import './ring-sections.css';

const C = RING_SECTIONS_COPY.settings;

/** Where the Android "keep my ring connected" choice waits until the Android app reads it (L-ANDROID). */
export const KEEP_CONNECTED_KEY = 'vitals.ring.keepConnected';

/** What the ring measures on its own, and how often (drivers with `caps.intervals`). */
export interface RingMeasuring {
  allDayHr: boolean;
  intervalMin: number;
  spo2: boolean;
  stress: boolean;
  hrv: boolean;
  temp: boolean;
}

/** Optional service methods for "how often your ring measures" (L-RINGSVC; no shipped driver has intervals yet). */
export interface RingMeasuringService {
  measuring?(ringKey: string): RingMeasuring | null;
  setMeasuring?(ringKey: string, m: RingMeasuring): Promise<void>;
}

const LINKED: ReadonlySet<RingStatus['state']> = new Set(['connected', 'syncing', 'connecting', 'searching']);
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : C.failed);

function readKeepConnected(): boolean {
  try {
    return localStorage.getItem(KEEP_CONNECTED_KEY) !== '0';
  } catch {
    return true;
  }
}

/** "ending 4F2A" from the ring key's own id, so two rings with one label differ. */
function idTail(ringKey: string): string | null {
  const id = ringKey.split('#')[1];
  return id && id.length >= 4 ? id.slice(-4).toUpperCase() : null;
}

function Row({ label, children, id, help }: { label: string; children?: ReactNode; id?: string; help?: ReactNode }) {
  return (
    <li className="rs-setting" id={id} data-row={label}>
      <Engraved>{label}</Engraved>
      {children !== undefined ? <div className="rs-setting__value">{children}</div> : null}
      {help ? <p className="rs-setting__help">{help}</p> : null}
    </li>
  );
}

export function RingSettings({ ring, onAddRing }: { ring: RingStatus; onAddRing: () => void }) {
  const { service, platform } = useRingEnv();
  const rings = useRings();
  const caps: RingCaps = ring.caps ?? {};
  const key = ring.ringKey;
  const linked = LINKED.has(ring.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [keep, setKeep] = useState(readKeepConnected);
  const measuringSvc = service as RingService & RingMeasuringService;

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const changeKeep = (v: boolean) => {
    setKeep(v);
    try {
      localStorage.setItem(KEEP_CONNECTED_KEY, v ? '1' : '0');
    } catch {
      // storage unavailable: the choice holds for this visit
    }
  };

  const tail = idTail(key);
  const title = rings.length > 1 ? C.titleFor(tail ? `${ring.label} · ending ${tail}` : ring.label) : C.title;

  return (
    <Faceplate title={title} className="rs-settings-face">
      <ul className="rs-settings">
        <Row label={C.firmware}>
          <span data-unknown={ring.firmware ? undefined : 'true'}>{ring.firmware ?? C.firmwareUnknown}</span>
        </Row>

        {platform.platform === 'android' ? (
          <li className="rs-setting" data-row={C.keepConnected}>
            <div className="rs-setting__group">
              <Switch label={C.keepConnected} checked={keep} onChange={changeKeep} />
            </div>
            <p className="rs-setting__help">{C.keepConnectedHelp}</p>
          </li>
        ) : null}

        {platform.platform === 'electron' ? <Row label={C.tray} help={C.trayLine} /> : null}

        {caps.intervals && measuringSvc.setMeasuring ? (
          <MeasuringRow ring={ring} intervals={caps.intervals} measures={caps.measures} service={measuringSvc} linked={linked} />
        ) : null}

        <li className="rs-setting" data-row={C.battery}>
          <div className="rs-setting__wide">
            <BatteryHistory ringKey={key} />
          </div>
        </li>

        {caps.findRing && service.findRing ? (
          <Row label={C.find}>
            <Key size="sm" loading={busy === 'find'} onClick={() => void act('find', () => service.findRing!(key))}>
              {C.vibrate}
            </Key>
          </Row>
        ) : null}

        <Row label={C.disconnect}>
          <Key size="sm" loading={busy === 'disconnect'} disabledReason={linked ? undefined : C.notConnected} onClick={() => void act('disconnect', () => service.disconnect(key))}>
            {C.disconnectKey}
          </Key>
        </Row>

        <Row label={C.forget} id="forget-ring">
          <Key size="sm" variant="danger" onClick={() => setForgetOpen(true)}>
            {C.forgetKey}
          </Key>
        </Row>

        {caps.factoryReset && service.factoryReset ? (
          <Row label={C.reset}>
            <Key size="sm" variant="danger" onClick={() => setResetOpen(true)}>
              {C.resetKey}
            </Key>
          </Row>
        ) : null}

        <Row label={C.add}>
          <Key size="sm" onClick={onAddRing}>
            {C.addKey}
          </Key>
        </Row>
      </ul>

      <TypedConfirmDialog
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        title={C.forgetTitle(ring.label)}
        body={C.forgetBody}
        word={C.forgetWord}
        instruction={C.forgetInstruction}
        confirmLabel={C.forgetConfirm}
        onConfirm={async () => {
          try {
            await service.forget(key);
            setForgetOpen(false);
            toast(C.forgotten(ring.label));
          } catch (e) {
            toast(errText(e));
          }
        }}
      />

      {caps.factoryReset && service.factoryReset ? (
        <Dialog
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          title={C.resetTitle}
          role="alertdialog"
          footer={
            <>
              <Key onClick={() => setResetOpen(false)}>{C.cancel}</Key>
              <Key
                variant="danger"
                loading={busy === 'reset'}
                onClick={() =>
                  void act('reset', async () => {
                    await service.factoryReset!(key);
                    setResetOpen(false);
                  })
                }
              >
                {C.resetConfirm}
              </Key>
            </>
          }
        >
          <p className="rs-line">{C.resetBody}</p>
        </Dialog>
      ) : null}
    </Faceplate>
  );
}

function MeasuringRow({
  ring,
  intervals,
  measures,
  service,
  linked,
}: {
  ring: RingStatus;
  intervals: NonNullable<RingCaps['intervals']>;
  measures: RingCaps['measures'];
  service: RingService & RingMeasuringService;
  linked: boolean;
}) {
  const key = ring.ringKey;
  const [m, setM] = useState<RingMeasuring>(
    () => service.measuring?.(key) ?? { allDayHr: true, intervalMin: intervals.min, spo2: true, stress: true, hrv: true, temp: true },
  );
  const [status, setStatus] = useState<string | null>(null);
  const supports = (s: NonNullable<RingCaps['measures']>[number]) => !measures || measures.includes(s);

  // applies at once (no Save key): "sent to your ring" when connected, else when it next connects
  const send = (next: RingMeasuring) => {
    setM(next);
    setStatus(null);
    service.setMeasuring!(key, next).then(
      () => setStatus(linked ? C.sent : C.sentLater),
      (e: unknown) => toast(errText(e)),
    );
  };
  const toggles: Array<{ k: 'spo2' | 'stress' | 'hrv' | 'temp'; measure: NonNullable<RingCaps['measures']>[number] }> = [
    { k: 'spo2', measure: 'spo2' },
    { k: 'stress', measure: 'stress' },
    { k: 'hrv', measure: 'hrv' },
    { k: 'temp', measure: 'skin_temp' },
  ];

  return (
    <li className="rs-setting" data-row={C.measuring}>
      <Engraved className="rs-setting__wide">{C.measuring}</Engraved>
      <div className="rs-setting__group">
        <Switch label={C.allDayHr} checked={m.allDayHr} onChange={(v) => send({ ...m, allDayHr: v })} />
        <ScaleSlider
          label={C.every}
          size="sm"
          value={m.intervalMin}
          min={intervals.min}
          max={intervals.max}
          step={intervals.step}
          unit={C.minutes}
          disabled={!m.allDayHr}
          onChange={(v) => setM((cur) => ({ ...cur, intervalMin: v }))}
          onCommit={(v) => send({ ...m, intervalMin: v })}
        />
        {toggles
          .filter((t) => supports(t.measure))
          .map((t) => (
            <Switch key={t.k} label={C.measure[t.k]} checked={m[t.k]} onChange={(v) => send({ ...m, [t.k]: v })} />
          ))}
      </div>
      {status ? (
        <p className="rs-setting__help" role="status">
          {status}
        </p>
      ) : null}
    </li>
  );
}
