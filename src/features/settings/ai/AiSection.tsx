/**
 * Settings › Coach (design/screens/settings-sync-ai.md §5): provider, key, capability check, model, Coach
 * behaviour and spending cap. Every control is UI-only (`ai.configure` has surfaces ['ui']); nothing here touches safety
 * settings. The key goes straight from an uncontrolled password field into the KeyVault: it is never held in React
 * state, never logged, and never part of the config (only its last four characters are shown).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronRight, Eye, EyeOff, ExternalLink, Trash2, X } from 'lucide-react';
import { Chip, Field, Icon, InlineWarning, Key, KeyBank, MonoMeta, NumberField, RadioGroup, Select, Sheet, Stack, Switch, TextInput, formatNumber, useMediaQuery, type RadioOption } from '@/components';
import { degradeFor, getPreset, listPresets, makeCustomPreset, ProviderError, type AdapterKind, type ModelInfo, type Preset } from '@/ai';
import { dispatch } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { onAiConfigChange, onAiUsageChange, readAiConfig, type AiProviderConfig, type UsageSummary } from '@/commands/ai';
import { setCoachAvailable } from '@/features/living/coach/availability';
import { registerDatabase } from '@/state/persistence';
import { SettingsSection } from '../sections';
import { SettingRow, SettingsDisclosure, SettingsGroup, SettingsItem, SettingInfo, useSavedFlash } from '../SettingRow';
import { AI_COPY, BADGE, presetNote, probeErrorText, TIER_WORD, usd } from './copy';
import { defaultAiDeps, keyBaseUrl, listModelsFor, resolveBaseUrl, runProbe, type AiSectionDeps, type ProbeOutcome } from './services';
import { NeedsServer, SERVER_PRESETS, serverErrorText, ServerKeyBlock, ServerPresetLabel, ServerUnreachableLine, SiwcBlock, useServerAi } from './ServerProviders';
import { useServerPairing } from '../server/hooks';
import { SpendTrack } from './SpendTrack';

// Erase everything also forgets saved keys and probe results (database `vitals-ai`).
registerDatabase('vitals-ai');

const CUSTOM = 'custom';
const OTHER = '__other';
const LOCAL_PRESETS = new Set(['ollama', 'lmstudio', 'vllm']);
/** `openai-chat` is the same provider as `openai` through another API; offered as the custom endpoint's style instead. */
const HIDDEN_PRESETS = new Set(['openai-chat']);
/** Below 768 px the provider list opens in a sheet instead of in place (r068 V5). */
const PHONE_ONLY = '(max-width: 47.99rem)';

