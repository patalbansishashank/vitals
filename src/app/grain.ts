/**
 * The grain tiles are drawn at one image pixel per device pixel at any screen scale: fractional scaling (125%, 175%)
 * and browser zoom fall between the stylesheet's resolution steps (tokens.css), where a stretched tile goes soft or
 * blocky. Every tile (raw, backdrop, card, sidebar) is the same 512 px field. Sets `--lm-grain-size` from the live
 * devicePixelRatio and follows it when the window moves to another screen or the zoom changes.
 */
export const GRAIN_TILE_PX = 512;

export function initGrainScale(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const root = document.documentElement;
  const apply = () => {
    const dpr = window.devicePixelRatio || 1;
    root.style.setProperty('--lm-grain-size', `${GRAIN_TILE_PX / dpr}px`);
    // a media query that stops matching as soon as the ratio changes: re-arm on the new one
    window.matchMedia(`(resolution: ${dpr}dppx)`).addEventListener('change', apply, { once: true });
  };
  apply();
}
