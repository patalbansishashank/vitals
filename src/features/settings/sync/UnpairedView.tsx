import { lazy, Suspense, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Field, InlineWarning, Key, TextInput, useField } from '@/components';
import { dispatch } from '@/commands';
import { describeLocalData } from '@/state/sync';
import { normalizeRelayUrl, parsePairingUri, wordsToSecret } from '@/sync/pairing';
import type { PairingCode } from '@/sync/types';
import { SYNC_COPY } from './copy';
import { ExistingDataDialog } from './ExistingDataDialog';
import { unwrap } from './unwrap';
import { testRelay, type RelayTestResult } from './relayTest';

const ScanDialog = lazy(() => import('./ScanDialog'));

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Multi-line code field wired to its <Field> like TextInput. */
function CodeArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const field = useField();
  return (
    <textarea
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className="lm-input min-h-[5.5rem] py-2 font-mono text-sm"
      rows={3}
      value={value}
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function UnpairedView({
  initialUrl = '',
  onPaired,
  intro = SYNC_COPY.intro,
  canSetUp = true,
}: {
  initialUrl?: string;
  onPaired: (code: PairingCode) => void;
  /** The first sentence (a home server holds a readable copy, a relay does not). */
  intro?: string;
  /** False with a paired home server: the server owns the sync group, so this device joins it and never makes a new one. */
  canSetUp?: boolean;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'pair' | 'join' | null>(null);
  const [tested, setTested] = useState<RelayTestResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [existing, setExisting] = useState<{ summary: string; resolve: (c: 'merge' | 'replace') => void } | null>(null);

  const relayOrError = (): string | null => {
    try {
      const normalized = normalizeRelayUrl(url);
      setUrlError(null);
      return normalized;
    } catch (e) {
      setUrlError(messageOf(e));
      return null;
    }
  };

  const onTest = async () => {
    setActionError(null);
    if (!url.trim()) return setUrlError('Enter the address of your sync server.');
    const relay = relayOrError();
    if (!relay) return;
    setBusy('test');
    try {
      setTested(await testRelay(relay));
    } finally {
      setBusy(null);
    }
  };

  const onPair = async () => {
    setActionError(null);
    if (!url.trim()) return setUrlError('Enter the address of your sync server.');
    const relay = relayOrError();
    if (!relay) return;
    setBusy('pair');
    try {
      // test before create: no key is made for a server that isn't there
      const t = await testRelay(relay);
      setTested(t);
      if (!t.ok) return;
      onPaired(unwrap(await dispatch('sync.pair', { relayUrl: relay })) as PairingCode);
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const onExisting = (summary: string) => new Promise<'merge' | 'replace'>((resolve) => setExisting({ summary, resolve }));

  const join = async (text: string) => {
    setActionError(null);
    const t = text.trim();
    if (!t) return setCodeError('Paste the pairing code first.');
    let arg: { code: string; relayUrl?: string };
    try {
      if (/^vitals-sync:/i.test(t)) {
        parsePairingUri(t);
        arg = { code: t };
      } else {
        wordsToSecret(t);
        setCodeError(null);
        if (!url.trim()) return setUrlError(SYNC_COPY.joinWordsNeedServer);
        const relay = relayOrError();
        if (!relay) return;
        arg = { code: t, relayUrl: relay };
      }
      setCodeError(null);
    } catch (e) {
      return setCodeError(messageOf(e));
    }
    setBusy('join');
    try {
      const local = describeLocalData();
      const onExistingChoice = local ? await onExisting(local) : 'merge';
      unwrap(await dispatch('sync.join', { ...arg, onExisting: onExistingChoice }));
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm leading-[1.5] text-ink">{intro}</p>
      <p className="m-0 text-xs leading-[1.45] text-ink-2">{SYNC_COPY.lnaHint}</p>
      <Field label={SYNC_COPY.serverLabel} help={SYNC_COPY.serverHelp} error={urlError ?? (tested && !tested.ok ? tested.message : null)}>
        <TextInput
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={SYNC_COPY.serverPlaceholder}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(null);
            setTested(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !joinOpen && canSetUp) void onPair();
          }}
        />
      </Field>
      {tested?.ok ? (
        <p role="status" className="m-0 text-sm text-ink">
          ✓ {tested.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Key loading={busy === 'test'} disabledReason={busy === 'pair' || busy === 'join' ? SYNC_COPY.testing : undefined} onClick={() => void onTest()}>
          {SYNC_COPY.test}
        </Key>
        {canSetUp ? (
          <Key variant="solid" loading={busy === 'pair'} disabledReason={busy === 'join' ? 'Joining…' : undefined} onClick={() => void onPair()}>
            {SYNC_COPY.setUp}
          </Key>
        ) : null}
        <Key pressed={joinOpen} aria-expanded={joinOpen} onClick={() => setJoinOpen((o) => !o)}>
          {SYNC_COPY.join}
        </Key>
      </div>
      {joinOpen ? (
        <div className="grid gap-3 border-t border-line pt-4">
          <Field label={SYNC_COPY.codeLabel} help={SYNC_COPY.joinHelp} error={codeError}>
            <CodeArea
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Key variant="solid" loading={busy === 'join'} disabledReason={busy === 'pair' ? 'Setting up…' : undefined} onClick={() => void join(code)}>
              {SYNC_COPY.joinKey}
            </Key>
            <Key icon={ScanLine} onClick={() => setScanOpen(true)}>
              {SYNC_COPY.scan}
            </Key>
          </div>
        </div>
      ) : null}
      {actionError ? (
        <InlineWarning severity="danger" alert>
          {actionError}
        </InlineWarning>
      ) : null}
      {scanOpen ? (
        <Suspense fallback={null}>
          <ScanDialog
            open
            onClose={() => setScanOpen(false)}
            onResult={(text) => {
              setScanOpen(false);
              setCode(text);
              void join(text);
            }}
          />
        </Suspense>
      ) : null}
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
