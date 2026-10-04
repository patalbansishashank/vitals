/**
 * Dev builds only: when `window.__VITALS_PAGES_FIXTURE__` names a fixture (the screenshot harness sets it before the
 * app loads), load ./devFixtureLoad, which installs the fixture ring service and signals source, then render the page.
 * In a production build `import.meta.env.DEV` is false, the branch and its dynamic import are dropped.
 */
import { lazy, Suspense, type ReactNode } from 'react';

const Loader = import.meta.env.DEV ? lazy(() => import('./devFixtureLoad')) : null;

export function DevFixtureGate({ children }: { children: ReactNode }) {
  if (import.meta.env.DEV && Loader && typeof window !== 'undefined' && window.__VITALS_PAGES_FIXTURE__) {
    return (
      <Suspense fallback={null}>
        <Loader>{children}</Loader>
      </Suspense>
    );
  }
  return <>{children}</>;
}
