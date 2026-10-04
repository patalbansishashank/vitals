/* ==========================================================================
   <LegendChip> (COMPONENTS §7): key glyph mirroring the mark (line with the
   series dash + marker, or a rect for bars) + name. Click = isolate,
   ⌥/Alt-click = hide. Order = series order; never re-sorted by value.
   ========================================================================== */
import type { MouseEvent } from 'react';
import type { MarkerShape } from '../catalogue';

export interface LegendChipProps {
  label: string;
  color: string;
  dash?: readonly number[];
  marker?: MarkerShape;
  kind?: 'line' | 'bar';
  /** Secondary text after the name ("%", "pts"). */
  note?: string;
  isolated?: boolean;
  hidden?: boolean;
  onIsolate?: () => void;
  onHide?: () => void;
}

export function KeyGlyph({ color, dash, marker, kind = 'line' }: Pick<LegendChipProps, 'color' | 'dash' | 'marker' | 'kind'>) {
  if (kind === 'bar')
    return (
      <svg width="10" height="10" aria-hidden="true">
        <rect width="10" height="10" rx="2" fill={color} />
      </svg>
    );
  return (
    <svg width="22" height="10" aria-hidden="true" style={{ overflow: 'visible' }}>
      <line x1="1" x2="21" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash?.length ? dash.map((d) => d * 0.75).join(' ') : undefined} />
      {marker === 'square' ? (
        <rect x="7.5" y="1.5" width="7" height="7" fill={color} stroke="var(--lm-face)" strokeWidth="1.5" />
      ) : marker === 'triangle' ? (
        <path d="M11,0.8 L15,8.6 L7,8.6 Z" fill={color} stroke="var(--lm-face)" strokeWidth="1.5" strokeLinejoin="round" />
      ) : marker === 'circle' ? (
        <circle cx="11" cy="5" r="3.6" fill={color} stroke="var(--lm-face)" strokeWidth="1.5" />
      ) : null}
    </svg>
  );
}

export function LegendChip(p: LegendChipProps) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.altKey) p.onHide?.();
    else p.onIsolate?.();
  };
  return (
    <button
      type="button"
      className="lmc-legend-chip"
      aria-pressed={p.isolated ?? false}
      data-hidden={p.hidden || undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && p.onHide) {
          e.preventDefault();
          p.onHide();
        }
      }}
      title={`${p.label}: click to isolate, Alt-click to ${p.hidden ? 'show' : 'hide'}`}
      aria-label={`${p.label}${p.hidden ? ', hidden' : ''}. Press to isolate; Delete to ${p.hidden ? 'show' : 'hide'}.`}
    >
      <KeyGlyph color={p.color} dash={p.dash} marker={p.marker} kind={p.kind} />
      <span>{p.label}</span>
      {p.note ? <span className="lmc-kind">{p.note}</span> : null}
    </button>
  );
}
