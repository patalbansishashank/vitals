/**
 * The engine profile a Simulator run uses, computed headlessly from the stores — the same value
 * `useSimulatorProfile()` renders with (Your-body `PersonProfile` + the screening outcome as engine safety flags).
 * Commands use it so `sim.run` from the Coach, MCP or the UI runs exactly what the Simulator screen runs.
 */
import type { PersonProfile } from '@/engine';
import { buildPersonProfile } from '@/features/body/model';
import { engineSafety } from '@/features/simulator/profile';
import { useProfileStore } from '../profileStore';
import { pickBodyValues } from './profileModel';
import { safetyAccessNow } from './safety';
import { withMarkerLabs } from '@/markers/baselines'; // E20: markers
import { readMarkersDoc } from '@/markers/ui/useMarkers'; // E20: markers
import { appDay } from '@/living/appDay'; // E20: markers
import { markerRuleContext } from '@/markers/context';
import { readMarkerContextSources } from '@/markers/ui/contextSources';

export function simulatorProfileNow(nowIso?: string): PersonProfile {
  // E20: markers — entered blood results replace the population starting values (Body page labs stay the fallback)
  const body = buildPersonProfile(pickBodyValues(useProfileStore.getState()));
  const access = safetyAccessNow(nowIso);
  // D7-05: the marker rule context (diet and medication change dates), the same freshness the rules use
  const ctx = markerRuleContext({ profile: body, flags: access.outcome.flags, ...readMarkerContextSources() }, appDay(nowIso ? new Date(nowIso) : new Date()));
  const profile = withMarkerLabs(body, readMarkersDoc(), ctx);
  const safety = engineSafety({ outcome: access.outcome, fasting: { optedTier: access.optedTier } } as Parameters<typeof engineSafety>[0]);
  return { ...profile, safety: JSON.parse(JSON.stringify(safety)) as PersonProfile['safety'] };
}
