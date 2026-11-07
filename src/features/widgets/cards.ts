/**
 * The widgets as the registry (design/widgets.json) describes them, typed for the web side: Settings › Widgets lists them
 * and the feed asks for them by these ids.
 */
import registry from '../../../design/widgets.json';

export interface WidgetCard {
  /** The id `status().byCard` and the feed use (`energy`). */
  id: string;
  /** The Android provider class (a placed widget is held by this name: it never changes). */
  provider: string;
  /** The picker's label ("Vitals · Energy"). */
  label: string;
  kind: 'card' | 'trio' | 'keys' | 'key';
  hue: string;
  /** Launcher cells, wide by tall. */
  cells: [number, number];
  /** The screen a tap opens (a key of `registry.targets`). */
  tap: string;
  /** Off until the person turns it on (weight). */
  optIn?: boolean;
}

export const WIDGET_CARDS: readonly WidgetCard[] = registry.widgets as unknown as WidgetCard[];

/** "Energy": the label without the picker's "Vitals · ". */
export const cardName = (c: Pick<WidgetCard, 'label'>): string => c.label.replace(/^Vitals\s·\s/, '');
