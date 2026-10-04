/*
 * Page visibility in the Android app (SUITE_SPEC §15.7), owned by L-ANDROID. While the ring service runs, the native
 * RingWebView tells Chromium its window is visible even with the screen off (otherwise Chromium stops this page's JS
 * and the ring is not read in the background). So `document.visibilityState` would say "visible" all night, and
 * everything that pauses off screen (live heart rate on the Ring page, the sync and planner timers) would keep going.
 * This makes the page's visibility follow the real window: hidden when the native `screen` event says so, and the
 * usual `visibilitychange` event when that changes. Nothing on the web.
 */
import { getShellState, onScreenChange } from './androidShell';

type Visibility = 'visible' | 'hidden';

export function installAndroidScreen(doc: Document | undefined = globalThis.document): () => void {
  if (!doc) return () => {};
  const proto = Object.getPrototypeOf(doc) as object;
  const real = Object.getOwnPropertyDescriptor(proto, 'visibilityState') ?? Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const chromium = (): Visibility => ((real?.get?.call(doc) as Visibility | undefined) ?? 'visible');
  let onScreen = true;
  // Both must say visible: Chromium's own view covers the service being off, the native event the screen being off.
  const state = (): Visibility => (onScreen && chromium() === 'visible' ? 'visible' : 'hidden');

  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: state });
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => state() === 'hidden' });

  const set = (next: boolean) => {
    if (next === onScreen) return;
    const before = state();
    onScreen = next;
    if (state() !== before) doc.dispatchEvent(new Event('visibilitychange'));
  };
  const off = onScreenChange(set);
  // A page loaded while the screen is off (a fresh WebView after the renderer was lost) starts from the native state.
  void getShellState()
    .then((s) => {
      if (s && typeof s.onScreen === 'boolean') set(s.onScreen);
    })
    .catch(() => undefined);

  return () => {
    off();
    delete (doc as { visibilityState?: unknown }).visibilityState;
    delete (doc as { hidden?: unknown }).hidden;
  };
}
