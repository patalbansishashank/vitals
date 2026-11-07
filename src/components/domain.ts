/**
 * Card domains (r071, RESEARCH §3.2). Eight domains carry a hue on a fixed wheel; `plan` is gold (the brand, the
 * action and "now"); `neutral` keeps today's gold-wash card. A card (`GradientCard`) or a picture (`hue` prop) sets
 * `data-domain` / `data-hue`, and src/styles/components.css ("domain wiring", the one place) turns that into the role
 * variables everything inside reads:
 *
 *   --lm-hue     solid: small marks (icon, today's bar, in-range ticks, a status dot)
 *   --lm-ink-h   ink: the soft tint for secondary text on the glow
 *   --lm-deep    deep: the glow core, and nothing else
 *   --lm-dim     dim: the unlit remainder of a track
 *   --lm-tone-2  the secondary text colour on this card (ink tint mixed into stone)
 *
 * Text never wears the solid. Focal marks on the glow (the line, its end dot, lit ticks, the thumb) are ivory.
 */
/** The wheel, in its fixed order (RESEARCH §3.2): heart, energy, food, steps, recovery, body, sleep, videos. */
export const HUE_DOMAINS = ['heart', 'energy', 'food', 'steps', 'recovery', 'body', 'sleep', 'videos'] as const;
export type HueDomain = (typeof HUE_DOMAINS)[number];

export type Domain = HueDomain | 'plan' | 'neutral';
/**
 * A domain that wears a colour: every `Domain` but `neutral` (the type a `Chip`, a `Swatch` or the `DateControl` takes).
 * Not a second list: it is derived, so the wheel is declared once.
 */
export type DomainName = Exclude<Domain, 'neutral'>;
export const DOMAINS: readonly Domain[] = [...HUE_DOMAINS, 'plan', 'neutral'];

/** What each domain covers, for galleries and the library's group names. */
export const DOMAIN_LABEL: Record<Domain, string> = {
  heart: 'Heart',
  energy: 'Energy',
  food: 'Food',
  steps: 'Movement',
  recovery: 'Recovery',
  body: 'Body',
  sleep: 'Sleep',
  videos: 'Short videos',
  plan: 'Plan',
  neutral: 'Neutral',
};

export type DomainRole = 'solid' | 'ink' | 'deep' | 'dim';

export const isDomain = (v: unknown): v is Domain => typeof v === 'string' && (DOMAINS as readonly string[]).includes(v);
export const isHueDomain = (v: unknown): v is HueDomain => typeof v === 'string' && (HUE_DOMAINS as readonly string[]).includes(v);

/**
 * The CSS colour of one role of a domain, as a token reference (it re-themes). `plan` is gold, `neutral` is ivory and
 * the unlit tint. For marks drawn in a style attribute or an SVG presentation attribute; inside a card prefer the
 * role variables above, which follow the card's own domain.
 */
export function domainToken(domain: Domain | undefined, role: DomainRole = 'solid'): string {
  if (!domain || domain === 'neutral') return role === 'dim' ? 'var(--lm-unlit)' : role === 'deep' ? 'var(--lm-face)' : 'var(--lm-ink)';
  if (domain === 'plan') return role === 'solid' ? 'var(--lm-signal)' : role === 'ink' ? 'var(--lm-ink)' : role === 'deep' ? 'var(--lm-hue-gold-deep)' : 'var(--lm-unlit)';
  return role === 'solid' ? `var(--lm-hue-${domain})` : `var(--lm-hue-${domain}-${role})`;
}
