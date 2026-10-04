/**
 * "Start this plan" in the Simulator (IA §4.7: Simulator scenario → Start this plan → Start sheet; SUITE_SPEC §3.1): the
 * key, and the start sheet's scenario variant loaded on demand so the living start code stays out of the Simulator's
 * chunk until someone opens it. With a plan running the key reads "Replace active plan…" (the sheet then asks for the
 * typed word and dispatches `plan.replace`).
 */
import { lazy, Suspense, useState } from 'react';
import { Key } from '@/components';
import { START_COPY } from '../copy';
import { useActivePlan } from '../mode';
import type { ScenarioStartProps } from './StartPlanSheet';

const StartPlanSheet = lazy(() => import('./StartPlanSheet').then((m) => ({ default: m.StartPlanSheet })));

export function ScenarioStartEntry({ scenario, disabledReason, size }: ScenarioStartProps & { size?: 'sm' | 'md' | 'lg' }) {
  const [open, setOpen] = useState(false);
  const live = useActivePlan();
  return (
    <>
      <Key size={size} onClick={() => setOpen(true)} disabledReason={disabledReason}>
        {live ? START_COPY.replace : START_COPY.entry}
      </Key>
      {open ? (
        <Suspense fallback={null}>
          <StartPlanSheet scenario={scenario} disabledReason={disabledReason} open onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
