/**
 * Settings › AI provider (design/screens/settings-sync-ai.md §5): provider, key, capability check, model, Coach
 * behaviour and spending cap. Every control is UI-only (`ai.configure` has surfaces ['ui']); nothing here touches safety
 * settings. The key goes straight from an uncontrolled password field into the KeyVault: it is never held in React
 * state, never logged, and never part of the config (only its last four characters are shown).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Eye, EyeOff, ExternalLink, Trash2 } from 'lucide-react';
import {
  Chip,
  Engraved,
  Field,
  Icon,
  InlineWarning,
  Key,
  KeyBank,
  Notice,
  NumberField,
  RadioGroup,
  Select,
  Switch,
  TextInput,
  type RadioOption,
} from '@/components';
import { degradeFor, getPreset, listPresets, makeCustomPreset, ProviderError, type AdapterKind, type ModelInfo, type Preset } from '@/ai';
import { dispatch } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { onAiConfigChange, onAiUsageChange, readAiConfig, type AiProviderConfig, type UsageSummary } from '@/commands/ai';
import { setCoachAvailable } from '@/features/living/coach/availability';
import { registerDatabase } from '@/state/persistence';
import { SettingsSection } from '../sections';
import { SettingRow, useSavedFlash } from '../SettingRow';
import { AI_COPY, BADGE, presetNote, probeErrorText, TIER_WORD, usd } from './copy';
import { defaultAiDeps, keyBaseUrl, listModelsFor, resolveBaseUrl, runProbe, type AiSectionDeps, type ProbeOutcome } from './services';
import { NeedsServer, SERVER_PRESETS, serverErrorText, ServerKeyBlock, ServerPresetLabel, ServerUnreachableLine, SiwcBlock, useServerAi } from './ServerProviders';
import { useServerPairing } from '../server/hooks';

// Erase everything also forgets saved keys and probe results (database `vitals-ai`).
registerDatabase('vitals-ai');

const CUSTOM = 'custom';
const OTHER = '__other';
const LOCAL_PRESETS = new Set(['ollama', 'lmstudio', 'vllm']);
/** `openai-chat` is the same provider as `openai` through another API; offered as the custom endpoint's style instead. */
const HIDDEN_PRESETS = new Set(['openai-chat']);

const API_STYLES: ReadonlyArray<{ value: AdapterKind; label: string }> = [
  { value: 'openai-chat', label: 'OpenAI chat' },
  { value: 'openai-responses', label: 'OpenAI responses' },
  { value: 'anthropic-messages', label: 'Anthropic' },
];

function useAiConfig(): AiProviderConfig | null {
  return useSyncExternalStore(onAiConfigChange, readAiConfig, readAiConfig);
}

function presetFor(presetId: string, baseUrl: string, adapter: AdapterKind): Preset | null {
  if (presetId !== CUSTOM) return getPreset(presetId) ?? null;
  try {
    return makeCustomPreset({ id: 'custom-endpoint', label: 'your server', adapter, baseUrl });
  } catch {
    return null;
  }
}

const needsKey = (p: Preset) => p.via === 'browser' && p.authHeader !== 'none';

type ProbeState = { state: 'idle' } | { state: 'running' } | { state: 'done'; outcome: ProbeOutcome; for: string } | { state: 'error'; message: string };

