import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router';
import { Compass } from 'lucide-react';
import { Icon } from '@/components/icons/Icon';
import { Key, KeyLink } from '@/components/Key';
import { Page } from '@/components/Layout';
import { TODAY_PATH } from './nav';
import { TopBar } from './TopBar';

/**
 * Suspense fallback while a lazy screen loads: the shape of a screen in static card blocks (no spinner, no shimmer).
 * Announced once as "Loading screen"; it holds no heading, so focus waits for the real screen's title.
 */
export function PageFallback() {
  return (
    <div className="lm-route-skel" role="status" aria-busy="true">
      <span className="lm-sr">Loading screen</span>
      <span className="lm-route-skel__block" data-size="s" aria-hidden="true" />
      <span className="lm-route-skel__block" aria-hidden="true" />
      <span className="lm-route-skel__block" aria-hidden="true" />
    </div>
  );
}

/**
 * The one way out of a dead end: Today, home in every mode (0.6.3); Your body when Today itself is what failed, so the
 * way out never leads back into the error.
 */
function useHome(): { to: string; label: string } {
  const { pathname } = useLocation();
  return pathname === TODAY_PATH || pathname.startsWith(`${TODAY_PATH}/`) ? { to: '/body', label: 'Go to Your body' } : { to: TODAY_PATH, label: 'Go to Today' };
}

/** `*` — a small empty state centred in the content area: what happened, the path asked for, one way home. */
export function NotFound() {
  const home = useHome();
  const { pathname } = useLocation();
  return (
    <>
      <TopBar title="Not found" />
      <Page>
        <div className="lm-route-state" data-center="">
          <Icon icon={Compass} size={32} strokeWidth={1.25} className="lm-route-state__icon" />
          <h2 className="lm-route-state__h">This page doesn't exist.</h2>
          <p className="lm-route-state__path">{pathname}</p>
          <KeyLink to={home.to} variant="solid">
            {home.label}
          </KeyLink>
        </div>
      </Page>
    </>
  );
}

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Error boundary for a screen: the shell (header, navigation) keeps working. */
export function RouteError() {
  const error = useRouteError();
  const home = useHome();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const chunk = error instanceof Error && /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);
  return (
    <>
      <TopBar title="Something went wrong" />
      <Page>
        <div className="lm-route-state">
          <p className="lm-route-state__line">
            {chunk ? 'Vitals was updated while this tab was open. Reload to get the new version.' : 'This screen stopped working.'}
          </p>
          <div className="lm-route-state__keys">
            <Key variant="solid" onClick={() => window.location.reload()}>
              Reload
            </Key>
            <KeyLink to={home.to}>{home.label}</KeyLink>
          </div>
          <details className="lm-route-state__details">
            <summary>Technical details</summary>
            <pre>{describe(error)}</pre>
          </details>
        </div>
      </Page>
    </>
  );
}

/** Last-resort boundary if the shell itself fails: no navigation, just a way out. */
export function RootError() {
  const error = useRouteError();
  return (
    <main className="lm-page lm-route-root">
      <div className="lm-route-state">
        <h1 className="lm-route-state__title">Vitals stopped working.</h1>
        <p className="lm-route-state__line">Your data is safe on this device. Reload to try again.</p>
        <div className="lm-route-state__keys">
          <Key variant="solid" onClick={() => window.location.assign('/')}>
            Reload Vitals
          </Key>
        </div>
        <details className="lm-route-state__details">
          <summary>Technical details</summary>
          <pre>{describe(error)}</pre>
        </details>
      </div>
    </main>
  );
}
