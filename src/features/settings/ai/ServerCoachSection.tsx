/**
 * Settings › Coach while this device is paired with the person's server: the Coach runs there, so there is no
 * provider, model or key to set here. One row: where it runs and its status from `GET /v1/coach/status` (available or
 * why not) with how long chats are kept. Unpaired, Settings › Coach (`AiSection`) comes back unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import { CoachError, createServerCoachClient, type CoachServerStatus } from '@/net/coach';
import { SettingsSection } from '../sections';
import { SettingRow, SettingsGroup } from '../SettingRow';
import { useServerClient } from '../server/hooks';
import { SERVER_COACH_COPY as C } from './copy';

type State = { k: 'checking' } | { k: 'ok'; status: CoachServerStatus } | { k: 'error'; message: string };

export function serverCoachLine(state: State): string {
  if (state.k === 'checking') return C.checking;
  if (state.k === 'error') return state.message;
  const { status } = state;
  return status.available ? C.available(status.retentionHours) : C.unavailable(status.reason || C.off, status.retentionHours);
}

export function ServerCoachSection() {
  const server = useServerClient();
  const client = useMemo(() => createServerCoachClient({ server }), [server]);
  const [state, setState] = useState<State>({ k: 'checking' });

  useEffect(() => {
    const ctl = new AbortController();
    client.status(ctl.signal).then(
      (status) => setState({ k: 'ok', status }),
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ k: 'error', message: e instanceof CoachError && e.code === 'not_supported' ? C.notSupported : C.unreachable });
      },
    );
    return () => ctl.abort();
  }, [client]);

  return (
    <SettingsSection id="coach" title={C.title}>
      <SettingsGroup>
        <SettingRow label={C.label} help={<span role="status">{serverCoachLine(state)}</span>}>
          {() => <span className="settings-value">{C.value}</span>}
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
