/** The flow context from the environment: region (examples, ₹, kitchen defaults), gentle mode, device answers. */
import { useMemo, useState } from 'react';
import { useSafetyStore } from '@/state/safetyStore';
import { useBodyContext } from '@/state/profileStore';
import { useSafetyAccess } from '@/features/onboarding';
import { hasStepDevice } from './chapters/devices';
import type { FlowContext } from './flow';
import type { SectionContext } from './sections';
import type { IntakeDoc } from './types';

/** India locale: a `-IN` language or the India time zone (pure over its inputs). */
export function isIndiaLocale(languages: readonly string[], timeZone: string | undefined): boolean {
  return languages.some((l) => /-IN$/i.test(l)) || timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta';
}

export function detectIndia(): boolean {
  try {
    const langs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
    return isIndiaLocale(langs.filter(Boolean), Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** Live flow context for the intake screens. */
export function useFlowContext(doc: IntakeDoc): SectionContext {
  const safetyAnswers = useSafetyStore((s) => s.answers);
  const access = useSafetyAccess(useBodyContext());
  const gentle = access.ready && access.outcome.restrictions.includes('R1');
  const stepDevice = hasStepDevice(doc.devices);
  const [india] = useState(detectIndia);
  return useMemo<SectionContext>(() => ({ india, gentle, stepDevice, safety: safetyAnswers, now: new Date().toISOString() }), [india, gentle, stepDevice, safetyAnswers]);
}

export const flowContextOf = (c: SectionContext): FlowContext => ({ india: c.india, gentle: c.gentle, stepDevice: c.stepDevice });
