/**
 * The Today card library's groups (r087 IA): one name per domain and one fixed order, the Ring signals taxonomy
 * (`ring/monitor/catalogue.ts` `MONITOR_GROUPS`) with Plan, Food, Body and Short videos around it. A card's group is
 * what it is about, so Heart Points (movement) sits in Move although its hue is heart.
 */
import type { Domain } from '@/components';

export const TODAY_CARD_GROUPS = ['Plan', 'Food', 'Energy', 'Move', 'Sleep', 'Heart', 'Recovery', 'Body', 'Short videos'] as const;

export type TodayCardGroup = (typeof TODAY_CARD_GROUPS)[number];

const GROUP_OF_DOMAIN: Partial<Record<Domain, TodayCardGroup>> = {
  plan: 'Plan',
  food: 'Food',
  energy: 'Energy',
  steps: 'Move',
  sleep: 'Sleep',
  heart: 'Heart',
  recovery: 'Recovery',
  body: 'Body',
  videos: 'Short videos',
};

/** The group of a card in `domain` (a domain without one of its own reads as Plan). */
export const groupOfDomain = (domain: Domain): TodayCardGroup => GROUP_OF_DOMAIN[domain] ?? 'Plan';
