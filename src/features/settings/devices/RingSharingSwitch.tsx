/**
 * The ring data master switch (plan 04 item 11, SUITE_SPEC §15.2): "Use my ring data in my plan and Coach". Reads
 * `ringSharing` from `bio.sources` (on, off, or some: any other mix) and sends `bio.setRingSharing { on }`. Hidden when
 * the person has no ring source. Mounted on the Ring page and in Settings › Devices above the per-signal switches.
 * Also shows the one-time notice after the ring defaults were applied to an existing ring source.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice, Switch } from '@/components';
import { paths } from '@/app/paths';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { SettingRow } from '../SettingRow';
import { RING } from './copy';
import { useBioSources } from './useBioSources';

export type RingSharing = 'on' | 'off' | 'some' | 'none';
interface SharingView {
  ringSharing?: RingSharing;
  ringDefaultsNotice?: unknown;
}

export function RingSharingSwitch({ className }: { className?: string }) {
  const { view, refresh } = useBioSources<SharingView>();
  const [busy, setBusy] = useState(false);
  const [noticeGone, setNoticeGone] = useState(false);
  const state = view?.ringSharing;
  if (!state || state === 'none') return null;
  const notice = Boolean(view.ringDefaultsNotice) && !noticeGone;
  // "some" reads as on: one tap from there turns everything off, the safer direction
  const checked = state !== 'off';
  const set = async (on: boolean) => {
    setBusy(true);
    await sendCommand('bio.setRingSharing', { on });
    setBusy(false);
    refresh();
  };
  return (
    <div className={className}>
      {notice ? (
        <Notice
          severity="info"
          layout="ruled"
          title={RING.sharing.notice}
          onDismiss={() => {
            setNoticeGone(true);
            void sendCommand('bio.dismissRingDefaultsNotice', {}, { silent: true });
          }}
        />
      ) : null}
      <SettingRow
        label={RING.sharing.label}
        help={
          <>
            {state === 'some' ? (
              <>
                {RING.sharing.some} <Link to={paths.settings('devices')}>{RING.sharing.someLink}</Link>
                <br />
              </>
            ) : null}
            {RING.sharing.help}
          </>
        }
      >
        {({ labelId, helpId }) => (
          <Switch checked={checked} disabled={busy} labelledBy={labelId} describedBy={helpId} onChange={(on) => void set(on)} />
        )}
      </SettingRow>
    </div>
  );
}
