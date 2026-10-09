// The one-time hint for the 3D figure's mouse controls. Shown the first time a desktop pointer meets the figure, then
// remembered on this device (never synced: the key does not start with "vitals."). Storage may be blocked, so every
// access is guarded; without it the hint shows once per page load.

export const VIEW_HINT = 'Drag to turn · right-drag to move · scroll to zoom';

const KEY = 'vitals-figure-view-hint';
let shown = false;

/** True once, on a device with a fine pointer that has not seen the hint yet; records that it is being shown. */
export function takeViewHint(): boolean {
  if (shown || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (!window.matchMedia('(pointer: fine)').matches) return false;
  try {
    if (localStorage.getItem(KEY)) return false;
  } catch {
    // storage blocked: the page-load flag below still stops a repeat
  }
  shown = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage blocked or full
  }
  return true;
}

/** Forgets that the hint was shown (tests). */
export function forgetViewHint(): void {
  shown = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}
