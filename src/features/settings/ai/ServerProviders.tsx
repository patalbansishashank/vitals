/**
 * The providers that run through the person's server (SUITE_SPEC §14.3; design settings-sync-ai.md §13.2–§13.3): their
 * state chips, the key block for NVIDIA and OpenCode Zen (the key goes to the server once and never stays in this
 * browser) and the ChatGPT block (signed in on the server by whoever runs it; no sign-in from the browser).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { Chip, Dialog, Field, InlineWarning, Key, KeyLink, TextInput, type Severity } from '@/components';
import { ProviderError, type Preset } from '@/ai';
import { isServerErrorCode, SERVER_MESSAGES, ServerError, type ServerAiPreset, type SiwcStatus } from '@/net/server';
import { useServerClient, useServerConnection, useServerPairing } from '../server/hooks';
import { AI_COPY } from './copy';

export const SERVER_PRESETS: ReadonlySet<string> = new Set(['siwc', 'nim', 'opencode-zen']);

/** Plain words for a failure on the way through the server, or null when it is an ordinary provider error. */
export function serverErrorText(e: unknown): string | null {
  if (e instanceof ServerError) return e.message;
  if (e instanceof ProviderError) {
    // the server names the service in this one ("NVIDIA NIM refused the key kept on your server. Replace it above.")
    if (e.code === 'key_refused') return e.message && /refused the key/.test(e.message) ? e.message : SERVER_MESSAGES.key_refused;
    if (isServerErrorCode(e.code)) return SERVER_MESSAGES[e.code];
    if (e.kind === 'network' || e.kind === 'cors' || e.kind === 'blocked') return AI_COPY.serverModelsFailed;
  }
  if (e instanceof TypeError) return AI_COPY.serverModelsFailed;
  return null;
}

export interface ServerAiState {
  presets: ServerAiPreset[] | null;
  siwc: SiwcStatus | null;
  reload: () => void;
}

/** `GET /v1/ai/status` and `GET /v1/ai/siwc/status` while paired; nothing otherwise. */
export function useServerAi(): ServerAiState {
  const client = useServerClient();
  const pairing = useServerPairing();
  const [presets, setPresets] = useState<ServerAiPreset[] | null>(null);
  const [siwc, setSiwc] = useState<SiwcStatus | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!pairing) return;
    let live = true;
    void client.aiStatus().then((p) => live && setPresets(p), () => undefined);
    void client.siwcStatus().then((s) => live && setSiwc(s), () => undefined);
    return () => {
      live = false;
    };
  }, [client, pairing, rev]);
  const reload = useCallback(() => setRev((n) => n + 1), []);
  // without a pairing nothing from an earlier pairing is shown
  return { presets: pairing ? presets : null, siwc: pairing ? siwc : null, reload };
}

export function serverChip(id: string, paired: boolean, state: ServerAiState, nowMs = Date.now()): { word: string; severity: Severity } {
  if (!paired) return { word: AI_COPY.chip.needsServer, severity: 'info' };
  if (id === 'siwc') {
    const s = state.siwc;
    if (s?.signedIn && s.expiresAt && new Date(s.expiresAt).getTime() < nowMs) return { word: AI_COPY.chip.expired, severity: 'caution' };
    if (s?.signedIn || state.presets?.find((p) => p.id === 'siwc')?.ready) return { word: AI_COPY.chip.signedIn, severity: 'ok' };
    return { word: AI_COPY.chip.notSignedIn, severity: 'caution' };
  }
  return state.presets?.find((p) => p.id === id)?.ready ? { word: AI_COPY.chip.keySet, severity: 'ok' } : { word: AI_COPY.chip.noKey, severity: 'caution' };
}

/** The provider name with its state chip, for the radio list. */
export function ServerPresetLabel({ preset, paired, state }: { preset: Preset; paired: boolean; state: ServerAiState }) {
  const chip = serverChip(preset.id, paired, state);
  return (
    <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span>{preset.label}</span>
      <Chip kind="status" severity={chip.severity}>
        {chip.word}
      </Chip>
    </span>
  );
}

export function NeedsServer() {
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="m-0 text-sm text-ink">{AI_COPY.needsServer}</p>
      <div>
        <KeyLink size="sm" to="/settings/server">
          {AI_COPY.pairServer}
        </KeyLink>
      </div>
    </div>
  );
}

/** Caution line when the paired server does not answer. */
export function ServerUnreachableLine({ preset }: { preset: Preset }) {
  const { connection } = useServerConnection();
  if (connection.state !== 'unreachable') return null;
  return <InlineWarning severity="caution">{AI_COPY.serverUnreachable(preset.label)}</InlineWarning>;
}