const API_STYLES: ReadonlyArray<{ value: AdapterKind; label: string }> = [
  // (r068 final H1) short labels so three equal segments fit a phone row; the help line names the APIs in full
  { value: 'openai-chat', label: 'Chat' },
  { value: 'openai-responses', label: 'Responses' },
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
  // phones pick the provider in a sheet (a phone-only query: matchMedia-less tests keep the in-place list)
  const phone = useMediaQuery(PHONE_ONLY);
  const [picking, setPicking] = useState(false);

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

  // a plain list of names in three groups (hosted · on this computer · other); a note only where it says what the
  // provider needs (local, custom, through the server)
  const providerGroups = useMemo<ReadonlyArray<{ id: string; label: string; options: RadioOption[] }>>(() => {
    const browser = listPresets().filter((p) => !p.custom && !HIDDEN_PRESETS.has(p.id) && p.via === 'browser');
    // under "On this computer" a name needs no "(this computer)" of its own
    const option = (p: Preset): RadioOption => ({ value: p.id, label: p.label.replace(/ \(this computer\)$/, ''), help: presetNote(p) });
    return [
      { id: 'hosted', label: AI_COPY.hostedGroup, options: browser.filter((p) => !LOCAL_PRESETS.has(p.id)).map(option) },
      { id: 'local', label: AI_COPY.localGroup, options: browser.filter((p) => LOCAL_PRESETS.has(p.id)).map(option) },
      { id: 'other', label: AI_COPY.otherGroup, options: [{ value: CUSTOM, label: AI_COPY.customLabel, help: AI_COPY.customNote }] },
    ];
  }, []);
  // the providers a web page cannot call, grouped under "Through your server" with their state (§13.2): listed once this
  // device is paired with the server (or while one of them is still the chosen provider)
  const serverOptions: RadioOption[] = listPresets()
    .filter((p) => SERVER_PRESETS.has(p.id))
    .map((p) => ({ value: p.id, label: <ServerPresetLabel preset={p} paired={serverPaired} state={serverAi} />, help: presetNote(p) }));
  const showServerOptions = serverPaired || SERVER_PRESETS.has(presetId);
  const serverBlocked = preset?.via === 'server' && !serverPaired;
  const chosenName = preset ? (presetId === CUSTOM ? AI_COPY.customLabel : preset.label) : undefined;
  const providerList = (onChoose: (id: string) => void) => (
    <Stack gap="card">
      {providerGroups.map((g) => (
        <RadioGroup
          key={g.id}
          className="settings-providers"
          name="ai-provider"
          label={<span className="lm-group-label block">{g.label}</span>}
          value={presetId || undefined}
          onChange={onChoose}
          options={g.options}
        />
      ))}
      {showServerOptions ? (
        <RadioGroup
          className="settings-providers"
          name="ai-provider"
          label={<span className="lm-group-label block">{AI_COPY.viaServer}</span>}
          value={presetId || undefined}
          onChange={onChoose}
          options={serverOptions}
        />
      ) : null}
    </Stack>
  );

  return (
    <SettingsSection id="coach" title={AI_COPY.title} saved={saved}>
      <SettingsGroup>
        {/* a status line, not a control (r068 S28): a dot that lights when the Coach is on, and what to do when it is off */}
        <SettingRow label={AI_COPY.coachLabel} help={config ? undefined : AI_COPY.offHelp} info={preset ? { title: 'What the Coach sends', body: AI_COPY.sent.replace('{provider}', preset.label) } : undefined}>
          {() => (
            <span className="settings-status" data-on={config ? '' : undefined} role="status">
              <span className="settings-status__dot" aria-hidden="true" />
              {config ? `${getPreset(config.presetId)?.label ?? AI_COPY.customLabel} · ${config.model}` : AI_COPY.none}
            </span>
          )}
        </SettingRow>
        {phone ? (
          // phones (r068 V5): one row naming the provider; the grouped list opens in a sheet and a choice closes it
          <>
            <button type="button" className="settings-row settings-row--button" aria-haspopup="dialog" onClick={() => setPicking(true)}>
              <span className="settings-row__title">{AI_COPY.providerLabel}</span>
              <span className="settings-row__value">{chosenName ?? AI_COPY.choose}</span>
              <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
            </button>
            <Sheet open={picking} onClose={() => setPicking(false)} title={AI_COPY.providerLabel}>
              <div className="settings-sheet">
                {providerList((id) => {
                  choosePreset(id);
                  setPicking(false);
                })}
              </div>
            </Sheet>
          </>
        ) : (
          <SettingsDisclosure title={AI_COPY.providerLabel} value={chosenName} defaultOpen={!config}>
            {providerList(choosePreset)}
          </SettingsDisclosure>
        )}
        {presetId === CUSTOM || LOCAL_PRESETS.has(presetId) ? (
          <SettingsItem>
            <Field label={AI_COPY.baseUrlLabel} help={AI_COPY.baseUrlHelp} error={presetId === CUSTOM && baseUrl && !preset ? AI_COPY.baseUrlHelp : undefined}>
              <TextInput type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value.trim())} />
            </Field>
          </SettingsItem>
        ) : null}
        {presetId === CUSTOM ? (
          <SettingRow label={AI_COPY.styleLabel} help={AI_COPY.styleHelp} wide>
            {({ labelId }) => <KeyBank labelledBy={labelId} value={adapter} options={API_STYLES} onChange={setAdapter} />}
          </SettingRow>
        ) : null}
        {preset && serverBlocked ? <NeedsServer /> : null}
        {preset && !serverBlocked && preset.via === 'server' ? <ServerUnreachableLine preset={preset} /> : null}
        {preset && !serverBlocked ? (
          preset.id === 'siwc' ? (
            <SiwcBlock state={serverAi} />
          ) : preset.via === 'server' ? (
            <ServerKeyBlock preset={preset} state={serverAi} />
          ) : (
            <KeyBlock key={`${presetId}|${keyUrl}`} preset={preset} presetId={presetId} keyUrl={keyUrl} vault={d.vault} onChange={(has) => setKeyFor(has ? `${presetId}|${keyUrl}` : null)} />
          )
        ) : null}
        {preset && !serverBlocked ? (
          <ModelBlock key={presetId} preset={preset} model={model} setModel={setModel} visionModel={visionModel} setVisionModel={setVisionModel} loadModels={async (signal) => listModelsFor({ preset, baseUrl: effectiveBase, apiKey: needsKey(preset) ? ((await d.vault.get(presetId, keyBaseUrl(preset, effectiveBase))) ?? '') : '', deps: d, signal })} />
        ) : null}
        {preset && !serverBlocked ? <ProbeBlock preset={preset} probe={probe} current={probeKey} onTest={() => void testConnection()} /> : null}
        {presetId || config || status ? (
          <SettingsItem>
            {status ? (
              <InlineWarning severity={status.tone === 'ok' ? 'ok' : 'danger'} alert={status.tone === 'danger'}>
                {status.text}
              </InlineWarning>
            ) : null}
            {presetId || config ? (
              <div className="settings-keys">
                <Key variant="solid" onClick={() => void save()} disabled={!presetId} disabledReason={serverBlocked ? AI_COPY.needsServerShort : undefined}>
                  {AI_COPY.save}
                </Key>
                {config ? (
                  <Key variant="danger" icon={Trash2} onClick={() => void remove()}>
                    {AI_COPY.remove}
                  </Key>
                ) : null}
              </div>
            ) : null}
          </SettingsItem>
        ) : null}
      </SettingsGroup>

      {config ? (
        <SettingsGroup label={AI_COPY.behaviourHeading}>
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
        </SettingsGroup>
      ) : null}
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
    return (
      <SettingsItem>
        <p className="settings-note">{AI_COPY.noKeyNeeded}</p>
      </SettingsItem>
    );
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
    <SettingsItem>
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
      <div className="settings-keys">
        <Key size="sm" variant="action" loading={busy} onClick={() => void saveKey()}>
          {AI_COPY.saveKey}
        </Key>
        <Key size="sm" variant="outlined" icon={shown ? EyeOff : Eye} onClick={() => setShown((s) => !s)} aria-pressed={shown}>
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
      <p className="settings-note" role="status">
        {last4 ? AI_COPY.keySaved(last4) : (note ?? AI_COPY.keyNone)}
      </p>
    </SettingsItem>
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
    <SettingsItem>
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
      <div className="settings-keys">
        <Key variant="outlined" onClick={() => void load()} disabled={loadState.state === 'loading'}>
          {loadState.state === 'loading' ? AI_COPY.loadingModels : AI_COPY.loadModels}
        </Key>
        {loadState.state === 'done' ? <p className="settings-note">{AI_COPY.modelsLoaded(loadState.n)}</p> : null}
        {loadState.state === 'error' ? (
          <p className="settings-note" role="status">
            {loadState.message}
          </p>
        ) : null}
      </div>
      <Field label={AI_COPY.visionLabel} help={AI_COPY.visionHelp}>
        <TextInput autoComplete="off" autoCapitalize="none" spellCheck={false} value={visionModel} onChange={(e) => setVisionModel(e.target.value)} />
      </Field>
    </SettingsItem>
  );
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function ProbeBlock({ preset, probe, current, onTest }: { preset: Preset; probe: ProbeState; current: string; onTest: () => void }) {
  const done = probe.state === 'done' && probe.for === current ? probe.outcome : null;
  return (
    <SettingsItem>
      <p className="settings-note">{AI_COPY.checkConsent(preset.label)}</p>
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
    </SettingsItem>
  );
}

