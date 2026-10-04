// Order matters: the QA flag reads the query before the router can redirect; then the theme (sets <html data-theme /
// data-motion> before the first render).
import { qaEnabled } from '@/app/qaFlag';
import { initTheme } from '@/app/theme';
// The stylesheet entry must load before any component CSS: its `@layer` order (theme, base, components, utilities)
// is fixed by the first layer a stylesheet names, and the shell's CSS (imported through App) names `components`.
import '@/styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { APP_VERSION } from '@/app/version';
import { initPwa } from '@/app/pwa';
import { detectPlatform } from '@/platform/detect';
import { setAppVersion } from '@/state/persistence';

initTheme();
setAppVersion(APP_VERSION);
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The Android app (SUITE_SPEC §15.7): files shared in and saved out, the foreground service and ring alerts that follow
// the ring service, and no service worker. Nothing is loaded for this elsewhere.
if (detectPlatform() === 'android')
  void Promise.all([import('@/platform/androidBoot'), import('@/biometrics/service')]).then(([m, s]) => m.installAndroidShell({ ringService: s.getRingService() }));

// Sync is off until the user pairs; this chunk only checks the device vault and, when paired, loads the engine.
void import('@/state/sync').then((m) => m.initSync());

// QA journeys (plan 02 item 12) read state through the command bus; only with `?qa=1`, read commands only.
if (qaEnabled) void import('@/commands/qaHook').then((m) => m.installQaHook());
