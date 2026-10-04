import { isRouteErrorResponse, useRouteError } from 'react-router';
import { EmptyStage } from '@/components/EmptyStage';
import { Faceplate } from '@/components/Faceplate';
import { Key, KeyLink } from '@/components/Key';
import { Notice } from '@/components/Notice';
import { Page } from '@/components/Layout';
import { ProgressRule } from '@/components/Progress';
import { TopBar } from './TopBar';

/** Suspense fallback while a lazy screen loads: a thin progress rule, no skeleton blocks. */
export function PageFallback() {
  return (
    <div className="lm-route-progress">
      <ProgressRule label="Loading screen" reducedText="" />
    </div>
  );
}

/** `*` — IA §2: "This page doesn't exist. Your data is safe." */
export function NotFound() {
  return (
    <>
      <TopBar title="Not found" />
      <Page>
        <EmptyStage
          title="This page doesn't exist."
          action={
            <KeyLink to="/simulate" variant="solid">
              Go to Simulate
            </KeyLink>
          }
        >
          Your data is safe — it stays on this device. Check the address, or pick a destination below.
        </EmptyStage>
      </Page>
    </>
  );
}

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Error boundary for a screen: the shell (navigation) keeps working. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const chunk = error instanceof Error && /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);
  return (
    <>
      <TopBar title="Something went wrong" />
      <Page width="narrow">
        <Faceplate as="div" className="grid gap-4">
          <Notice severity="danger" layout="ruled" title={chunk ? 'This screen could not be loaded.' : 'This screen stopped working.'}>
            <p>
              {chunk
                ? 'Vitals was probably updated while this tab was open. Reload to get the new version.'
                : 'This is our bug, not something you did. Your data is safe — it stays on this device.'}
            </p>
          </Notice>
          <details className="text-sm text-ink-2">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-sm bg-well p-3 font-mono text-xs text-ink">{describe(error)}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Key variant="solid" onClick={() => window.location.reload()}>
              Reload
            </Key>
            <KeyLink to="/body">Go to Your body</KeyLink>
          </div>
        </Faceplate>
      </Page>
    </>
  );
}

/** Last-resort boundary if the shell itself fails: no navigation, just a way out. */
export function RootError() {
  const error = useRouteError();
  return (
    <main className="lm-page" style={{ paddingTop: 48 }}>
      <Faceplate as="div" className="grid max-w-xl gap-4">
        <Notice severity="danger" layout="ruled" title="Vitals stopped working.">
          <p>This is our bug. Your data is safe on this device. Reload to try again.</p>
        </Notice>
        <pre className="overflow-auto whitespace-pre-wrap rounded-sm bg-well p-3 font-mono text-xs">{describe(error)}</pre>
        <div>
          <Key variant="solid" onClick={() => window.location.assign('/')}>
            Reload Vitals
          </Key>
        </div>
      </Faceplate>
    </main>
  );
}
