import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { Page, Stack } from '@/components/Layout';
import { MonoMeta } from '@/components/MonoMeta';
import { MQ, useMediaQuery } from '@/components/lib/hooks';
import { currentDay, useLivingClock } from '@/features/living/clock';
import { STRIP_COPY } from '@/features/living/copy';
import { planDayOf } from '@/features/living/mode';
import { SettingsGroup, SettingsLinkRow } from '@/features/settings/SettingRow';
import '@/features/settings/settings.css';
import { useShellNav } from './modeNav';
import { capitalise, TODAY_PATH, useNavBadges, type NavItem } from './nav';
import { TopBar } from './TopBar';

/** Row names where the lowercase accessible name reads oddly capitalised alone. */
const ROW_NAME: Partial<Record<NavItem['id'], string>> = { body: 'Your body', planDetails: 'Plan details' };

/**
 * More (r068 U14): the phone dock's fifth key, a real page instead of a dropdown. Every place the dock has no key for,
 * in labelled groups of 64 px rows (icon · name · a fact when there is one · chevron), Settings last. It works like a
 * phone's own "More" / "You" tab. On desktop the sidebar lists the same places, so nothing links here there, and a deep
 * link (or a window widened past 1024 px while on More) goes to Today rather than draw a second copy of the sidebar.
 */
export function MorePage() {
  const wide = useMediaQuery(MQ.lg);
  if (wide) return <Navigate to={TODAY_PATH} replace />;
  return <MoreList />;
}

function MoreList() {
  const nav = useShellNav();
  const coachWaiting = useNavBadges((s) => !!s.badges.coach);
  const today = currentDay(useLivingClock());
  const value = (item: NavItem): ReactNode => {
    if (item.id === 'coach' && coachWaiting)
      return (
        <MonoMeta>
          Proposal waiting
          <span className="settings-row__dot" aria-hidden="true" />
        </MonoMeta>
      );
    if (item.id === 'planDetails' && nav.plan) {
      const { day, of } = planDayOf(nav.plan, today);
      return day >= 1 ? <MonoMeta>{capitalise(STRIP_COPY.dayOf(Math.min(day, of), of))}</MonoMeta> : null;
    }
    return null;
  };
  return (
    <>
      <TopBar title="More" />
      <Page className="more-page">
        <Stack gap="page">
          {nav.more.map((g) => (
            <SettingsGroup key={g.id} label={g.label} icons>
              {g.items.map((item) => (
                <SettingsLinkRow
                  key={item.id}
                  to={item.to}
                  icon={item.icon}
                  title={ROW_NAME[item.id] ?? capitalise(item.label)}
                  value={value(item)}
                />
              ))}
            </SettingsGroup>
          ))}
        </Stack>
      </Page>
    </>
  );
}

export default MorePage;
