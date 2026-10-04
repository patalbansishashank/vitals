/**
 * Authored Vitals glyphs — the ~20 icons Lucide does not have, drawn on a
 * 20 × 20 grid with 1.5 px strokes and round caps (DESIGN_DIRECTION §3.3).
 * Each glyph takes the same props as a Lucide icon, so `<Icon icon={…}>`
 * treats both families identically. Paths for the navigation glyphs come from
 * the prototype's <symbol> sprite (design/prototype/index.html).
 */
import type { LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';

export type GlyphProps = LucideProps;

function glyph(displayName: string, children: ReactNode) {
  function Glyph({ size = 20, strokeWidth = 1.5, absoluteStrokeWidth, color = 'currentColor', ...rest }: GlyphProps) {
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
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {children}
      </svg>
    );
  }
  Glyph.displayName = displayName;
  return Glyph;
}

/* ---- navigation ------------------------------------------------------------ */
export const AvatarFront = glyph(
  'AvatarFront',
  <>
    <circle cx="10" cy="3.6" r="2" />
    <path d="M6.2 7.2h7.6l-.9 5.3h-1.4l-.3 5.3H8.8l-.3-5.3H7.1z" />
  </>,
);
export const AvatarSide = glyph(
  'AvatarSide',
  <>
    <circle cx="10.4" cy="3.6" r="2" />
    <path d="M8.8 7.2h2.6c1 0 1.6.9 1.4 1.9l-.7 3.4h-.8l-.4 5.3H9.3l-.5-5.3c-.8-.5-1.2-1.4-1-2.4z" />
  </>,
);
export const Channels = glyph(
  'Channels',
  <>
    <path d="M2.5 5.5h2l1.5-2 2 4 1.5-2h8" />
    <path d="M2.5 10.5h4l1.5 1.8 2-3.6 1.6 1.8h5.9" />
    <path d="M2.5 15.5h6.5l1.5-1.6 1.5 1.6h5.5" />
  </>,
);
export const RouteGlyph = glyph(
  'RouteGlyph',
  <>
    <circle cx="4.5" cy="15.5" r="2" />
    <circle cx="15.5" cy="4.5" r="2" />
    <path d="M6.5 15.5h6a2.5 2.5 0 0 0 0-5h-5a2.5 2.5 0 0 1 0-5h6" />
  </>,
);
export const BookGlyph = glyph(
  'BookGlyph',
  <>
    <path d="M3 4.5c2.2-.8 4.5-.8 7 .8 2.5-1.6 4.8-1.6 7-.8v11c-2.2-.8-4.5-.8-7 .8-2.5-1.6-4.8-1.6-7-.8z" />
    <path d="M10 5.3v11" />
  </>,
);
export const SlidersGlyph = glyph(
  'SlidersGlyph',
  <>
    <path d="M3 5.5h8M15 5.5h2M3 14.5h2M9 14.5h8" />
    <circle cx="13" cy="5.5" r="2" />
    <circle cx="7" cy="14.5" r="2" />
  </>,
);
export const ThemeGlyph = glyph(
  'ThemeGlyph',
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
  </>,
);

/* ---- activity + physiology ------------------------------------------------ */
export const DumbbellPlate = glyph('DumbbellPlate', <path d="M2.5 10h15M5 6.5v7M7.5 5v10M12.5 5v10M15 6.5v7" />);
export const Footsteps = glyph(
  'Footsteps',
  <>
    <path d="M7 3.5c1.4 0 2 1.4 2 3s-.6 3.5-2 3.5-2-1.4-2-3 .6-3.5 2-3.5zM13 8.5c1.4 0 2 1.4 2 3s-.6 3.5-2 3.5-2-1.4-2-3 .6-3.5 2-3.5z" />
    <path d="M5.5 12.2h3M11.5 17.2h3" />
  </>,
);
export const RunGlyph = glyph(
  'RunGlyph',
  <>
    <circle cx="12.6" cy="3.6" r="1.6" />
    <path d="M6.2 8.2l3-1.6 3.2 1.2-1.6 4 2.6 2-.9 3.6" />
    <path d="M10.8 11.8l-2.3 2.6-3.7.3" />
    <path d="M12.4 7.8l1.5 2.3 2.6.4" />
  </>,
);
export const FastClock = glyph(
  'FastClock',
  <>
    <circle cx="10" cy="10.5" r="6.5" />
    <path d="M10 6.5v4l2.5 1.5M8 2h4" />
  </>,
);
export const MealDot = glyph(
  'MealDot',
  <>
    <circle cx="10" cy="10" r="6.5" />
    <circle cx="10" cy="10" r="2.2" fill="currentColor" stroke="none" />
  </>,
);
export const KetoneDrop = glyph(
  'KetoneDrop',
  <>
    <path d="M10 2.8c2.7 3.4 5 6.2 5 8.9a5 5 0 0 1-10 0c0-2.7 2.3-5.5 5-8.9z" />
    <path d="M7.6 12.2a2.4 2.4 0 0 0 2.4 2.4" />
  </>,
);
export const SleepArc = glyph('SleepArc', <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" />);
export const GradePips = glyph(
  'GradePips',
  <>
    <circle cx="3.5" cy="10" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="7.8" cy="10" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12.2" cy="10" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="10" r="1.5" />
  </>,
);
export const ProgramKey = glyph(
  'ProgramKey',
  <>
    <rect x="3" y="4" width="14" height="12" rx="1.8" />
    <circle cx="6.8" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M9.5 8h4.5M6.2 12.5h7.6" />
  </>,
);
export const ScaleRuler = glyph(
  'ScaleRuler',
  <path d="M2.5 6.5h15M3.5 6.5v6M6 6.5v3M8.5 6.5v3M11 6.5v6M13.5 6.5v3M16 6.5v3M3.5 15.5h0M11 15.5h0" />,
);
export const Hatch = glyph(
  'Hatch',
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M5.5 14.5l9-9M4 11l7-7M9 16l7-7" />
  </>,
);

/* ---- status marks (severity is never colour alone: the shape carries it) --- */
export const InfoMark = glyph(
  'InfoMark',
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 9v4.5M10 6.5v.1" />
  </>,
);
export const CautionMark = glyph(
  'CautionMark',
  <>
    <path d="M10 3.2l7.3 12.6H2.7z" />
    <path d="M10 8.2v3.6M10 13.9v.1" />
  </>,
);
export const DangerMark = glyph(
  'DangerMark',
  <>
    <path d="M7.1 2.8h5.8l4.3 4.3v5.8l-4.3 4.3H7.1l-4.3-4.3V7.1z" />
    <path d="M10 6.6v4.4M10 13.5v.1" />
  </>,
);
export const OkMark = glyph(
  'OkMark',
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="M6.9 10.2l2.2 2.2 4.1-4.5" />
  </>,
);
