/**
 * What the shell says about the widgets, as the web app needs it (r071): which are placed, which snapshot revision the
 * shell reads, and the person's weight opt-in. Light on purpose (no data hooks): the feed and Settings › Widgets both read it.
 */
import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/state/settingsStore';
import { widgetStatus, WIDGET_CONTRACT, type WidgetStatus } from '@/platform/widgets';

/** The widget cards (the keys of `status().byCard`) a part of the feed serves. */
export const FEED_CARDS = {
  /** Energy and steps: Today (the three rings), Energy and Steps (and, for an older shell, the week's Heart Points). */
  activity: ['today', 'energy', 'steps'],
  sleep: ['today', 'sleep'],
  ring: ['ring'],
  weight: ['weight'],
} as const;

/** Which widgets are placed, as the feed needs it: null while the shell has not answered yet. */
export interface Placement {
  /** Is any widget of these cards placed (an older shell that did not say counts as placed). */
  wants(cards: readonly string[]): boolean;
  /** Can the shell draw the new pictures, and is a widget that draws one of `card` placed. */
  pictures(card: string): boolean;
  /**
   * Does the shell still draw the first revision's widgets (an app older than r071 on this bundle)? Those show the week's
   * Heart Points and a "Synced" line, which the new widgets do not, so the feed reads and sends them for such a shell only.
   */
  legacy: boolean;
}

/** A shell's answer as the feed reads it. Pure (tests). */
export function placementOf(s: WidgetStatus): Placement {
  const anyPlaced = s.placed === null || s.placed > 0;
  const known = Object.keys(s.byCard).length > 0;
  return {
    wants: (cards) => (known ? cards.some((c) => (s.byCard[c] ?? 0) > 0) : anyPlaced),
    pictures: (card) => s.contract >= WIDGET_CONTRACT && (s.byCard[card] ?? 0) > 0,
    legacy: s.contract < WIDGET_CONTRACT,
  };
}

/**
 * What the shell says it has placed, asked at start and again whenever the app comes to the front (a widget is placed
 * from the launcher, so the app is in the background then). undefined until the first answer.
 */
export function useWidgetStatus(): WidgetStatus | undefined {
  const [status, setStatus] = useState<WidgetStatus | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const ask = () =>
      void widgetStatus().then((s) => {
        if (alive && s) setStatus(s);
      });
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return status;
}

/** "Show weight on the home screen" (Settings › Widgets, a device setting): a missing key is off. */
export function useWidgetWeightAllowed(): boolean {
  return useSettingsStore((s) => s.widgetWeight === true);
}

