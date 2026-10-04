/**
 * Safety store: persistence shape (DS-10: no SCOFF items), the settings v2 → v3 migration of the interim
 * `allowLongFasts` switch, import review, acknowledgement versioning through the access hook.
 */
import { act, renderHook } from '@testing-library/react';
import { exportAll, getRegisteredStores, importAll, parseImport } from '@/state/persistence';
import { SAFETY_KEY, isSafetyState, pickSafetyValues, useSafetyStore } from '@/state/safetyStore';
import { SETTINGS_KEY, SETTINGS_VERSION, useSettingsStore } from '@/state/settingsStore';
import { ACK_VERSIONS, modeSummary } from '../copy';
import { gateStatus } from '../gate';
import { missingQuestions } from '../safetyRules';
import { STANDARD_ANSWERS, seedClearedSafety } from '../testing';
import { useSafetyAccess } from '../useSafetyAccess';
import { withSystemWrite } from '@/state/scope';

const AT = '2026-09-30T10:00:00.000Z';
const stored = () => JSON.parse(localStorage.getItem(SAFETY_KEY) ?? 'null') as { state: Record<string, unknown>; version: number } | null;

beforeEach(async () => {
  localStorage.clear();
  act(() => useSafetyStore.getState().resetSafety());
  await act(() => useSettingsStore.persist.rehydrate());
});

describe('safety store persistence', () => {
  it('stores the SCOFF risk flag, never the SCOFF answers (DS-10)', () => {
    act(() =>
      useSafetyStore.getState().commitAnswers(
        { ...STANDARD_ANSWERS, scoffRisk: undefined, scoff: { sick: 'yes', control: 'yes', weightLoss: 'no', believeFat: 'no', foodDominates: 'no' } },
        AT,
      ),
    );
    const s = stored();
    expect(s?.version).toBe(1);
    const answers = s?.state.answers as Record<string, unknown>;
    expect(answers).not.toHaveProperty('scoff');
    expect(answers.scoffRisk).toBe(true);
    expect(localStorage.getItem(SAFETY_KEY)).not.toMatch(/foodDominates|believeFat/);
    expect(s?.state.answeredAt).toBe(AT);
  });

  it('forgets only the age answer on "I entered my age by mistake"', () => {
    act(() => useSafetyStore.getState().commitAnswers({ ageBand: 'under-18' }, AT));
    expect(useSafetyStore.getState().answers).toEqual({ ageBand: 'under-18' });
    act(() => useSafetyStore.getState().clearAgeAnswer());
    expect(useSafetyStore.getState().answers).toBeNull();
  });

  it('is registered for export/import/erase with a readable summary and validation', () => {
    const reg = getRegisteredStores().find((r) => r.key === SAFETY_KEY);
    expect(reg?.label).toBe('safety answers');
    expect(reg?.describe?.({ answers: { ...STANDARD_ANSWERS, eatingDisorder: 'yes' } })).toBe('safety answers (Gentle mode)');
    expect(reg?.describe?.({ answers: null })).toBeNull();
    expect(isSafetyState({ answers: 'nope' })).toBe(false);
    expect(isSafetyState({ answers: STANDARD_ANSWERS, fastingOptIn: { tier: 'T9' } })).toBe(false);
    expect(isSafetyState({ answers: null })).toBe(true);
  });

  it('re-sanitises imported answers (a file cannot smuggle SCOFF items in)', () => {
    const v = pickSafetyValues({ answers: { ...STANDARD_ANSWERS, scoffRisk: undefined, scoff: { sick: 'yes', control: 'yes', weightLoss: 'yes', believeFat: 'no', foodDominates: 'no' } } });
    expect(v.answers).not.toHaveProperty('scoff');
    expect(v.answers?.scoffRisk).toBe(true);
  });
});

describe('settings v2 → v3 migration (interim allowLongFasts)', () => {
  it('moves allowLongFasts: true to the safety store as a request that needs the new acknowledgements', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: { units: 'imperial', theme: 'dark', allowLongFasts: true }, version: 2 }));
    await act(() => useSettingsStore.persist.rehydrate());
    expect(SETTINGS_VERSION).toBe(3);
    expect(useSettingsStore.getState().units).toBe('imperial');
    expect(useSettingsStore.getState()).not.toHaveProperty('allowLongFasts');
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { state: Record<string, unknown>; version: number };
    expect(persisted.version).toBe(3);
    expect(persisted.state).not.toHaveProperty('allowLongFasts');
    expect(useSafetyStore.getState().legacyLongFastsRequest).toBe(true);
    expect(stored()?.state.legacyLongFastsRequest).toBe(true);

    // The request alone never unlocks longer fasts: plans stay at 24 h until the user confirms.
    act(() => seedClearedSafety(STANDARD_ANSWERS, AT));
    act(() => withSystemWrite(() => useSafetyStore.setState({ legacyLongFastsRequest: true })));
    const { result } = renderHook(() => useSafetyAccess());
    expect(result.current.fasting.legacyRequest).toBe(true);
    expect(result.current.fasting.optedTier).toBeNull();
    expect(result.current.fasting.maxFastHours).toBe(24);
  });

  it('does nothing for allowLongFasts: false, or when a real opt-in already exists', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: { allowLongFasts: false }, version: 2 }));
    await act(() => useSettingsStore.persist.rehydrate());
    expect(useSafetyStore.getState().legacyLongFastsRequest).toBe(false);

    act(() => useSafetyStore.getState().setFastingOptIn({ tier: 'T2', acknowledged: ['A', 'B'], ackVersion: 1, priorFastTolerated: true, at: AT }));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: { allowLongFasts: true }, version: 2 }));
    await act(() => useSettingsStore.persist.rehydrate());
    expect(useSafetyStore.getState().legacyLongFastsRequest).toBe(false);
  });

  it('confirming the opt-in clears the legacy request', () => {
    act(() => useSafetyStore.getState().adoptLegacyLongFasts());
    act(() => useSafetyStore.getState().setFastingOptIn({ tier: 'T2', acknowledged: ['B', 'A', 'A'], ackVersion: 1, priorFastTolerated: true, at: AT }));
    expect(useSafetyStore.getState().legacyLongFastsRequest).toBe(false);
    expect(useSafetyStore.getState().fastingOptIn?.acknowledged).toEqual(['A', 'B']);
  });
});