/** NVIDIA and OpenCode Zen: the key is sent once to the server (`PUT /v1/ai/keys/{preset}`) and never kept here. */
export function ServerKeyBlock({ preset, state }: { preset: Preset; state: ServerAiState }) {
  const client = useServerClient();
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const id = preset.id as 'nim' | 'opencode-zen';
  const set = state.presets?.find((p) => p.id === id)?.ready === true;

  const save = async () => {
    const value = input.current?.value.trim() ?? '';
    if (!value) return setError(AI_COPY.keyEmpty);
    setBusy(true);
    setError(null);
    try {
      await client.setKey(id, value);
      if (input.current) input.current.value = '';
      setReplacing(false);
      state.reload();
    } catch (e) {
      setError(serverErrorText(e) ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setConfirm(false);
    try {
      await client.removeKey(id);
      state.reload();
    } catch (e) {
      setError(serverErrorText(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="grid gap-2 border-t border-line pt-4">
      {!set || replacing ? (
        <>
          <Field label={AI_COPY.keyLabel} help={AI_COPY.serverKeyHelp(preset.label)} error={error}>
            <TextInput
              ref={input}
              type={shown ? 'text' : 'password'}
              name="ai-server-key"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Key size="sm" variant="solid" loading={busy} onClick={() => void save()}>
              {AI_COPY.saveKey}
            </Key>
            <Key size="sm" variant="quiet" icon={shown ? EyeOff : Eye} onClick={() => setShown((s) => !s)} aria-pressed={shown}>
              {shown ? AI_COPY.hide : AI_COPY.show}
            </Key>
            {replacing ? (
              <Key size="sm" variant="quiet" onClick={() => setReplacing(false)}>
                {AI_COPY.cancel}
              </Key>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Key size="sm" onClick={() => setReplacing(true)}>
            {AI_COPY.replaceKey}
          </Key>
          <Key size="sm" variant="quiet" icon={Trash2} onClick={() => setConfirm(true)}>
            {AI_COPY.removeKey}
          </Key>
          {error ? <InlineWarning severity="danger">{error}</InlineWarning> : null}
        </div>
      )}
      <p className="m-0 text-xs text-ink-2" role="status">
        {set ? AI_COPY.serverKeySaved : AI_COPY.serverKeyNone}
      </p>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        role="alertdialog"
        title={AI_COPY.removeServerKeyTitle(preset.label)}
        footer={
          <>
            <Key onClick={() => setConfirm(false)}>{AI_COPY.cancel}</Key>
            <Key variant="danger" onClick={() => void remove()}>
              {AI_COPY.removeKey}
            </Key>
          </>
        }
      >
        <p className="m-0">{AI_COPY.removeServerKeyBody}</p>
      </Dialog>
    </div>
  );
}

/** Sign in with ChatGPT: the sign-in is an admin step on the server; here only its state and Sign out. */
export function SiwcBlock({ state }: { state: ServerAiState }) {
  const client = useServerClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = state.siwc;
  const signedIn = s?.signedIn === true;
  const signOut = async () => {
    setConfirm(false);
    try {
      await client.siwcLogout();
      state.reload();
    } catch (e) {
      setError(serverErrorText(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  };
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="m-0 text-sm text-ink" role="status">
        {signedIn ? `✓ ${AI_COPY.siwcSignedIn}${s?.plan ? ` · ${AI_COPY.siwcPlan(s.plan)}` : ''}` : AI_COPY.siwcSignedOut}
      </p>
      {signedIn ? (
        <div className="flex flex-wrap items-center gap-3">
          <a className="lm-link text-sm" href={AI_COPY.manageUsageUrl} target="_blank" rel="noreferrer noopener">
            {AI_COPY.manageUsage}
          </a>
          <Key size="sm" variant="quiet" onClick={() => setConfirm(true)}>
            {AI_COPY.siwcSignOut}
          </Key>
        </div>
      ) : null}
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        role="alertdialog"
        title={AI_COPY.siwcSignOutTitle}
        footer={
          <>
            <Key onClick={() => setConfirm(false)}>{AI_COPY.cancel}</Key>
            <Key variant="danger" onClick={() => void signOut()}>
              {AI_COPY.siwcSignOut}
            </Key>
          </>
        }
      >
        <p className="m-0">{AI_COPY.siwcSignOutBody}</p>
      </Dialog>
    </div>
  );
}
