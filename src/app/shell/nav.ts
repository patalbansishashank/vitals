import { create } from 'zustand';
import { Activity, ChartSpline, ClipboardList, LayoutGrid, MessageSquareText, SunDim, Utensils } from 'lucide-react';
import type { IconComponent } from '@/components/icons/Icon';
import * as Glyphs from '@/components/icons/glyphs';

export type Destination = 'body' | 'simulate' | 'plan' | 'evidence';
/** Living-mode destinations (IA §3.5–§3.6). */
export type LivingDestination = 'today' | 'food' | 'train' | 'coach' | 'progress';

export interface NavItem {
  id: Destination | LivingDestination | 'settings' | 'ring' | 'more' | 'planDetails';
  to: string;
  /**
   * The key's accessible name. Kept lowercase, as these names have always been; where it is drawn (the dock's label,
   * the sidebar's row label, the More page's row) it is capitalised.
   */
  label: string;
  icon: IconComponent;
  /**
   * The paths this key stands for, when more than its own: the Planning dock's Plan key is current on all three
   * planning steps, Activity on its three tabs. Default: `to` and everything under it.
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

/**
 * Ring (the ring's readings of the body at rest: sleep, heart signals, scores): a dock key and a sidebar row in both
 * modes. A workout's page keeps its `/ring/workouts/…` address but is Activity's: Movement's list opens it and its Back
 * key returns there.
 */
export const RING_ITEM: NavItem = { id: 'ring', to: '/ring', label: 'ring', icon: Activity, match: /^\/ring(?!\/workouts(?:\/|$))(?:\/|$)/ };

/**
 * Activity's three tabs (r087): Train (`/train`), Movement (`/activity`) and Energy (`/energy`), and the workout pages
 * Movement opens. One key and one sidebar row stand for all of them, so movement data has one home.
 */
export const ACTIVITY_PATTERN = /^\/(?:train|activity|energy|ring\/workouts)(?:\/|$)/;

/** Living mode: Today (home) · Food · Activity · Coach · Progress (IA §3.5; full words, never abbreviated). */
export const LIVING_DESTINATIONS: NavItem[] = [
  { id: 'today', to: '/today', label: 'today', icon: SunDim },
  { id: 'food', to: '/food', label: 'food', icon: Utensils },
  // one name with or without a plan; it opens on Train, its first tab
  { id: 'train', to: '/train', label: 'activity', icon: Glyphs.DumbbellPlate, match: ACTIVITY_PATTERN },
  { id: 'coach', to: '/coach', label: 'coach', icon: MessageSquareText },
  { id: 'progress', to: '/progress', label: 'progress', icon: ChartSpline },
];

/** Today, home in every mode (0.6.3): the first key everywhere. */
export const TODAY_ITEM: NavItem = LIVING_DESTINATIONS[0]!;
export const FOOD_ITEM: NavItem = LIVING_DESTINATIONS[1]!;
export const ACTIVITY_ITEM: NavItem = LIVING_DESTINATIONS[2]!;
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