describe('import review and acknowledgement versioning', () => {
  it('imported answers wait for confirmation before the gate clears; merge keeps this device’s answers', async () => {
    act(() => seedClearedSafety(STANDARD_ANSWERS, AT));
    const file = JSON.stringify({
      vitalsVersion: '1',
      stores: { [SAFETY_KEY]: { version: 1, state: { answers: { ...STANDARD_ANSWERS, eatingDisorder: 'yes' }, answeredAt: AT, questionSetVersion: 1, acknowledgements: { disclaimer: { version: 1, at: AT } } } } },
    });
    const preview = parseImport(file);
    expect(preview.ok && preview.entries[0]?.summary).toBe('safety answers (Gentle mode)');

    await act(() => importAll(file, 'merge'));
    expect(useSafetyStore.getState().answers?.eatingDisorder).toBe('no');
    expect(useSafetyStore.getState().pendingReview).toBe(false);

    await act(() => importAll(file, 'replace'));
    const s = useSafetyStore.getState();
    expect(s.answers?.eatingDisorder).toBe('yes');
    expect(s.pendingReview).toBe(true);
    expect(gateStatus(s, AT)).toEqual({ status: 'needs-review', reason: 'import' });

    act(() => useSafetyStore.getState().commitAnswers(s.answers!, AT));
    expect(useSafetyStore.getState().pendingReview).toBe(false);
    expect(exportAll().stores[SAFETY_KEY]).toBeDefined();
  });

  it('export → replace-import round-trips the eating-questions outcome, opt-ins and acknowledgements (QA 13)', async () => {
    act(() => {
      seedClearedSafety({ ...STANDARD_ANSWERS, scoffRisk: true }, AT);
      useSafetyStore.getState().setFastingOptIn({ tier: 'T3', acknowledged: ['a', 'b'], ackVersion: 1, at: AT } as never);
    });
    const file = JSON.stringify(exportAll());
    act(() => useSafetyStore.getState().resetSafety());
    await act(() => importAll(parseImport(file) as never, 'replace'));
    const s = useSafetyStore.getState();
    expect(s.answers?.scoffRisk).toBe(true);
    expect(s.answers).not.toHaveProperty('scoff');
    expect(s.fastingOptIn?.tier).toBe('T3');
    expect(s.acknowledgements.disclaimer).toBeDefined();
    // the kept outcome counts as answered in the review form (no need to answer the five items again)
    expect(missingQuestions(s.answers!, { requireScoffItems: typeof s.answers!.scoffRisk !== 'boolean' })).toEqual([]);
  });

  it('the mode summary follows the fasting opt-in (QA 12)', () => {
    const base = { optInTiers: ['T2', 'T3'] as string[] };
    expect(modeSummary('standard', { ...base, maxFastHours: 24 })).toMatch(/fasts up to 24 hours; longer fasts need your opt-in/);
    expect(modeSummary('standard', { ...base, maxFastHours: 72 })).toMatch(/fasts up to 72 hours, as you chose in Settings › Safety/);
    expect(modeSummary('standard', { ...base, maxFastHours: 72 })).not.toMatch(/24 hours/);
    expect(modeSummary('standard', { optInTiers: [], maxFastHours: 24 })).toMatch(/your answers keep longer fasts out of plans/);
    expect(modeSummary('gentle', { ...base, maxFastHours: 12 })).toMatch(/no fasting over 12 hours/);
  });

  it('a newer disclaimer version sends the user back to consent', () => {
    act(() => seedClearedSafety(STANDARD_ANSWERS, AT));
    const s = useSafetyStore.getState();
    expect(gateStatus(s, AT)).toEqual({ status: 'ready' });
    expect(gateStatus(s, AT, ACK_VERSIONS.disclaimer + 1)).toEqual({ status: 'needs-consent', updated: true });
  });

  it('useSafetyAccess re-prompts the clinician-first acknowledgement and records the current version', () => {
    act(() => seedClearedSafety({ ...STANDARD_ANSWERS, symptoms: 'yes' }, AT));
    const { result } = renderHook(() => useSafetyAccess());
    expect(result.current.ready).toBe(true);
    expect(result.current.plannerAccess).toBe('restricted');
    expect(result.current.pendingAcknowledgements).toEqual(['clinician-first']);
    act(() => result.current.acknowledge('clinician-first'));
    expect(result.current.pendingAcknowledgements).toEqual([]);
    expect(useSafetyStore.getState().acknowledgements['clinician-first']?.version).toBe(ACK_VERSIONS['clinician-first']);
    act(() => useSafetyStore.getState().acknowledge('clinician-first', 0, AT));
    expect(result.current.pendingAcknowledgements).toEqual(['clinician-first']);
  });

  it('access stays blocked until the gate is ready', () => {
    const { result } = renderHook(() => useSafetyAccess());
    expect(result.current.gate).toEqual({ status: 'first-run' });
    expect(result.current.simulatorAccess).toBe('blocked');
    expect(result.current.plannerAccess).toBe('blocked');
    expect(result.current.plannerLocks).toEqual([]);
  });
});