function ProbeResults({ outcome }: { outcome: ProbeOutcome }) {
  const { caps, latencyMs, basicTier } = outcome;
  const deg = degradeFor(caps);
  const badge = deg.chatOnly ? BADGE.chatOnly : basicTier ? BADGE.basic : BADGE.supported;
  const from = (tested: boolean) => (caps.source === 'selftest' && tested ? `Tested ${fmtDate(caps.verifiedAt)}` : caps.source === 'catalog' ? "Provider's catalogue" : "Provider's list");
  const yes = (b: boolean) => (b ? 'Yes' : 'No');
  const rows: Array<[string, string, string]> = [
    ['Use Vitals’ tools', yes(caps.tools), from(true)],
    ['Several tools at once', yes(caps.parallelTools), from(true)],
    ['Read food photos', yes(caps.vision), from(true)],
    ['Structured answers', yes(caps.jsonSchema || caps.jsonObject), from(true)],
    ['Streaming', yes(caps.streaming), "Provider's list"],
    ['Memory (context)', `${formatNumber(caps.contextTokens)} tokens`, from(false)],
    ['Basic tier', basicTier ? 'Yes, logs and answers only' : 'No', 'Model size'],
    ['Latency', latencyMs >= 0 ? `${formatNumber(latencyMs)} ms` : 'Not measured', latencyMs >= 0 ? 'This check' : 'Saved check'],
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
      <div className="settings-capabilities__head">
        <p className="settings-text">What this model can do</p>
        <SettingInfo title="What this model can do" info={{
          body: meaning.length ? meaning.join(' ') : 'The connection check and provider catalogue show which features this model supports. The table records the result, where it came from, memory size and connection latency.',
          twin: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[18rem] border-collapse text-sm">
                <caption className="lm-sr">What this model can do</caption>
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="lm-eng pb-1">Capability</th>
                    <th scope="col" className="lm-eng pb-1">Result</th>
                    <th scope="col" className="lm-eng pb-1">From</th>
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
          ),
        }} />
      </div>
      <ul className="settings-capabilities" aria-label="Model capabilities">
        {rows.slice(0, 5).map(([name, result]) => (
          <li key={name}>
            <Icon icon={result === 'Yes' ? Check : X} size={16} />
            <span>{name}</span>
            <span className="lm-sr">{result}</span>
          </li>
        ))}
      </ul>
      <MonoMeta items={[rows[5]![1], rows[7]![1]]} />
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
  return (
    <SettingsItem>
      <SpendTrack usage={usage} cap={cap} stopAtCap={stopAtCap} />
    </SettingsItem>
  );
}