export function AiSection({ deps }: { deps?: AiSectionDeps }) {
  const [d] = useState(() => deps ?? defaultAiDeps());
  const config = useAiConfig();
  const serverPaired = useServerPairing() !== null;
  const serverAi = useServerAi();
  const [saved, flash] = useSavedFlash();

  const [presetId, setPresetId] = useState(config?.presetId ?? '');
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [adapter, setAdapter] = useState<AdapterKind>(config?.adapter ?? 'openai-chat');
  const [model, setModel] = useState(config?.model ?? '');
  const [visionModel, setVisionModel] = useState(config?.visionModel ?? '');
  const [smallEdits, setSmallEdits] = useState(config?.smallEditsWithoutAsking ?? false);
  const [cap, setCap] = useState<number | null>(config?.spendCapUsdMonthly ?? null);
  const [stopAtCap, setStopAtCap] = useState(config?.stopAtCap ?? false);
  /** `presetId|keyUrl` the KeyVault holds a key for (reported by KeyBlock). */
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ state: 'idle' });
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  // A config loaded or changed elsewhere (boot, another tab, undo) resets the draft (state adjusted during render).
  const configJson = JSON.stringify(config);
  const [seenConfig, setSeenConfig] = useState(configJson);
  if (seenConfig !== configJson) {
    setSeenConfig(configJson);
    if (config) {
      setPresetId(config.presetId);
      setBaseUrl(config.baseUrl ?? '');
      setAdapter(config.adapter ?? 'openai-chat');
      setModel(config.model);
      setVisionModel(config.visionModel ?? '');
      setSmallEdits(config.smallEditsWithoutAsking);
      setCap(config.spendCapUsdMonthly ?? null);
      setStopAtCap(config.stopAtCap ?? false);
    }
  }

  const preset = useMemo(() => presetFor(presetId, baseUrl, adapter), [presetId, baseUrl, adapter]);
  const effectiveBase = presetId === CUSTOM || LOCAL_PRESETS.has(presetId) ? baseUrl || undefined : undefined;
  const probeKey = `${presetId}|${effectiveBase ?? ''}|${model}`;
  const keyUrl = preset ? keyBaseUrl(preset, effectiveBase) : '';
  const hasKey = keyFor === `${presetId}|${keyUrl}`;

  // Cached capabilities for the saved model show without a new check.
  useEffect(() => {
    if (!preset || !model || preset.via === 'server') return;
    let live = true;
    let url: string;
    try {
      url = resolveBaseUrl(preset, effectiveBase, d);
    } catch {
      return;
    }
    void d.cache.get(url, model, (d.now?.() ?? new Date()).toISOString()).then((caps) => {
      if (live && caps) setProbe((p) => (p.state === 'idle' ? { state: 'done', outcome: { caps, latencyMs: -1, basicTier: degradeFor(caps, { model, presetId }).basicTier }, for: probeKey } : p));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by probeKey
  }, [probeKey]);

  const choosePreset = (id: string) => {
    setPresetId(id);
    setStatus(null);
    setProbe({ state: 'idle' });
    const p = id === CUSTOM ? null : getPreset(id);
    setModel(p?.defaultModel || p?.recommendedModels[0]?.id || '');
    setVisionModel('');
    setBaseUrl(p && LOCAL_PRESETS.has(id) ? p.baseUrl : '');
  };

  /** Settings that apply at once when a provider is saved (switches, cap). */
  const applyNow = async (patch: Partial<AiProviderConfig>) => {
    if (!config) return;
    const r = await dispatch('ai.configure', { preset: { ...config, ...patch } });
    if (r.ok) flash();
  };

  const testConnection = async () => {
    if (!preset || !model) return setProbe({ state: 'error', message: AI_COPY.needModel });
    setProbe({ state: 'running' });
    try {
      const apiKey = needsKey(preset) ? await d.vault.get(presetId, keyBaseUrl(preset, effectiveBase)) : '';
      if (needsKey(preset) && !apiKey) return setProbe({ state: 'error', message: AI_COPY.needKey });
      const outcome = await runProbe({ preset, model, baseUrl: effectiveBase, apiKey: apiKey ?? '', deps: d });
      setProbe({ state: 'done', outcome, for: probeKey });
    } catch (e) {
      // through the server: its own words (not signed in, no key, can't reach it) before the provider's
      const viaServer = preset.via === 'server' ? serverErrorText(e) : null;
      if (viaServer) return setProbe({ state: 'error', message: viaServer });
      const kind = e instanceof ProviderError ? e.kind : e instanceof TypeError ? 'network' : undefined;
      setProbe({ state: 'error', message: probeErrorText(kind, preset.label, preset.corsFixText) });
    }
  };

  const save = async () => {
    setStatus(null);
    if (!preset) return setStatus({ tone: 'danger', text: presetId === CUSTOM ? AI_COPY.baseUrlHelp : AI_COPY.providerLabel });
    if (!model.trim()) return setStatus({ tone: 'danger', text: AI_COPY.needModel });
    if (needsKey(preset) && !hasKey) return setStatus({ tone: 'danger', text: AI_COPY.needKey });
    if (preset.via === 'server' && !serverPaired) return setStatus({ tone: 'danger', text: AI_COPY.needsServerShort });
    const next: Record<string, unknown> = { presetId, model: model.trim(), smallEditsWithoutAsking: smallEdits, stopAtCap };
    if (effectiveBase) next.baseUrl = effectiveBase;
    if (presetId === CUSTOM) next.adapter = adapter;
    if (visionModel.trim()) next.visionModel = visionModel.trim();
    if (cap) next.spendCapUsdMonthly = cap;
    const r = await dispatch('ai.configure', { preset: next });
    if (!r.ok) return setStatus({ tone: 'danger', text: r.error.message });
    // The Coach runtime re-probes on its own; a check just made here that shows tool use is enough to switch it on.
    if (probe.state === 'done' && probe.for === probeKey && probe.outcome.caps.tools) setCoachAvailable(true);
    setStatus({ tone: 'ok', text: AI_COPY.saved });
    flash();
  };

  const remove = async () => {
    const was = config?.presetId ?? presetId;
    const r = await dispatch('ai.configure', { preset: { remove: true } });
    if (!r.ok) return setStatus({ tone: 'danger', text: r.error.message });
    setCoachAvailable(false);
    if (was) await d.vault.remove(was).catch(() => undefined);
    setPresetId('');
    setModel('');
    setBaseUrl('');
    setVisionModel('');
    setSmallEdits(false);
    setCap(null);
    setStopAtCap(false);
    setProbe({ state: 'idle' });
    setStatus({ tone: 'ok', text: AI_COPY.removed });
    flash();
  };

  const providerOptions = useMemo<RadioOption[]>(() => {
    const opts: RadioOption[] = listPresets()
      .filter((p) => !p.custom && !HIDDEN_PRESETS.has(p.id) && p.via === 'browser')
      .map((p) => ({ value: p.id, label: p.label, help: presetNote(p), disabled: false }));
    opts.push({ value: CUSTOM, label: AI_COPY.customLabel, help: AI_COPY.customNote });
    return opts;
  }, []);
  // the providers a web page cannot call, grouped under "via your server" with their state (§13.2)
  const serverOptions: RadioOption[] = listPresets()
    .filter((p) => SERVER_PRESETS.has(p.id))
    .map((p) => ({ value: p.id, label: <ServerPresetLabel preset={p} paired={serverPaired} state={serverAi} />, help: presetNote(p) }));
  const serverBlocked = preset?.via === 'server' && !serverPaired;

  return (
    <SettingsSection id="coach" title={AI_COPY.title} saved={saved}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="m-0 text-sm leading-[1.5] text-ink" role="status">
            {config ? `${getPreset(config.presetId)?.label ?? AI_COPY.customLabel} · ${config.model}` : AI_COPY.none}
          </p>
          <p className="m-0 text-xs leading-[1.45] text-ink-2">{AI_COPY.uiOnly}</p>
        </div>

        <details className="group border-t border-line pt-4" open={!config}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
            {AI_COPY.providerLabel}: {preset ? (presetId === CUSTOM ? AI_COPY.customLabel : preset.label) : '—'}
          </summary>
          <div className="mt-3">
            <RadioGroup name="ai-provider" label={<span className="lm-sr">{AI_COPY.providerLabel}</span>} value={presetId || undefined} onChange={choosePreset} options={providerOptions} />
            <div className="mt-4 border-t border-line pt-3">
              <RadioGroup name="ai-provider" label={<Engraved>{AI_COPY.viaServer}</Engraved>} value={presetId || undefined} onChange={choosePreset} options={serverOptions} />
            </div>
          </div>
        </details>

        {presetId === CUSTOM || LOCAL_PRESETS.has(presetId) ? (
          <div className="grid gap-3">
            <Field label={AI_COPY.baseUrlLabel} help={AI_COPY.baseUrlHelp} error={presetId === CUSTOM && baseUrl && !preset ? AI_COPY.baseUrlHelp : undefined}>
              <TextInput type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value.trim())} />
            </Field>
            {presetId === CUSTOM ? (
              <SettingRow label={AI_COPY.styleLabel}>
                {({ labelId }) => <KeyBank labelledBy={labelId} value={adapter} options={API_STYLES} onChange={setAdapter} />}
              </SettingRow>
            ) : null}
          </div>
        ) : null}

        {preset && serverBlocked ? <NeedsServer /> : null}
        {preset && !serverBlocked ? (
          <>
            {preset.via === 'server' ? <ServerUnreachableLine preset={preset} /> : null}
            {preset.id === 'siwc' ? <SiwcBlock state={serverAi} /> : preset.via === 'server' ? <ServerKeyBlock preset={preset} state={serverAi} /> : null}
            {preset.via === 'browser' ? <KeyBlock key={`${presetId}|${keyUrl}`} preset={preset} presetId={presetId} keyUrl={keyUrl} vault={d.vault} onChange={(has) => setKeyFor(has ? `${presetId}|${keyUrl}` : null)} /> : null}
            <ModelBlock key={presetId} preset={preset} model={model} setModel={setModel} visionModel={visionModel} setVisionModel={setVisionModel} loadModels={async (signal) => listModelsFor({ preset, baseUrl: effectiveBase, apiKey: needsKey(preset) ? ((await d.vault.get(presetId, keyBaseUrl(preset, effectiveBase))) ?? '') : '', deps: d, signal })} />
            <ProbeBlock preset={preset} probe={probe} current={probeKey} onTest={() => void testConnection()} />
          </>
        ) : null}

        <div className="grid gap-0 border-t border-line pt-4">
          <Engraved as="p" className="m-0 mb-2">
            {AI_COPY.behaviourHeading}
          </Engraved>
          <SettingRow label={AI_COPY.smallEditsLabel} help={AI_COPY.smallEditsHelp}>
            {({ labelId, helpId }) => (
              <Switch
                checked={smallEdits}
                labelledBy={labelId}
                describedBy={helpId}
                onChange={(v) => {
                  setSmallEdits(v);
                  void applyNow({ smallEditsWithoutAsking: v });
                }}
              />
            )}
          </SettingRow>
          <SettingRow label={AI_COPY.capLabel} help={AI_COPY.capHelp}>
            {() => (
              <NumberField
                name={AI_COPY.capLabel}
                value={cap}
                min={0}
                max={10_000}
                step={1}
                unit="USD"
                onChange={(v) => {
                  const next = v > 0 ? v : null;
                  setCap(next);
                  void applyNow({ spendCapUsdMonthly: next ?? undefined });
                }}
              />
            )}
          </SettingRow>
          <SettingRow label={AI_COPY.stopAtCapLabel} help={AI_COPY.stopAtCapHelp}>
            {({ labelId, helpId }) => (
              <Switch
                checked={stopAtCap}
                labelledBy={labelId}
                describedBy={helpId}
                onChange={(v) => {
                  setStopAtCap(v);
                  void applyNow({ stopAtCap: v });
                }}
              />
            )}
          </SettingRow>
          <UsageBlock cap={cap} stopAtCap={stopAtCap} />
        </div>

        {preset ? <p className="m-0 text-xs leading-[1.45] text-ink-2">{AI_COPY.sent.replace('{provider}', preset.label)}</p> : null}

        {status ? (
          <InlineWarning severity={status.tone === 'ok' ? 'ok' : 'danger'} alert={status.tone === 'danger'}>
            {status.text}
          </InlineWarning>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Key variant="solid" onClick={() => void save()} disabled={!presetId} disabledReason={serverBlocked ? AI_COPY.needsServerShort : undefined}>
            {AI_COPY.save}
          </Key>
          {config ? (
            <Key variant="danger" icon={Trash2} onClick={() => void remove()}>
              {AI_COPY.remove}
            </Key>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}

function KeyBlock({ preset, presetId, keyUrl, vault, onChange }: { preset: Preset; presetId: string; keyUrl: string; vault: AiSectionDeps['vault']; onChange: (has: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [last4, setLast4] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keyed by preset and address in the parent: a new address starts from a clean state.
  useEffect(() => {
    let live = true;
    if (!needsKey(preset)) return;
    void (async () => {
      const s = await vault.status(presetId, keyUrl).catch(() => 'none' as const);
      if (!live) return;
      if (s === 'origin-mismatch') {
        // A key filed for another address is never sent to this one (settings-sync-ai.md §5.2).
        await vault.remove(presetId).catch(() => undefined);
        if (live) setNote(AI_COPY.keyMoved);
        return;
      }
      if (s === 'none') return;
      const k = await vault.get(presetId, keyUrl).catch(() => null);
      if (!live || !k) return;
      setLast4(k.slice(-4));
      onChange(true);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a state setter
  }, [preset, presetId, keyUrl, vault]);

  if (!needsKey(preset)) {
    return <p className="m-0 border-t border-line pt-4 text-xs text-ink-2">{AI_COPY.noKeyNeeded}</p>;
  }

  const saveKey = async () => {
    const value = input.current?.value.trim() ?? '';
    if (!value) return setError(AI_COPY.keyEmpty);
    setBusy(true);
    setError(null);
    try {
      await vault.save(presetId, keyUrl, value, { mode: 'device' });
      if (input.current) input.current.value = '';
      setLast4(value.slice(-4));
      setNote(null);
      onChange(true);
    } catch (e) {
      setError(e instanceof TypeError ? e.message : 'Could not save the key on this device.');
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    await vault.remove(presetId).catch(() => undefined);
    setLast4(null);
    onChange(false);
  };

  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <Field label={AI_COPY.keyLabel} help={AI_COPY.keyHelp(preset.label)} error={error}>
        <TextInput
          ref={input}
          type={shown ? 'text' : 'password'}
          name="ai-api-key"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={last4 ? `…${last4}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveKey();
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Key size="sm" variant="solid" loading={busy} onClick={() => void saveKey()}>
          {AI_COPY.saveKey}
        </Key>
        <Key size="sm" variant="quiet" icon={shown ? EyeOff : Eye} onClick={() => setShown((s) => !s)} aria-pressed={shown}>
          {shown ? AI_COPY.hide : AI_COPY.show}
        </Key>
        {last4 ? (
          <Key size="sm" variant="quiet" icon={Trash2} onClick={() => void removeKey()}>
            {AI_COPY.removeKey}
          </Key>
        ) : null}
        {preset.keyHelpUrl ? (
          <a className="lm-link inline-flex items-center gap-1 text-sm" href={preset.keyHelpUrl} target="_blank" rel="noreferrer noopener">
            {AI_COPY.getKey} <Icon icon={ExternalLink} size={14} />
          </a>
        ) : null}
      </div>
      <p className="m-0 text-xs text-ink-2" role="status">
        {last4 ? AI_COPY.keySaved(last4) : (note ?? AI_COPY.keyNone)}
      </p>
    </div>
  );
}

function ModelBlock({ preset, model, setModel, visionModel, setVisionModel, loadModels }: { preset: Preset; model: string; setModel: (m: string) => void; visionModel: string; setVisionModel: (m: string) => void; loadModels: (signal?: AbortSignal) => Promise<ModelInfo[]> }) {
  const [loaded, setLoaded] = useState<ModelInfo[] | null>(null);
  const [loadState, setLoadState] = useState<{ state: 'idle' } | { state: 'loading' } | { state: 'done'; n: number } | { state: 'error'; message: string }>({ state: 'idle' });
  const recommended = preset.recommendedModels;
  // Recommended first (with their tier words), then every other id the provider listed.
  const listed = [
    ...recommended.map((m) => ({ id: m.id, label: `${TIER_WORD[m.tier] ?? m.tier} · ${m.label}${m.usdPerDay !== undefined && m.usdPerDay > 0 ? ` · about ${usd(m.usdPerDay)} a day` : ''}` })),
    ...(loaded ?? []).filter((m) => !recommended.some((r) => r.id === m.id)).map((m) => ({ id: m.id, label: m.label && m.label !== m.id ? `${m.id} · ${m.label}` : m.id })),
  ];
  const [other, setOther] = useState(() => !listed.some((m) => m.id === model));
  const options = [...listed.map((m) => ({ value: m.id, label: m.label })), { value: OTHER, label: AI_COPY.modelOther }];
  const load = async () => {
    setLoadState({ state: 'loading' });
    try {
      const list = await loadModels();
      setLoaded(list);
      setLoadState({ state: 'done', n: list.length });
      if (list.some((m) => m.id === model)) setOther(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const viaServer = preset.via === 'server' ? serverErrorText(e) : null;
      setLoadState({ state: 'error', message: viaServer ?? AI_COPY.modelsFailed(msg) });
    }
  };
  return (
    <div className="grid gap-3 border-t border-line pt-4">
      {listed.length ? (
        <Field label={AI_COPY.modelLabel} help={AI_COPY.modelHelp}>
          <Select
            value={other || !listed.some((m) => m.id === model) ? OTHER : model}
            options={options}
            onChange={(v) => {
              if (v === OTHER) return setOther(true);
              setOther(false);
              setModel(v);
            }}
          />
        </Field>
      ) : null}
      {other || !listed.length || !listed.some((m) => m.id === model) ? (
        <Field label={AI_COPY.modelIdLabel} help={listed.length ? undefined : AI_COPY.modelHelp}>
          <TextInput autoComplete="off" autoCapitalize="none" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Key variant="quiet" onClick={() => void load()} disabled={loadState.state === 'loading'}>
          {loadState.state === 'loading' ? AI_COPY.loadingModels : AI_COPY.loadModels}
        </Key>
        {loadState.state === 'done' ? <p className="m-0 text-xs text-ink-2">{AI_COPY.modelsLoaded(loadState.n)}</p> : null}
        {loadState.state === 'error' ? (
          <p className="m-0 text-xs text-ink-2" role="status">
            {loadState.message}
          </p>
        ) : null}
      </div>
      <Field label={AI_COPY.visionLabel} help={AI_COPY.visionHelp}>
        <TextInput autoComplete="off" autoCapitalize="none" spellCheck={false} value={visionModel} onChange={(e) => setVisionModel(e.target.value)} />
      </Field>
    </div>
  );
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function ProbeBlock({ preset, probe, current, onTest }: { preset: Preset; probe: ProbeState; current: string; onTest: () => void }) {
  const done = probe.state === 'done' && probe.for === current ? probe.outcome : null;
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <Engraved as="p" className="m-0">
        {AI_COPY.checkHeading}
      </Engraved>
      <p className="m-0 text-xs leading-[1.45] text-ink-2">{AI_COPY.checkConsent(preset.label)}</p>
      <div>
        <Key size="sm" loading={probe.state === 'running'} onClick={onTest}>
          {probe.state === 'running' ? AI_COPY.checking : AI_COPY.check}
        </Key>
      </div>
      {probe.state === 'error' ? (
        <InlineWarning severity="danger" alert>
          {probe.message}
        </InlineWarning>
      ) : null}
      {done ? <ProbeResults outcome={done} /> : null}
    </div>
  );
}

function ProbeResults({ outcome }: { outcome: ProbeOutcome }) {
  const { caps, latencyMs, basicTier } = outcome;
  const deg = degradeFor(caps);
  const badge = deg.chatOnly ? BADGE.chatOnly : basicTier ? BADGE.basic : BADGE.supported;
  const from = (tested: boolean) => (caps.source === 'selftest' && tested ? `tested ${fmtDate(caps.verifiedAt)}` : caps.source === 'catalog' ? "provider's catalogue" : "provider's list");
  const yes = (b: boolean) => (b ? '✓ yes' : '✗ no');
  const rows: Array<[string, string, string]> = [
    ['use Vitals’ tools', yes(caps.tools), from(true)],
    ['several tools at once', yes(caps.parallelTools), from(true)],
    ['read food photos', yes(caps.vision), from(true)],
    ['structured answers', yes(caps.jsonSchema || caps.jsonObject), from(true)],
    ['streaming', yes(caps.streaming), "provider's list"],
    ['memory (context)', `${caps.contextTokens.toLocaleString()} tokens`, from(false)],
    ['basic tier', basicTier ? 'yes — logs and answers only' : 'no', 'model size'],
    ['latency', latencyMs >= 0 ? `${latencyMs.toLocaleString()} ms` : 'not measured', latencyMs >= 0 ? 'this check' : 'saved check'],
  ];
  const meaning: string[] = [];
  if (deg.chatOnly) meaning.push("No tools: the Coach answers but can't log or look things up.");
  if (!caps.vision) meaning.push('No photos: the photo key is hidden in Coach (or add a model for photos).');
  if (basicTier) meaning.push('Basic: logging and answers only; plan edits and simulations are refused.');
  if (deg.nonStreaming) meaning.push('No streaming: replies appear all at once.');
  return (
    <div className="grid gap-2" aria-live="polite">
      <div>
        <Chip kind="status" severity={deg.chatOnly ? 'danger' : basicTier ? 'caution' : 'ok'}>
          {badge}
        </Chip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] border-collapse text-sm">
          <caption className="lm-sr">What this model can do</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="lm-eng pb-1 font-normal">capability</th>
              <th scope="col" className="lm-eng pb-1 font-normal">result</th>
              <th scope="col" className="lm-eng pb-1 font-normal">from</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, f]) => (
              <tr key={k} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">{k}</th>
                <td className="py-1 pr-3 tabular-nums">{v}</td>
                <td className="py-1 text-xs text-ink-2">{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meaning.map((m) => (
        <p key={m} className="m-0 text-xs leading-[1.45] text-ink-2">
          {m}
        </p>
      ))}
    </div>
  );
}

function UsageBlock({ cap, stopAtCap }: { cap: number | null; stopAtCap: boolean }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void sendCommand('ai.usage', {}, { silent: true }).then((r) => {
        if (live && r.ok && 'output' in r) setUsage(r.output as UsageSummary);
      });
    load();
    const off = onAiUsageChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!usage) return null;
  const month = usage.periods.thisMonth.costUsd;
  const fraction = cap ? month / cap : null;
  const est = (n: number) => `about ${usd(n)}`;
  return (
    <div className="grid gap-2 border-t border-line pt-3">
      <p className="m-0 text-sm text-ink">
        <span className="lm-eng">{AI_COPY.usageHeading}</span> today {est(usage.periods.today.costUsd)} · 7 days {est(usage.periods.last7Days.costUsd)} · 30 days {est(usage.periods.last30Days.costUsd)}
      </p>
      <p className="m-0 text-xs text-ink-2">
        {(usage.periods.last30Days.inputTokens + usage.periods.last30Days.outputTokens).toLocaleString()} tokens in 30 days · {AI_COPY.usageNote}
      </p>
      {cap && fraction !== null && fraction >= 1 ? (
        <Notice severity="caution" layout="ruled" title={AI_COPY.capReached(usd(cap))}>
          {stopAtCap ? AI_COPY.capPaused : AI_COPY.capWarnOnly}
        </Notice>
      ) : cap && fraction !== null && fraction >= 0.8 ? (
        <InlineWarning severity="caution">{AI_COPY.capWarn(Math.floor(fraction * 100), usd(cap))}</InlineWarning>
      ) : null}
    </div>
  );
}
