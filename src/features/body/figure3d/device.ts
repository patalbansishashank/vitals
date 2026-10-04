// Session-wide renderer choice for the 3D figure (body-figure-v2.md §5.3), kept out of the lazy WebGL chunk so the
// wrapper can decide before loading it. Not persisted: a fresh session tries again.

let slow = false;
let detailedAsked = false;

/** A figure on this page found the device too slow (first 60 frames over 1/30 s of drawing work each). */
export function markSlowDevice(): void {
  slow = true;
}

export function isSlowDevice(): boolean {
  return slow;
}

/** The browser asks to save data (`navigator.connection.saveData`): the SVG figure until the person asks for 3D. */
export function saveDataPreferred(): boolean {
  if (detailedAsked || typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return c?.saveData === true;
}

/** "Load detailed figure": the person accepted the download for this session. */
export function askDetailedFigure(): void {
  detailedAsked = true;
}
