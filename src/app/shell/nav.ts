import { create } from 'zustand';
import { Activity, ChartSpline, ClipboardList, Flame, LayoutGrid, MessageSquareText, SunDim, Utensils } from 'lucide-react';
import type { IconComponent } from '@/components/icons/Icon';
import * as Glyphs from '@/components/icons/glyphs';

export type Destination = 'body' | 'simulate' | 'plan' | 'evidence';
/** Living-mode destinations (IA §3.5–§3.6). */
export type LivingDestination = 'today' | 'food' | 'train' | 'coach' | 'progress';

export interface NavItem {
  id: Destination | LivingDestination | 'settings' | 'ring' | 'energy' | 'more' | 'planDetails';
  to: string;
  /**
   * The key's accessible name. Kept lowercase, as these names have always been; where it is drawn (the dock's label,
   * the sidebar's row label, the More page's row) it is capitalised.
   */
  label: string;
  icon: IconComponent;
  /**
   * The paths this key stands for, when more than its own: the Planning dock's Plan key is current on all three
   * planning steps. Default: `to` and everything under it.
   */
  match?: RegExp;
}

/** A labelled group of the desktop sidebar or the phone's More page (r068 U14). No label: the first group. */
export interface NavGroup {
  id: 'main' | 'plan' | 'planning' | 'library' | 'app';
  label?: string;
  items: NavItem[];
}

/** The planning screens in journey order (IA §3): Your body → Simulate → Plan, then the Evidence library. */
export const DESTINATIONS: NavItem[] = [
  { id: 'body', to: '/body', label: 'body', icon: Glyphs.AvatarFront },
  { id: 'simulate', to: '/simulate', label: 'simulate', icon: Glyphs.Channels },
  { id: 'plan', to: '/plan', label: 'plan', icon: Glyphs.RouteGlyph, match: /^\/plan(?!\/active(?:\/|$))(?:\/|$)/ },
  { id: 'evidence', to: '/evidence', label: 'evidence', icon: Glyphs.BookGlyph },
];

export const SETTINGS_ITEM: NavItem = { id: 'settings', to: '/settings', label: 'settings', icon: Glyphs.SlidersGlyph };

/** Ring (Gauge's readings: sleep, activity, workouts, heart signals, scores): a dock key and a sidebar row in both modes. */
export const RING_ITEM: NavItem = { id: 'ring', to: '/ring', label: 'ring', icon: Activity };

/** (r069 D4) The day Energy page (what a day burned and when): a sidebar row after Ring and a More row, in both modes. */
export const ENERGY_ITEM: NavItem = { id: 'energy', to: '/energy', label: 'energy', icon: Flame };

/** Living mode: Today (home) · Food · Train · Coach · Progress (IA §3.5; full words, never abbreviated). */
export const LIVING_DESTINATIONS: NavItem[] = [
  { id: 'today', to: '/today', label: 'today', icon: SunDim },
  { id: 'food', to: '/food', label: 'food', icon: Utensils },
  { id: 'train', to: '/train', label: 'train', icon: Glyphs.DumbbellPlate },
  { id: 'coach', to: '/coach', label: 'coach', icon: MessageSquareText },
  { id: 'progress', to: '/progress', label: 'progress', icon: ChartSpline },
];

/** Train's activity hub without a plan (log, record, review): the same screen under its planless name. */
export const ACTIVITIES_ITEM: NavItem = { id: 'train', to: '/train', label: 'activities', icon: Glyphs.DumbbellPlate };

/** Today, home in every mode (0.6.3): the first key everywhere. */
export const TODAY_ITEM: NavItem = LIVING_DESTINATIONS[0]!;
export const FOOD_ITEM: NavItem = LIVING_DESTINATIONS[1]!;
export const TRAIN_ITEM: NavItem = LIVING_DESTINATIONS[2]!;
export const COACH_ITEM: NavItem = LIVING_DESTINATIONS[3]!;
export const PROGRESS_ITEM: NavItem = LIVING_DESTINATIONS[4]!;
export const BODY_ITEM: NavItem = DESTINATIONS[0]!;
export const SIMULATE_ITEM: NavItem = DESTINATIONS[1]!;
export const PLAN_ITEM: NavItem = DESTINATIONS[2]!;
export const EVIDENCE_ITEM: NavItem = DESTINATIONS[3]!;

/** The planning steps (Body · Simulate · Plan) as one dock key in Planning mode: current on any of the three. */
export const PLANNING_PATTERN = /^\/(?:body|simulate|plan(?!\/active(?:\/|$)))(?:\/|$)/;

/** Plan details, the running plan's own page (Living; More › Your plan). */
export const PLAN_DETAILS_ITEM: NavItem = { id: 'planDetails', to: '/plan/active', label: 'plan details', icon: ClipboardList };

/** The phone dock's last key: the More page, home of every place the dock has no room for. */
export const MORE_PATH = '/more';
export const MORE_ITEM: NavItem = { id: 'more', to: MORE_PATH, label: 'more', icon: LayoutGrid };

/** Where "Back to Today" (⌘/Ctrl + 0 while a plan runs) lands. */
export const TODAY_PATH = '/today';

/** Is `item` the place `pathname` shows? (its own pattern, else its path and everything under it) */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** "Today" for the label "today": nav labels are kept lowercase as accessible names and drawn capitalised. */
export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface NavBadgeState {
  /** 6 px gold dot on a destination's icon, e.g. stale results on Simulate, a proposal waiting on Coach. */
  badges: Partial<Record<Destination | LivingDestination, boolean>>;
  setBadge: (d: Destination | LivingDestination, on: boolean) => void;
}

export const useNavBadges = create<NavBadgeState>()((set) => ({
  badges: {},
  setBadge: (d, on) => set((s) => ({ badges: { ...s.badges, [d]: on } })),
}));

/** Show/hide the dot on a navigation destination (sidebar row, dock key; a place inside More lights the More key). */
export const setNavBadge = (d: Destination | LivingDestination, on: boolean): void => useNavBadges.getState().setBadge(d, on);
