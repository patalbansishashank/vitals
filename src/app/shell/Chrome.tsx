import type { MouseEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import { Icon } from '@/components/icons/Icon';
import { IconKey, IconKeyLink } from '@/components/Key';
import * as Glyphs from '@/components/icons/glyphs';
import { Menu } from '@/components/Menu';
import { RingMark } from '@/components/brand/RingMark';
import { useSettingsStore } from '@/state/settingsStore';
import { resolveTheme, toggleTheme } from '../theme';
import { COACH_ITEM, EVIDENCE_ITEM, SETTINGS_ITEM, useNavBadges, type NavItem } from './nav';
import { backToToday, enterPlanningTools, PlanDayReadout, useShellNav } from './modeNav';
import type { MobileHeader } from './ShellContext';
import './modeNav.css';

/** Lowercase "vitals" wordmark with the yellow indicator dot. */
export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="lm-wordmark" aria-label="Vitals, home">
      <RingMark />
      <span aria-hidden="true">vitals</span>
    </Link>
  );
}

function ThemeKey() {
  const theme = useSettingsStore((s) => s.theme);
  const next = resolveTheme(theme) === 'dark' ? 'light' : 'dark';
  return <IconKey icon={Glyphs.ThemeGlyph} label={`Switch to ${next} theme`} onClick={toggleTheme} />;
}

const BADGE_LABEL: Partial<Record<NavItem['id'], string>> = { coach: 'a proposal is waiting' };

function NavKey({ item, badge, onClick, fade }: { item: NavItem; badge?: boolean; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void; fade?: boolean }) {
  return (
    <NavLink to={item.to} className="lm-navkey" onClick={onClick} data-fade={fade || undefined}>
      <Icon icon={item.icon} size={20} />
      <span>{item.label}</span>
      {badge ? <span className="lm-navkey__stale" role="img" aria-label={BADGE_LABEL[item.id] ?? 'results out of date'} /> : null}
    </NavLink>
  );
}

/** Click handlers for the keys that do more than navigate (return key, planning tools). */
function useNavClick() {
  const navigate = useNavigate();
  return (item: NavItem, override: boolean) => {
    if (item.id === 'planning')
      return (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        enterPlanningTools(navigate);
      };
    if (item.id === 'today' && override)
      return (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        backToToday(navigate);
      };
    return undefined;
  };
}

/**
 * Desktop navigation rail (≥ 1024 px): wordmark (+ the plan-day readout while a plan runs), the mode's destination
 * keys, the lower group (Living: evidence · planning), settings, theme. Planning mode keeps the Coach as a key above
 * settings (IA §3.4 rule 5).
 */
export function NavRail() {
  const badges = useNavBadges((s) => s.badges);
  const nav = useShellNav();
  const click = useNavClick();
  const fadeKey = `${nav.mode}${nav.override ? '-o' : ''}`;
  return (
    <nav className="lm-rail" aria-label="Main">
      <Link to="/" className="lm-rail__brand" aria-label="Vitals, home">
        <RingMark />
        <span aria-hidden="true">vitals</span>
      </Link>
      {nav.plan ? <PlanDayReadout plan={nav.plan} /> : null}
      {nav.primary.map((d) => (
        <NavKey key={`${fadeKey}:${d.id}`} item={d} badge={badges[d.id as keyof typeof badges]} onClick={click(d, nav.override)} fade />
      ))}
      {nav.lower.length ? <span className="lm-rail__rule" aria-hidden="true" /> : null}
      {nav.lower.map((d) => (
        <NavKey key={`${fadeKey}:${d.id}`} item={d} onClick={click(d, nav.override)} fade />
      ))}
      <div className="lm-rail__grow" />
      {nav.mode === 'planning' ? <NavKey item={COACH_ITEM} badge={badges.coach} /> : null}
      <NavKey item={SETTINGS_ITEM} />
      <ThemeKey />
    </nav>
  );
}

/** Mobile bottom tab bar (< 1024 px): the mode's keys (4 in Planning, 5 in Living and in the override), yellow dot above the current icon. */
export function TabBar() {
  const badges = useNavBadges((s) => s.badges);
  const nav = useShellNav();
  const click = useNavClick();
  const fadeKey = `${nav.mode}${nav.override ? '-o' : ''}`;
  return (
    <nav className="lm-tabbar" aria-label="Main" style={nav.primary.length !== 4 ? { gridTemplateColumns: `repeat(${nav.primary.length}, 1fr)` } : undefined}>
      {nav.primary.map((d) => (
        <NavKey key={`${fadeKey}:${d.id}`} item={d} badge={badges[d.id as keyof typeof badges]} onClick={click(d, nav.override)} fade />
      ))}
    </nav>
  );
}

/** Living mode's overflow ⋯ (mobile): Evidence · Planning tools · Settings · Theme (IA §3.5). */
function LivingOverflow() {
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const next = resolveTheme(theme) === 'dark' ? 'light' : 'dark';
  return (
    <Menu
      label="More"
      trigger={(tp) => <IconKey {...tp} icon={Ellipsis} label="More" />}
      items={[
        { id: 'evidence', label: 'Evidence', icon: EVIDENCE_ITEM.icon, onSelect: () => navigate(EVIDENCE_ITEM.to) },
        { id: 'planning', label: 'Planning tools', icon: Glyphs.RouteGlyph, onSelect: () => enterPlanningTools(navigate) },
        { id: 'settings', label: 'Settings', icon: SETTINGS_ITEM.icon, onSelect: () => navigate(SETTINGS_ITEM.to) },
        { id: 'theme', label: `Switch to ${next} theme`, icon: Glyphs.ThemeGlyph, onSelect: toggleTheme, separatorBefore: true },
      ]}
    />
  );
}

/** Mobile top bar: wordmark (or back chevron / compact title on nested screens) · Coach (Planning) · theme · settings — or the overflow ⋯ in Living mode. */
export function MobileTopBar({ header }: { header: MobileHeader | null }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nav = useShellNav();
  const badges = useNavBadges((s) => s.badges);
  const onSettings = pathname.startsWith('/settings');
  const onCoach = pathname.startsWith('/coach');
  const back = header?.back ?? null;
  const title = header?.title ?? null;
  const goBack = () => (back?.to ? navigate(back.to) : window.history.length > 1 ? navigate(-1) : navigate('/'));
  return (
    <header className="lm-topbar" data-back={back ? 'true' : undefined}>
      {back && title ? (
        <IconKey icon={ChevronLeft} label={back.label ? `Back to ${back.label}` : 'Back'} onClick={goBack} />
      ) : back ? (
        <button type="button" className="lm-topbar__back" onClick={goBack}>
          <Icon icon={ChevronLeft} size={20} />
          <span>{back.label ?? 'Back'}</span>
        </button>
      ) : title ? null : (
        <Wordmark />
      )}
      {title ? (
        <span className="lm-topbar__title" aria-hidden="true">
          {title}
        </span>
      ) : null}
      <div className="lm-topbar__spacer" />
      {nav.mode === 'living' ? (
        <LivingOverflow />
      ) : (
        <>
          {onCoach ? null : (
            <span className="lm-topbar__coach">
              <IconKeyLink to={COACH_ITEM.to} icon={COACH_ITEM.icon} label={badges.coach ? 'Coach, a proposal is waiting' : 'Coach'} />
            </span>
          )}
          <ThemeKey />
          {onSettings ? null : <IconKeyLink to="/settings" icon={Glyphs.SlidersGlyph} label="Settings" />}
        </>
      )}
    </header>
  );
}
