import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CoachRuntimeProvider } from '@/ai/coach/CoachRuntimeProvider';
import { installDocumentPlanSource } from '@/features/living/mode';
import { LaunchScreen } from '@/components/brand/LaunchScreen';
import { installNavigatePort } from './navPort';
import { startStoragePersistence } from './persistStorage';
import { routes } from './routes';

/**
 * The router of the running app. The mode comes from the plan documents (`installDocumentPlanSource`), before anything
 * renders; the Living screens then read the same documents and write through the commands (features/living/boot.ts).
 */
function createAppRouter() {
  installDocumentPlanSource();
  return createBrowserRouter(routes);
}

/** The application: a data router (enables ScrollRestoration) over the route table in ./routes, under the Coach runtime. */
export function App() {
  const [router] = useState(createAppRouter);
  // `nav.open` (Coach, agents) opens screens through this router
  useEffect(() => installNavigatePort(router), [router]);
  // ask the browser to keep the data when space runs low, at a sensible moment (./persistStorage)
  useEffect(() => startStoragePersistence(), []);
  return (
    <LaunchScreen>
      <CoachRuntimeProvider>
        <RouterProvider router={router} />
      </CoachRuntimeProvider>
    </LaunchScreen>
  );
}

export { routes };
