/**
 * Settings › Widgets (r071, Android app only): which widgets are on the home screen, a key to ask the launcher for each,
 * and "Show weight on the home screen", off until the person turns it on (weight is the one figure that never reaches a
 * home screen unasked). The section is registered in Settings by the settings package (`settings/sections.tsx`); this is
 * its body.
 *
 * Each widget is a row: its icon in its domain hue, its name, a state (a mark and a word: the gold dot is "on your home
 * screen", the hollow ring is not) and one Add key. What the key just did ("Confirm on your home screen", or where to
 * find the widget when the launcher cannot be asked) is a sentence under the name until the shell's count moves.
 */
import { useState, type ReactNode } from 'react';
import { CirclePlus, Flame, Footprints, HeartPulse, Moon, Scale, Sun } from 'lucide-react';
import { Icon, Key, MonoMeta, StatusDot, Switch, domainColor, type DomainName, type IconComponent } from '@/components';
import { sendCommand } from '@/features/lib/sendCommand';
import { SettingRow, SettingsGroup, useSavedFlash } from '@/features/settings/SettingRow';
import { SettingsSection } from '@/features/settings/sections';
import { requestPinWidget, type WidgetStatus } from '@/platform/widgets';
import { cardName, WIDGET_CARDS, type WidgetCard } from './cards';
import { useWidgetStatus, useWidgetWeightAllowed } from './status';

/** Where a widget is found when the launcher cannot be asked to place it. */
export const FIND_WIDGET = (c: WidgetCard) => `Touch and hold the home screen, choose Widgets, then ${c.label}.`;

/** What a card's row says: what its key just did, else how many are placed, else (an opt-in card) whether it is switched on. */
export function rowHelp(c: WidgetCard, status: WidgetStatus | undefined, said: string | undefined, optedIn = true): string {
  if (said) return said;
  const n = status?.byCard[c.id] ?? 0;
  if (n > 0) return n === 1 ? 'On your home screen' : `${n} on your home screen`;
  return c.optIn && !optedIn ? 'Off until you turn on weight below' : 'Not on your home screen';
}

/** The icon each widget wears in its row (the registry's icons: flame, moon, footprints, heart, scale; the day's own sun, the keys' plus). */
const ICON: Record<string, IconComponent> = { today: Sun, ring: HeartPulse, actions: CirclePlus, log: CirclePlus, energy: Flame, sleep: Moon, steps: Footprints, weight: Scale };
/** The registry names the plan's colour "gold"; the domain palette calls it `plan`. */
const hueOf = (c: WidgetCard): DomainName => (c.hue === 'gold' ? 'plan' : (c.hue as DomainName));

function WidgetName({ c }: { c: WidgetCard }): ReactNode {
  return (
    <span className="settings-widget">
      <Icon icon={ICON[c.id] ?? Sun} size={20} className="settings-widget__icon" style={{ color: domainColor(hueOf(c)) }} />
      {cardName(c)}
    </span>
  );
}

export function WidgetsSettings() {
  const [saved, flash] = useSavedFlash();
  const status = useWidgetStatus();
  const weight = useWidgetWeightAllowed();
  // what a card's key just did, kept until the shell's count of that card moves (then the row says how many are placed)
  const [said, setSaid] = useState<Record<string, { text: string; count: number }>>({});

  const pin = async (c: WidgetCard) => {
    const r = await requestPinWidget(c.id);
    setSaid((s) => ({ ...s, [c.id]: { text: r.supported && r.requested ? 'Confirm on your home screen' : FIND_WIDGET(c), count: status?.byCard[c.id] ?? 0 } }));
  };
  const saidFor = (c: WidgetCard): string | undefined => {
    const x = said[c.id];
    return x && x.count === (status?.byCard[c.id] ?? 0) ? x.text : undefined;
  };
  // `widgetWeight` is a device setting (this phone only); "Saved" shows in the header once it went through
  const setWeight = (on: boolean) => void sendCommand('settings.update', { patch: { widgetWeight: on } }).then((r) => r.ok && flash());

  const placed = status?.placed ?? null;
  return (
    <SettingsSection id="widgets" title="Widgets" saved={saved}>
      <SettingsGroup
        label="On your home screen"
        aside={placed !== null ? <MonoMeta>{`${placed} placed`}</MonoMeta> : undefined}
        info={{
          title: 'Widgets',
          body: 'A widget puts one card from Vitals on your home screen: Today, Energy, Sleep, Steps and more. Widgets refresh while the app runs and every ten minutes after. In quiet mode they show words, never digits. Tap one to open its page.',
          source: { kind: 'engine', words: 'Vitals sends your launcher a small summary of the day; nothing leaves your phone.' },
        }}
      >
        {WIDGET_CARDS.map((c) => {
          const text = saidFor(c);
          const n = status?.byCard[c.id] ?? 0;
          return (
            <SettingRow
              key={c.id}
              label={<WidgetName c={c} />}
              help={text ? text : <StatusDot tone={n > 0 ? 'live' : 'neutral'} label={rowHelp(c, status, undefined, weight)} />}
            >
              {() => (
                <Key variant="outlined" size="sm" onClick={() => void pin(c)} aria-label={`Add ${cardName(c)} to your home screen`}>
                  Add
                </Key>
              )}
            </SettingRow>
          );
        })}
      </SettingsGroup>
      <SettingsGroup label="Privacy">
        <SettingRow
          label="Show weight on the home screen"
          help={weight ? 'On · quiet mode shows a word, never the number' : 'Off · your weight stays in the app'}
          info={{
            title: 'Weight on the home screen',
            body: 'Your weight never reaches the home screen unless you turn this on, and only on this phone. Anyone who can see your home screen could read it. In quiet mode the widget shows a word, never the number.',
          }}
        >
          {({ labelId, helpId }) => <Switch checked={weight} labelledBy={labelId} describedBy={helpId} onChange={setWeight} />}
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

export default WidgetsSettings;
