/**
 * Engine events (MODEL_SPEC §7.1) and warning runs → chart event glyphs (CHART_SPEC §4.5). Labels are short,
 * lowercase and plain. Flapping transitions (e.g. ketosis entered and left inside one eating window) are thinned:
 * the same event type within 6 h of the previous one is dropped. Safety flags carry the warning's title and
 * severity so caution/danger draw their line through every lane.
 */
import type { SimEvent, SimEventType, SimWarning } from '@/engine';
import type { ChartEvent } from '@/features/charts';
import { isProjectionNote, warningTitle } from './warnings';

interface EventSpec {
  type: ChartEvent['type'];
  label: string;
}

export const EVENT_SPEC: Record<SimEventType, EventSpec | null> = {
  ketosisEntered: { type: 'ketosis-entered', label: 'ketosis entered' },
  ketosisExited: { type: 'ketosis-exited', label: 'ketosis exited' },
  deepKetosis: { type: 'note', label: 'deep ketosis' },
  ketoneAlert: { type: 'note', label: 'ketones above 3 while eating' },
  ketoAdapted: { type: 'note', label: 'keto-adapted' },
  glycogenLow: { type: 'glycogen-low', label: 'glycogen depleted' },
  glycogenFull: { type: 'note', label: 'glycogen full' },
  liverGlycogenLow: null, // the fuel lanes show it; one glyph per night would crowd the ribbon
  metabolicSwitch: null, // mirrors liver glycogen; ketosis entered carries the same moment
  fastStart: { type: 'fast-start', label: 'fast starts' },
  fastEnd: { type: 'fast-end', label: 'fast ends · refeed' },
  waterRebound: { type: 'note', label: 'water rebound' },
  weightPlateau: { type: 'note', label: 'scale plateau · water masks fat loss' },
  detrainingOnset: { type: 'note', label: 'detraining begins' },
  supercompensation: { type: 'refeed', label: 'glycogen supercompensation' },
  safetyFlag: null, // drawn from the warning list below (it knows the rule and the severity)
};

/** Events in the chart's shape (hours since the start). */
export function eventsForChart(
  events: readonly SimEvent[],
  warnings: readonly SimWarning[],
  nDays: number,
): Array<{ tHours: number; type: ChartEvent['type']; label: string; severity?: ChartEvent['severity'] }> {
  const out: Array<{ tHours: number; type: ChartEvent['type']; label: string; severity?: ChartEvent['severity'] }> = [];
  const lastAt = new Map<string, number>();
  const sorted = [...events].sort((a, b) => a.hour - b.hour);
  for (const e of sorted) {
    const spec = EVENT_SPEC[e.type];
    if (!spec || e.hour < 0 || e.hour >= nDays * 24) continue;
    const prev = lastAt.get(e.type);
    if (prev != null && e.hour - prev < 6) continue;
    lastAt.set(e.type, e.hour);
    out.push({ tHours: e.hour + 0.5, type: spec.type, label: spec.label });
  }
  // one safety glyph per caution/danger run, at the start of its first day
  const seen = new Set<string>();
  for (const w of warnings) {
    if (w.severity === 'info' || isProjectionNote(w)) continue;
    const key = `${w.id}:${w.startDay}`;
    if (seen.has(key) || w.startDay < 0 || w.startDay >= nDays) continue;
    seen.add(key);
    out.push({ tHours: w.startDay * 24 + 12, type: 'safety', label: warningTitle(w).replace(/\.$/, ''), severity: w.severity });
  }
  return out.sort((a, b) => a.tHours - b.tHours);
}
