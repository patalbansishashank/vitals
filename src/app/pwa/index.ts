import { registerSW } from 'virtual:pwa-register';
import { startInstallDetection } from './install';
import { startPwa } from './controller';

/**
 * Start the installable-app and offline machinery. Called once from src/main.tsx. Both parts must start at
 * boot, not when Settings opens: the browser fires `beforeinstallprompt` early, and the worker registers on load.
 */
export function initPwa(): void {
  startInstallDetection();
  startPwa({ registerSW, enabled: import.meta.env.PROD });
}
