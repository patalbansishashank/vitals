import { create } from 'zustand';
import { ChartSpline, MessageSquareText, SunDim, Undo2, Utensils } from 'lucide-react';
import type { IconComponent } from '@/components/icons/Icon';
import * as Glyphs from '@/components/icons/glyphs';
import { RingGlyph } from '@/features/ring/RingKey';

export type Destination = 'body' | 'simulate' | 'plan' | 'evidence';
/** Living-mode destinations (IA §3.5–§3.6). */
export type LivingDestination = 'today' | 'food' | 'train' | 'coach' | 'progress';

export interface NavItem {
  id: Destination | LivingDestination | 'settings' | 'planning' | 'signals';
  to: string;
  label: string;
  icon: IconComponent;
}

/** The four destinations in journey order (IA §3) + settings. Labels are lowercase engraved. */
export const DESTINATIONS: NavItem[] = [
  { id: 'body', to: '/body', label: 'body', icon: Glyphs.AvatarFront },
  { id: 'simulate', to: '/simulate', label: 'simulate', icon: Glyphs.Channels },
  { id: 'plan', to: '/plan', label: 'plan', icon: Glyphs.RouteGlyph },
  { id: 'evidence', to: '/evidence', label: 'evidence', icon: Glyphs.BookGlyph },
];

export const SETTINGS_ITEM: NavItem = { id: 'settings', to: '/settings', label: 'settings', icon: Glyphs.SlidersGlyph };

/**
 * Body signals, the one ring page (ring-pages.md D2: a top-bar key, not a tab; not in the destination lists). Same
 * mark as the top-bar ring key: a ring with a pulse line.
 */
export const SIGNALS_ITEM: NavItem = { id: 'signals', to: '/signals', label: 'body signals', icon: RingGlyph };

/** Living mode: Today (home) · Food · Train · Coach · Progress (IA §3.5; full words, never abbreviated). */
export const LIVING_DESTINATIONS: NavItem[] = [
  { id: 'today', to: '/today', label: 'today', icon: SunDim },
  { id: 'food', to: '/food', label: 'food', icon: Utensils },
  { id: 'train', to: '/train', label: 'train', icon: Glyphs.DumbbellPlate },
  { id: 'coach', to: '/coach', label: 'coach', icon: MessageSquareText },
  { id: 'progress', to: '/progress', label: 'progress', icon: ChartSpline },
];

/** Living mode's lower rail group (desktop) / overflow menu (mobile): Evidence · Planning tools · Settings. */
export const EVIDENCE_ITEM: NavItem = DESTINATIONS[3]!;
export const PLANNING_ITEM: NavItem = { id: 'planning', to: '/body', label: 'planning', icon: Glyphs.RouteGlyph };
/** The planning override's return key: it takes Today's slot (IA §3.4 rule 2, COMPONENTS §11). */
export const RETURN_ITEM: NavItem = { id: 'today', to: '/today', label: 'today', icon: Undo2 };
/** The Coach in Planning mode: a top-bar icon key (IA §3.4 rule 5). */
export const COACH_ITEM: NavItem = LIVING_DESTINATIONS[3]!;

interface NavBadgeState {
  /** 6 px ink dot on a destination, e.g. stale results on Simulate, a proposal waiting on Coach. */
  badges: Partial<Record<Destination | LivingDestination, boolean>>;
  setBadge: (d: Destination | LivingDestination, on: boolean) => void;
}

export const useNavBadges = create<NavBadgeState>()((set) => ({
  badges: {},
  setBadge: (d, on) => set((s) => ({ badges: { ...s.badges, [d]: on } })),
}));

/** Show/hide the dot on a navigation destination (rail + tab bar). */
export const setNavBadge = (d: Destination | LivingDestination, on: boolean): void => useNavBadges.getState().setBadge(d, on);
