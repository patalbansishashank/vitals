/**
 * Settings › Devices and streams (design/screens/settings-sync-ai.md §8): one block per source with its tier, what it
 * brought in and its stream policy (bring in · my scores · my plan · Coach sees); vendor scores for the person; importing a file and connecting a ring. Every change goes through the bus with literal ids:
 * `bio.sources` (read), `bio.setPolicy`, `bio.import` (job), `bio.deviceConnect` /
 * `bio.deviceSync` (Bluetooth inside the click, then a job), `bio.deleteSource` (typed confirmation).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Dialog, Engraved, Field, Key, KeyBank, KeyLink, Switch, TextInput, toast } from '@/components';
import { dispatch, jobs, mintConfirmation, type CommandResult } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { bioActivity } from '@/biometrics/app/activity';
import { stageBleLink, stageFile } from '@/biometrics/app/handoff';
import { engineEligible } from '@/biometrics/core/policy';
import type { BleDriver } from '@/biometrics/core/ble/types';
import type { PolicyStream, StreamPolicy } from '@/biometrics/core/types';
import { SettingsSection } from '../sections';
import { useSettingsStore } from '@/state/settingsStore';
import { DEV, formatDay, streamName } from './copy';
import { MqttCard } from './MqttCard';

type Tier = 'A' | 'B' | 'C';
type Coach = StreamPolicy['coach'];
interface SourceView {
  sourceKey: string;
  label: string;
  tier: Tier;
  kind: string;
  policies: StreamPolicy[];
  streams: string[];
  records: number;
  lastDate: string | null;
  driver: string | null;
  lastSyncAt: string | null;
  battery: number | null;
}
interface SourcesView {
  sources: SourceView[];
  policies: StreamPolicy[];
}
type Ble = {
  drivers: readonly BleDriver[];
  available: boolean;
  requestDevice: (d: BleDriver) => Promise<Parameters<typeof stageBleLink>[0]>;
};

const output = <T,>(r: CommandResult): T | null => (r.ok && 'output' in r ? (r.output as T) : null);
const message = (r: CommandResult): string => (!r.ok ? r.error.message : DEV.failed);

/** `bio.sources`, read again whenever a biometrics document changes. */
function useBioSources(): SourcesView | null {
  const [view, setView] = useState<SourcesView | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => sharedBioIndex(getDocumentStore()).subscribe(() => setRev((r) => r + 1)), []);
  useEffect(() => {
    let live = true;
    void sendCommand('bio.sources', {}, { silent: true }).then((r) => {
      const v = output<SourcesView>(r);
      if (live && v) setView(v);
    });
    return () => {
      live = false;
    };
  }, [rev]);
  return view;
}

const activitySub = (l: () => void) => bioActivity.subscribe(l);
const activityGet = () => bioActivity.get();

/** One id: a second report of the same job replaces the first instead of stacking beside it. */
const JOB_TOAST = { id: 'devices-job' };

/** Run a job command and report its end with a toast. */
async function runJob(r: CommandResult, done: (result: unknown) => string): Promise<void> {
  if (!r.ok) {
    toast(message(r), JOB_TOAST);
    return;
  }
  if (!('job' in r)) return;
  const st = await jobs.wait(r.job.jobId);
  if (st.state === 'done') toast(done(jobs.result(r.job.jobId)), JOB_TOAST);
  else if (st.state === 'failed') toast(st.error?.message ?? DEV.failed, JOB_TOAST);
}

async function setPolicy(
  stream: string,
  policy: Partial<Omit<StreamPolicy, 'stream'>>,
  sourceKey?: string,
): Promise<void> {
  const r = await dispatch('bio.setPolicy', { stream, policy, ...(sourceKey ? { sourceKey } : {}) });
  if (!r.ok) toast(message(r));
}

