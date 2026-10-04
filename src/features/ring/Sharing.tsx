/**
 * Sharing: the item-11 master switch (design/screens/ring-pages.md §5.6, SUITE_SPEC §15.2). One 52 px switch row,
 * "Use my ring data in my plan and Coach", the plain line under it, and the three states: on, off and some (the switch
 * shows mixed, "Some of it is shared." and a link to Settings › Devices, where the per-signal switches stay). Toggling
 * changes every ring source at once with the normal undo toast. The one-time notice from the `biometrics.ringDefaults`
 * migration shows above the switch until the person presses OK.
 */
import { useCallback, useId, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Faceplate, Key, Notice, Switch, toast } from '@/components';
import { paths } from '@/app/paths';
import { useRingEnv, type RingSharing, type SharingState } from './data';
import { defaultRingSharing } from './sharing';
import { RING_SECTIONS_COPY } from './copySections';
import './ring-sections.css';

const C = RING_SECTIONS_COPY.sharing;

/** Undo for a change: the sharing's own (history.undo of the change sets), else setting back a plain on or off. */
function undoFor(sharing: RingSharing, before: SharingState | null): (() => Promise<void>) | null {
  const own = (sharing as RingSharing & { undo?: () => Promise<void> }).undo;
  if (typeof own === 'function') return () => own.call(sharing);
  if (before === 'on' || before === 'off') return () => sharing.set(before === 'on');
  return null;
}

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : C.failed);

export function Sharing() {
  const env = useRingEnv();
  const sharing = env.sharing ?? defaultRingSharing();
  const subscribe = useCallback((fn: () => void) => sharing.subscribe(fn), [sharing]);
  const state = useSyncExternalStore(subscribe, () => sharing.state(), () => null);
  const notice = useSyncExternalStore(subscribe, () => sharing.noticePending(), () => false);
  const [busy, setBusy] = useState(false);
  const lineId = useId();

  const toggle = async (on: boolean) => {
    const before = state;
    setBusy(true);
    try {
      await sharing.set(on);
      const undo = undoFor(sharing, before);
      toast(on ? C.turnedOn : C.turnedOff, undo ? { action: { label: C.undo, onClick: () => void undo().catch((e: unknown) => toast(errText(e))) } } : {});
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Faceplate title={C.title} className="rs-share">
      {notice ? (
        <Notice
          severity="info"
          layout="ruled"
          className="rs-share__notice"
          title={C.notice}
          actions={
            <Key size="sm" onClick={() => sharing.dismissNotice()}>
              {C.ok}
            </Key>
          }
        />
      ) : null}
      <div className="rs-share__row">
        <Switch
          className={state === 'some' ? 'rs-mixed' : undefined}
          label={C.switchLabel}
          labelStyle="sentence"
          // no ring source yet: ring data will be shared by default (decision 11), nothing to change now
          checked={state === 'on' || state === null}
          disabled={busy || state === null}
          describedBy={lineId}
          onChange={(v) => void toggle(v)}
        />
      </div>
      {state === 'some' ? (
        // mixed: the line under the switch says so and points to the per-signal switches
        <p className="rs-share__some" id={lineId} data-state="some">
          {C.some} <Link to={paths.settings('devices')}>{C.chooseInSettings}</Link>
        </p>
      ) : (
        <p className="rs-line" id={lineId}>
          {C.line}
        </p>
      )}
      {state === null ? <p className="rs-line">{C.nothingYet}</p> : null}
    </Faceplate>
  );
}
