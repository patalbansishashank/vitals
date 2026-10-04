/**
 * Dev builds only (loaded by ./DevFixtureGate): installs the fixture named by `window.__VITALS_PAGES_FIXTURE__`
 * (`{ ring: RingScenario, signals: SignalsScenario }`) as the ring service and the signals source, at module load,
 * before the page below renders. Unknown names are ignored. Today and "now" are the browser's, so the fixture data
 * always ends now (the screenshot harness freezes the browser clock at FIXTURE_TODAY 14:30).
 */
import type { ReactNode } from 'react';
import { setDevRingFixture } from '@/features/ring/data';
import { createFakeRingService, createFakeSharing, RING_SCENARIOS, scenarioPlatform, type RingScenario } from '@/features/ring/fixtures';
import { localDateOf } from '@/features/living/clock';
import { setDevSignalsSource } from './data';
import { browserTzOffsetS, createFixtureSignalsSource, SIGNALS_SCENARIOS, type SignalsScenario } from './fixtures';

interface Named {
  ring?: string;
  signals?: string;
}

function install(): { ring: RingScenario | null; signals: SignalsScenario | null } {
  const named: Named | undefined = typeof window === 'undefined' ? undefined : window.__VITALS_PAGES_FIXTURE__;
  const ring = (RING_SCENARIOS as readonly string[]).includes(named?.ring ?? '') ? (named!.ring as RingScenario) : null;
  const signals = (SIGNALS_SCENARIOS as readonly string[]).includes(named?.signals ?? '') ? (named!.signals as SignalsScenario) : null;
  if (ring) setDevRingFixture({ service: createFakeRingService(ring), platform: scenarioPlatform(ring), sharing: createFakeSharing('on') });
  if (signals) setDevSignalsSource(createFixtureSignalsSource(signals, { today: localDateOf(new Date()), now: Date.now(), tzOffsetS: browserTzOffsetS }));
  // the screenshot harness reads this to tell "fixture installed" from "gate not mounted"
  if (typeof window !== 'undefined') Object.assign(window, { __VITALS_PAGES_FIXTURE_LOADED__: { ring, signals } });
  return { ring, signals };
}

install();

export default function DevFixtureLoad({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