function PolicyRows({ policies, sourceKey }: { policies: readonly StreamPolicy[]; sourceKey?: string }) {
  if (policies.length === 0) return null;
  // five columns do not fit 390 px: the table scrolls inside its card instead of widening the page
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-2">
            <th scope="col" className="font-normal">
              <span className="sr-only">stream</span>
            </th>
            <th scope="col" className="font-normal">
              {DEV.cols.imported}
            </th>
            <th scope="col" className="font-normal">
              {DEV.cols.scores}
            </th>
            <th scope="col" className="font-normal">
              {DEV.cols.engine}
            </th>
            <th scope="col" className="font-normal">
              {DEV.cols.coach}
            </th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => {
            const name = streamName(p.stream);
            const vendor = p.stream === 'vendor_scores' || p.stream.startsWith('vendor:');
            const sw = (col: 'imported' | 'scores' | 'engine', disabled: boolean) => (
              <Switch
                checked={p[col]}
                disabled={disabled}
                label={<span className="sr-only">{DEV.switchLabel(DEV.cols[col], name)}</span>}
                onChange={(v) => void setPolicy(p.stream, { [col]: v }, sourceKey)}
              />
            );
            return (
              <tr key={p.stream}>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {name}
                </th>
                <td>{sw('imported', false)}</td>
                <td>{sw('scores', !p.imported || vendor)}</td>
                <td>{sw('engine', !p.imported || vendor || !engineEligible(p.stream as PolicyStream))}</td>
                <td>
                  <KeyBank<Coach>
                    size="sm"
                    label={DEV.switchLabel(DEV.cols.coach, name)}
                    value={p.coach}
                    onChange={(v) => void setPolicy(p.stream, { coach: v }, sourceKey)}
                    options={(['hidden', 'daily', 'daily+series'] as const).map((c) => ({
                      value: c,
                      label: DEV.coach[c],
                      disabled: !p.imported,
                    }))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RemoveDialog({ source, onClose }: { source: SourceView | null; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === DEV.removeWord;
  const close = () => {
    setTyped('');
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open={source !== null}
      onClose={close}
      role="alertdialog"
      title={source ? DEV.removeTitle(source.label) : ''}
      initialFocus={ref}
      footer={
        <>
          <Key onClick={close}>{DEV.cancel}</Key>
          <Key
            variant="danger"
            loading={busy}
            disabledReason={matches ? undefined : `Type “${DEV.removeWord}” to confirm.`}
            onClick={async () => {
              if (!source) return;
              setBusy(true);
              const input = { sourceKey: source.sourceKey };
              const r = await dispatch('bio.deleteSource', input, {
                confirmation: mintConfirmation('bio.deleteSource', input),
              });
              if (!r.ok) toast(message(r));
              close();
            }}
          >
            {DEV.removeKey}
          </Key>
        </>
      }
    >
      <p className="m-0">{DEV.removeBody}</p>
      <Field label={`type ${DEV.removeWord} to confirm`}>
        <TextInput
          ref={ref}
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

function SourceBlock({
  s,
  ble,
  onRemove,
}: {
  s: SourceView;
  ble: Ble | null;
  onRemove: (s: SourceView) => void;
}) {
  const dateStyle = useSettingsStore((x) => x.dateStyle);
  const driver = s.driver ? ble?.drivers.find((d) => d.id === s.driver) : undefined;
  const sync = async () => {
    if (!ble || !driver) return;
    try {
      const link = await ble.requestDevice(driver); // inside the click: Web Bluetooth needs the gesture
      const linkRef = stageBleLink(link, driver.id);
      await runJob(await dispatch('bio.deviceSync', { sourceKey: s.sourceKey, linkRef }), (rep) =>
        DEV.imported(rep as Parameters<typeof DEV.imported>[0], useSettingsStore.getState().dateStyle),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : DEV.failed);
    }
  };
  return (
    <section className="min-w-0 border-t border-line pt-4" aria-label={s.label}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">
          {s.label} <span className="font-normal text-ink-2">· {DEV.kind[s.kind] ?? s.kind}</span>
        </h3>
        <Engraved as="span">{`tier ${s.tier}`}</Engraved>
      </div>
      <p className="m-0 mt-1 text-xs text-ink-2">{DEV.tier[s.tier]}</p>
      <p className="m-0 mt-1 text-xs text-ink-2">
        {DEV.lastData(s.lastDate ? formatDay(s.lastDate, dateStyle) : null)} · {DEV.records(s.records)}
        {s.streams.length ? ` · ${s.streams.map(streamName).join(' · ')}` : ''}
      </p>
      {s.driver ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Key
            size="sm"
            disabledReason={ble?.available && driver ? undefined : DEV.ringUnavailable}
            onClick={() => void sync()}
          >
            {DEV.syncNow}
          </Key>
          <span className="text-xs text-ink-2">{DEV.syncHelp}</span>
        </div>
      ) : null}
      <PolicyRows policies={s.policies} sourceKey={s.sourceKey} />
      <div className="mt-2">
        <Key size="sm" variant="quiet" onClick={() => onRemove(s)}>
          {DEV.remove}
        </Key>
      </div>
    </section>
  );
}

async function importFile(file: File): Promise<void> {
  const fileRef = stageFile(file, file.name);
  await runJob(await dispatch('bio.import', { fileRef }), (rep) =>
    DEV.imported(rep as Parameters<typeof DEV.imported>[0], useSettingsStore.getState().dateStyle),
  );
}

function ImportFile() {
  const input = useRef<HTMLInputElement>(null);
  const activity = useSyncExternalStore(activitySub, activityGet, activityGet);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Engraved as="p" className="m-0">
        {DEV.importTitle}
      </Engraved>
      <p className="m-0 mt-1 text-xs text-ink-2">{DEV.importHelp}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Key size="sm" loading={activity.importing !== null} onClick={() => input.current?.click()}>
          {DEV.importKey}
        </Key>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={DEV.importKey}
          onChange={(e) => void onFile(e)}
        />
        <span role="status" aria-live="polite" className="text-xs text-ink-2">
          {activity.importing
            ? DEV.importing(activity.importing.name, Math.round(activity.importing.progress * 100))
            : activity.syncing
              ? DEV.syncing(Math.round(activity.syncing.progress * 100))
              : ''}
        </span>
      </div>
    </div>
  );
}

function ConnectRing({ ble }: { ble: Ble | null }) {
  if (!ble) return null;
  const connect = async (d: BleDriver) => {
    try {
      const link = await ble.requestDevice(d); // inside the click
      const linkRef = stageBleLink(link, d.id);
      await runJob(await dispatch('bio.deviceConnect', { driver: d.id, linkRef }), (rep) =>
        DEV.imported(rep as Parameters<typeof DEV.imported>[0], useSettingsStore.getState().dateStyle),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : DEV.failed);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Engraved as="p" className="m-0">
        {DEV.ringTitle}
      </Engraved>
      <p className="m-0 mt-1 text-xs text-ink-2">{ble.available ? DEV.ringHelp : DEV.ringUnavailable}</p>
      {ble.available ? (
        <div className="mt-2 grid gap-2">
          {ble.drivers.map((d) => (
            <div key={d.id} className="flex flex-wrap items-end gap-2">
              <Key size="sm" onClick={() => void connect(d)}>
                {DEV.ringKey(d.label)}
              </Key>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The Bluetooth modules, loaded when the section mounts (so the click can open the browser's device window at once). */
function useBle(): Ble | null {
  const [ble, setBle] = useState<Ble | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([import('@/biometrics/ble/registry'), import('@/biometrics/ble/webBluetooth')]).then(
      ([reg, wb]) => {
        if (live)
          setBle({
            drivers: reg.BLE_DRIVERS,
            available: wb.isWebBluetoothAvailable(),
            requestDevice: wb.requestDevice,
          });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return ble;
}

export function DevicesSection() {
  const view = useBioSources();
  const ble = useBle();
  const [removing, setRemoving] = useState<SourceView | null>(null);
  const vendor: StreamPolicy = view?.policies.find((p) => p.stream === 'vendor_scores') ?? {
    stream: 'vendor_scores',
    imported: false,
    coach: 'hidden',
    engine: false,
    scores: false,
  };
  return (
    <SettingsSection id="devices" title={DEV.title}>
      <p className="m-0 text-sm text-ink-2">{DEV.intro}</p>
      <p className="m-0 mt-1 text-xs text-ink-2">{DEV.limits}</p>
      <div className="mt-3">
        <KeyLink to="/onboarding/devices" size="sm" trailingIcon={ChevronRight}>
          {DEV.chooseInIntake}
        </KeyLink>
      </div>
      <MqttCard onImportFile={(f) => void importFile(f)} />
      <div className="mt-4 grid gap-4">
        {view === null ? (
          <p className="m-0 text-sm text-ink-2">{DEV.loading}</p>
        ) : view.sources.length === 0 ? (
          <p className="m-0 text-sm text-ink-2">{DEV.none}</p>
        ) : (
          view.sources.map((s) => <SourceBlock key={s.sourceKey} s={s} ble={ble} onRemove={setRemoving} />)
        )}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <Switch
          checked={vendor.imported}
          label={DEV.vendorTitle}
          onChange={(v) => void setPolicy('vendor_scores', { imported: v })}
        />
        <p className="m-0 mt-1 text-xs text-ink-2">{DEV.vendorHelp}</p>
      </div>
      <ImportFile />
      <ConnectRing ble={ble} />
      <RemoveDialog source={removing} onClose={() => setRemoving(null)} />
    </SettingsSection>
  );
}
