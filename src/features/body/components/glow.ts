import type { CardGlow } from '@/components';

type GlowSpec = Exclude<CardGlow, string>;

/**
 * The input cards (Shape, Basics, Habits, Lab values) carry their domain's glow at about two thirds of its strength, so
 * the page's pictures (the figure, the estimates, maintenance) are the loud cards and the forms stay calm. It is the
 * domain's own position and size (RESEARCH §3.3) with a lower core, never a second gradient.
 */
export const LOW_BODY_GLOW: GlowSpec = { pos: '50% 120%', size: '105% 70%', a: 0.4 };
export const LOW_FOOD_GLOW: GlowSpec = { pos: '100% 0%', size: '82% 105%', a: 0.38 };

/** Maintenance: the energy glow sits in the top right corner behind the (i), at the strength where stone text still reads. */
export const MAINTENANCE_GLOW: GlowSpec = { pos: '100% 0%', size: '85% 62%', a: 0.5 };
