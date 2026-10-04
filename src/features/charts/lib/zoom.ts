/* ==========================================================================
   Zoom / pan model — a pure reducer over the visible window [x0, x1] in days.
   months → weeks → days → hours; presets whole · 4 wk · 1 wk · day.
   ========================================================================== */
import { clamp } from './time';

export interface ZoomState {
  days: number;
  x0: number;
  x1: number;
  /** Smallest allowed span in days (default 12 h). */
  minSpan: number;
}

export type ZoomPreset = 'all' | 28 | 7 | 1;
export const ZOOM_PRESETS: readonly ZoomPreset[] = ['all', 28, 7, 1];

export type ZoomAction =
  | { type: 'preset'; preset: ZoomPreset; centre?: number }
  | { type: 'zoomAt'; factor: number; anchor: number }
  | { type: 'pan'; delta: number }
  | { type: 'panWindow'; dir: -1 | 1 }
  | { type: 'brush'; a: number; b: number }
  | { type: 'set'; x0: number; x1: number }
  | { type: 'step'; dir: 1 | -1; centre?: number }
  | { type: 'reset' }
  | { type: 'days'; days: number };

export function initialZoom(days: number, minSpan = 0.5): ZoomState {
  return { days, x0: 0, x1: days, minSpan };
}

/** Clamp a window into [0, days] keeping its span (shrinking only if it exceeds the horizon). */
export function clampWindow(x0: number, x1: number, days: number, minSpan: number): [number, number] {
  let span = clamp(x1 - x0, Math.min(minSpan, days), days);
  if (!Number.isFinite(span)) span = days;
  let a = x0;
  if (a < 0) a = 0;
  if (a + span > days) a = days - span;
  return [a, a + span];
}

function presetSpan(p: ZoomPreset, days: number): number {
  return p === 'all' ? days : Math.min(p, days);
}

function windowFor(p: ZoomPreset, centre: number, days: number): [number, number] {
  const span = presetSpan(p, days);
  if (span >= days) return [0, days];
  let x0: number;
  if (p === 1) x0 = Math.floor(centre);
  else if (p === 7) x0 = Math.floor(centre / 7) * 7;
  else x0 = Math.round(centre - span / 2);
  return [x0, x0 + span];
}

export function zoomReducer(s: ZoomState, a: ZoomAction): ZoomState {
  const span = s.x1 - s.x0;
  const centre = (s.x0 + s.x1) / 2;
  let next: [number, number];
  switch (a.type) {
    case 'preset':
      next = windowFor(a.preset, a.centre ?? centre, s.days);
      break;
    case 'zoomAt': {
      const newSpan = clamp(span * a.factor, Math.min(s.minSpan, s.days), s.days);
      const anchor = clamp(a.anchor, s.x0, s.x1);
      const x0 = anchor - (anchor - s.x0) * (newSpan / (span || 1));
      next = [x0, x0 + newSpan];
      break;
    }
    case 'pan':
      next = [s.x0 + a.delta, s.x1 + a.delta];
      break;
    case 'panWindow':
      next = [s.x0 + a.dir * span, s.x1 + a.dir * span];
      break;
    case 'brush': {
      let x0 = Math.min(a.a, a.b);
      let x1 = Math.max(a.a, a.b);
      if (x1 - x0 < s.minSpan) {
        const c = (x0 + x1) / 2;
        x0 = c - s.minSpan / 2;
        x1 = c + s.minSpan / 2;
      }
      next = [x0, x1];
      break;
    }
    case 'set':
      next = [a.x0, a.x1];
      break;
    case 'step': {
      const c = a.centre ?? centre;
      const spans = ZOOM_PRESETS.map((p) => presetSpan(p, s.days));
      if (a.dir > 0) {
        const target = ZOOM_PRESETS.find((_, i) => spans[i]! < span - 1e-6);
        next = target ? windowFor(target, c, s.days) : [s.x0, s.x1];
      } else {
        const idx = [...spans].reverse().findIndex((sp) => sp > span + 1e-6);
        const target = idx < 0 ? 'all' : ZOOM_PRESETS[ZOOM_PRESETS.length - 1 - idx]!;
        next = windowFor(target, c, s.days);
      }
      break;
    }
    case 'reset':
      next = [0, s.days];
      break;
    case 'days':
      return initialZoom(a.days, s.minSpan);
  }
  const [x0, x1] = clampWindow(next[0], next[1], s.days, s.minSpan);
  if (x0 === s.x0 && x1 === s.x1) return s;
  return { ...s, x0, x1 };
}

/** The preset whose span matches the window, if any. */
export function activePreset(s: ZoomState): ZoomPreset | null {
  const span = s.x1 - s.x0;
  for (const p of ZOOM_PRESETS) if (Math.abs(presetSpan(p, s.days) - span) < 1e-6) return p;
  return null;
}

export const isZoomed = (s: ZoomState): boolean => s.x1 - s.x0 < s.days - 1e-6;

export function presetLabel(p: ZoomPreset, days: number): string {
  if (p === 'all') {
    const wk = Math.round(days / 7);
    return days % 7 === 0 || days > 60 ? `${wk} wk` : `${days} d`;
  }
  return p === 28 ? '4 wk' : p === 7 ? '1 wk' : 'day';
}
