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

export function simulatorProfileNow(nowIso?: string): PersonProfile {
  // E20: markers — entered blood results replace the population starting values (Body page labs stay the fallback)
  const profile = withMarkerLabs(buildPersonProfile(pickBodyValues(useProfileStore.getState())), readMarkersDoc(), appDay(nowIso ? new Date(nowIso) : new Date()));
  const access = safetyAccessNow(nowIso);
  const safety = engineSafety({ outcome: access.outcome, fasting: { optedTier: access.optedTier } } as Parameters<typeof engineSafety>[0]);
  return { ...profile, safety: JSON.parse(JSON.stringify(safety)) as PersonProfile['safety'] };
}
