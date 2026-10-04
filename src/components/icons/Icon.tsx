import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import { cx } from '../lib/cx';

/** Any Lucide icon or authored glyph from ./glyphs. */
export type IconComponent = ComponentType<LucideProps>;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  /** A Lucide icon (`import { Copy } from 'lucide-react'`) or an authored glyph. */
  icon: IconComponent;
  /** Rendered size in px. 20 is the grid; 16 in dense UI and small keys. */
  size?: number;
  /** Accessible name. Omit for decorative icons (they are aria-hidden). */
  label?: string;
}

/**
 * The one way to draw an icon: 1.5 px absolute stroke at every size, round caps,
 * currentColor. Decorative unless `label` is given.
 */
export function Icon({ icon: Glyph, size = 20, label, className, ...rest }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      className={cx('lm-icon', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
}
