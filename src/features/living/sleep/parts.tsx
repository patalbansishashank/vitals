/**
 * Small pieces the Sleep cards share (r071): the baseline-learning line and the calibrating chip, both a fact in mono
 * caps (a state, never a sentence), and one row of facts. The card material, the pictures and the numbers are the
 * foundation's.
 */
import { MonoMeta } from '@/components';
import { clamp } from '@/components/viz/geometry';
import type { NightView } from './model';
import './sleep.css';

/** "Calibrating · night 3 of 7" while the person's usual forms: a dashed-edge chip (dashes mean provisional), words only in quiet. */
export function CalibratingChip({ learning, quiet = false }: { learning: NonNullable<NightView['learning']>; quiet?: boolean }) {
  return (
    <MonoMeta className="sl-chip" data-kind="calibrating">
      {quiet ? 'Calibrating' : `Calibrating · night ${learning.nights} of ${learning.needed}`}
    </MonoMeta>
  );
}

/** "Learning your baseline · night 3 of 7": seven dots lit to the nights so far, then the words (quiet: no count). */
export function LearningRow({ learning, quiet = false }: { learning: NonNullable<NightView['learning']>; quiet?: boolean }) {
  const n = clamp(Math.round(learning.nights), 0, learning.needed);
  return (
    <p className="sl-learning">
      <span className="sl-learning__dots" aria-hidden="true">
        {Array.from({ length: learning.needed }, (_, i) => (
          <i key={i} data-lit={i < n || undefined} />
        ))}
      </span>
      <MonoMeta>{quiet ? 'Still learning your usual night' : `Learning your baseline · night ${n} of ${learning.needed}`}</MonoMeta>
    </p>
  );
}

/** One line of facts, joined by the separators MonoMeta draws; nothing when there are none. */
export function FactRow({ items, tone, className }: { items: ReadonlyArray<string | null | false | undefined>; tone?: 'muted' | 'ink' | 'hue'; className?: string }) {
  const list = items.filter((i): i is string => typeof i === 'string' && i !== '');
  return list.length ? <MonoMeta as="p" items={list} tone={tone} className={className} /> : null;
}
