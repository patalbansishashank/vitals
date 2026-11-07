import { useSyncExternalStore } from 'react';
import { StatusDot, Switch } from '@/components';
import { sendCommand } from '@/features/lib/sendCommand';
import { gaugeImportState, subscribeGaugeImport } from '@/state/gaugeImport';
import { useSettingsStore } from '@/state/settingsStore';
import { SettingRow, SettingsGroup } from './SettingRow';

const pad = (n: number) => String(n).padStart(2, '0');

/** "12:04" today, "21 Oct 12:04" before that. */
export function lastImportText(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.getDate()} ${at.toLocaleString('en-GB', { month: 'short' })} ${time}`;
}

/** The help line: "On · last import 12:04", "On · nothing imported yet", or "Off". */
export function gaugeImportHelp(on: boolean, lastImportAt: string | null, now?: Date): string {
  if (!on) return 'Off · ring steps and sleep stay out of your plan';
  const last = lastImportText(lastImportAt, now);
  return last ? `On · last import ${last}` : 'On · nothing imported yet';
}

/**
 * Settings › Sync, under the server: whether the ring's steps and sleep come in from Gauge (`settings.gaugeImport`,
 * synced) and when this device last brought them in. Shown only with a paired server, which is where the data comes from.
 */
export function GaugeImportRow({ bare = false }: { bare?: boolean }) {
  const on = useSettingsStore((s) => s.gaugeImport);
  const state = useSyncExternalStore(subscribeGaugeImport, gaugeImportState, gaugeImportState);
  const last = lastImportText(state.lastImportAt);
  const row = (
    <SettingRow
      label="Ring data from your phone"
      help={
        <>
          <StatusDot
            tone={on && last ? 'live' : 'neutral'}
            label={on ? (last ? `Last import ${last}` : 'Nothing imported yet') : 'Off'}
          />
        </>
      }
      info={{
        title: 'Ring data from your phone',
        body: 'Vitals reads your ring’s daily steps and sleep from your phone through your server and files them in your day like anything you log. The first import fills the last 30 days; later ones re-read the last two. Off keeps ring steps and sleep out of your plan.',
      }}
    >
      {({ labelId, helpId }) => (
        <Switch
          checked={on}
          labelledBy={labelId}
          describedBy={helpId}
          onChange={(v) => void sendCommand('settings.update', { patch: { gaugeImport: v } })}
        />
      )}
    </SettingRow>
  );
  return bare ? row : <SettingsGroup>{row}</SettingsGroup>;
}
