/**
 * Table twins of the Ring's own pictures (r071): the pure rows a card puts in its (i) panel (`InfoSpec.twin`), the way
 * each new picture exports its own (`radialTwin`, `barsTwin`, …). A twin says what the picture says, row by row.
 */
import { clockText, durationText, rawStageTimeline, rawStageWord, spokenHypnogram, twinFileName, type RawStageSpan, type TwinData } from '@/components';

/** The night's stage runs as a table: stage, from, to, length. Reads the RAW spans (Mixed and No stage included). Pure. */
export function hypnogramTwin(p: { label: string; from: number; to: number; segments: readonly RawStageSpan[]; tz?: string }): TwinData {
  const timeline = rawStageTimeline(p.segments, p.from, p.to);
  return {
    title: `${p.label} table`,
    caption: spokenHypnogram({ label: p.label, from: p.from, to: p.to, segments: p.segments, tz: p.tz }),
    head: ['Stage', 'From', 'To', 'Length'],
    rows: timeline.map((s) => [rawStageWord(s.state), clockText(s.from, p.tz), clockText(s.to, p.tz), durationText((s.to - s.from) / 60_000)]),
    fileName: twinFileName(p.label),
    rowNoun: ['span', 'spans'],
  };
}
