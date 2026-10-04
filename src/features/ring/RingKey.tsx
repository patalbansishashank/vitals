/**
 * The top-bar ring key (design/screens/ring-pages.md §4.2, D2, D3): an icon key with the ring mark and a 6 px
 * indicator light for the worst state of all known rings; it opens /ring and looks pressed there. The shell mounts it
 * left of the settings key. It renders nothing where a ring can never be reached and none is known (D3).
 */
import { Link, useLocation } from 'react-router';
import type { LucideProps } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';
import { cx } from '@/components/lib/cx';
import { paths } from '@/app/paths';
import { useRingEnv, useRings, worstRingState, type RingStatus } from './data';
import { RING_PAGE_COPY } from './copy';
import { useNow } from './relativeTime';
import './ring-page.css';

/** The ring mark: an outline ring on the 20 px grid, 1.5 px stroke, currentColor (the Vitals mark without its dot). */
export function RingGlyph({ size = 20, strokeWidth = 1.5, absoluteStrokeWidth, color = 'currentColor', ...rest }: LucideProps) {
  const px = Number(size) || 20;
  const sw = absoluteStrokeWidth ? (Number(strokeWidth) * 20) / px : strokeWidth;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="10" cy="10" r="6.75" />
    </svg>
  );
}
RingGlyph.displayName = 'RingGlyph';

export type RingLight = ReturnType<typeof worstRingState>;

/** The key's accessible name (and tooltip) for a light (§4.2). */
export function ringKeyName(light: RingLight, rings: readonly RingStatus[]): string {
  const K = RING_PAGE_COPY.key;
  switch (light) {
    case 'connected':
      return K.connected;
    case 'reading':
      return K.reading;
    case 'elsewhere': {
      const device = rings.find((r) => r.state === 'elsewhere')?.heldBy?.deviceLabel;
      return device ? K.elsewhere(device) : K.off;
    }
    case 'off':
      return K.off;
    case 'attention':
      return K.attention;
    case 'none':
      return K.none;
  }
}

/** The 6 px light at the key's top-right; `attention` is the small caution triangle (never yellow, never red). */
export function RingLightMark({ light, className }: { light: RingLight; className?: string }) {
  if (light === 'none') return null;
  if (light === 'attention') {
    return (
      <svg className={cx('rg-light', className)} data-light="attention" width="8" height="7" viewBox="0 0 8 7" aria-hidden="true" focusable="false">
        <path d="M4 0.4 7.6 6.6H0.4z" />
      </svg>
    );
  }
  return <span className={cx('rg-light', className)} data-light={light} aria-hidden="true" />;
}

export interface RingKeyProps {
  className?: string;
}

export function RingKey({ className }: RingKeyProps) {
  const rings = useRings();
  const { platform } = useRingEnv();
  const now = useNow(30_000);
  const { pathname } = useLocation();
  // D3: no ring, no app and no Web Bluetooth: a ring can never be reached from here, so no key.
  if (!rings.length && !platform.installedApp && platform.ble === null) return null;
  const light = worstRingState(rings, now);
  const name = ringKeyName(light, rings);
  const current = pathname === paths.ring || pathname.startsWith(`${paths.ring}/`);
  return (
    <Tooltip content={name} role="label">
      <Link
        to={paths.ring}
        className={cx('lm-key rg-key', className)}
        data-variant="quiet"
        data-size="md"
        data-icon-only="true"
        data-has-icon="true"
        data-pressed={current ? 'true' : undefined}
        data-light={light}
        aria-label={name}
        aria-current={current ? 'page' : undefined}
      >
        <RingGlyph size={20} absoluteStrokeWidth className="lm-icon" />
        <RingLightMark light={light} />
      </Link>
    </Tooltip>
  );
}
