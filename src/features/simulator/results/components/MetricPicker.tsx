/**
 * Metric picker (COMPONENTS §7 MetricPicker; data logic in `@/features/charts` lib/picker): a bottom sheet on
 * phones, a side panel from 1024 px. Search, grade filters, the eight category groups with "3/7" counts, and rows
 * with a line-key swatch, name, unit, grade badge, pin-to-strip and Explain. Low-confidence channels (grade C/D)
 * carry their caveat under the row — the autophagy signal's mandatory statement always; change-from-baseline
 * channels say "relative to your baseline". Lanes add a channel at the end of its category group; overlay refuses
 * a 7th pick with the reason.
 */
import { useId, useMemo, useState } from 'react';
import { Info, Pin, PinOff, Search } from 'lucide-react';
import { Chip, GradeBadge, IconKey, Key, ResponsivePanel, Swatch, TextInput, VisuallyHidden, type EvidenceGrade } from '@/components';
import { capacityText, pickerGroups, toggleMetric, type ChartSeries, type PickerMode } from '@/features/charts';
import { MAX_PINNED, type DisplayMetric } from '../lib/metrics';

export interface MetricPickerProps {
  open: boolean;
  onClose: () => void;
  series: readonly ChartSeries[];
  metrics: ReadonlyMap<string, DisplayMetric>;
  mode: PickerMode;
  laneIds: readonly string[];
  overlayIds: readonly string[];
  onLaneIdsChange: (ids: string[]) => void;
  onOverlayIdsChange: (ids: string[]) => void;
  onReset: () => void;
  pinnedIds: readonly string[];
  onTogglePin: (id: string) => void;
  onExplain: (id: string) => void;
}

const GRADES: readonly EvidenceGrade[] = ['A', 'B', 'C', 'D'];

/** Caveat to print under a row: grade C/D channels with a catalogue caveat; the autophagy caveat always. */
export function rowCaveat(m: Pick<DisplayMetric, 'id' | 'grade' | 'caveat'> | undefined): string | undefined {
  if (!m?.caveat) return undefined;
  if (m.id === 'autophagyIdx') return m.caveat;
  return m.grade === 'C' || m.grade === 'D' ? m.caveat : undefined;
}

export function MetricPicker(p: MetricPickerProps) {
  const [query, setQuery] = useState('');
  const [grades, setGrades] = useState<EvidenceGrade[]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const searchId = useId();
  const selected = p.mode === 'overlay' ? p.overlayIds : p.laneIds;
  const groups = useMemo(() => pickerGroups(p.series, selected, { query, grades, selectedOnly }), [p.series, selected, query, grades, selectedOnly]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  const toggle = (id: string) => {
    const r = toggleMetric(p.series, selected, id, p.mode);
    setNote(r.refused);
    if (r.refused) return;
    if (p.mode === 'overlay') p.onOverlayIdsChange(r.selected);
    else p.onLaneIdsChange(r.selected);
  };

  const footer = (
    <div className="rs-picker__foot">
      <span className="rs-picker__cap lm-num">{capacityText(p.laneIds.length, p.overlayIds.length)}</span>
      {p.laneIds.length >= 30 ? <span className="rs-picker__long">{p.laneIds.length} lanes · long page — try Focus</span> : null}
      <Key size="sm" variant="quiet" onClick={p.onReset}>
        Reset to default set
      </Key>
    </div>
  );

  return (
    <ResponsivePanel open={p.open} onClose={p.onClose} title={p.mode === 'overlay' ? 'Metrics · overlay' : 'Metrics'} footer={footer} detents={['half', 'full']} defaultDetent="full">
      <div className="rs-picker">
        <div className="rs-picker__search">
          <label htmlFor={searchId}>
            <VisuallyHidden>Search metrics</VisuallyHidden>
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          </label>
          <TextInput id={searchId} type="text" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 55 channels" autoComplete="off" />
        </div>
        <div className="rs-picker__filters" role="group" aria-label="Filter by evidence grade">
          {GRADES.map((g) => (
            <Chip key={g} kind="filter" pressed={grades.includes(g)} onPressedChange={(on) => setGrades((cur) => (on ? [...cur, g] : cur.filter((x) => x !== g)))}>
              grade {g}
            </Chip>
          ))}
          <Chip kind="filter" pressed={selectedOnly} onPressedChange={setSelectedOnly}>
            selected
          </Chip>
        </div>
        {p.mode === 'overlay' ? <p className="rs-picker__hint">Overlay indexes up to 6 channels to their start. Ketones and change-from-baseline markers stay in Lanes.</p> : null}
        {note ? (
          <p className="rs-picker__refused" role="status">
            {note}
          </p>
        ) : null}
        {shown === 0 ? <p className="rs-picker__empty">No channel matches “{query}”.</p> : null}
        {groups.map((g) => (
          <section key={g.category} className="rs-picker__group" aria-label={g.label}>
            <h3 className="rs-picker__ghead">
              <Swatch category={g.category} shape="square" />
              <span className="lm-eng">{g.label}</span>
              <span className="rs-picker__count lm-num">
                {g.selectedCount}/{g.total}
              </span>
            </h3>
            <ul className="rs-picker__rows">
              {g.items.map((it) => {
                const m = p.metrics.get(it.id);
                const caveat = rowCaveat(m);
                const pinned = p.pinnedIds.includes(it.id);
                const canPin = pinned || p.pinnedIds.length < MAX_PINNED;
                const inputId = `${searchId}-${it.id}`;
                return (
                  <li key={it.id} className="rs-picker__row" data-selected={it.selected || undefined} data-disabled={(p.mode === 'overlay' && !it.overlayEligible) || undefined}>
                    <input id={inputId} type="checkbox" className="rs-picker__check" checked={it.selected} onChange={() => toggle(it.id)} aria-describedby={caveat ? `${inputId}-cv` : undefined} />
                    <label htmlFor={inputId} className="rs-picker__label">
                      <Swatch category={it.category} />
                      <span className="rs-picker__name">{it.label}</span>
                      <span className="rs-picker__unit">
                        {it.unit === 'index' ? 'index' : it.unit}
                        {m?.relativeNote ? ` · ${m.relativeNote}` : ''}
                        {it.grade === 'D' ? ' · exploratory' : ''}
                      </span>
                    </label>
                    <GradeBadge grade={it.grade} size="sm" />
                    <span className="rs-picker__acts">
                      <IconKey
                        size="sm"
                        variant="quiet"
                        icon={pinned ? PinOff : Pin}
                        label={pinned ? `Unpin ${it.label} from the strip` : canPin ? `Pin ${it.label} to the strip` : `The strip holds ${MAX_PINNED} pinned metrics`}
                        pressed={pinned}
                        disabledReason={canPin ? undefined : `The strip holds ${MAX_PINNED} pinned metrics`}
                        onClick={() => p.onTogglePin(it.id)}
                      />
                      <IconKey size="sm" variant="quiet" icon={Info} label={`Explain ${it.label}`} onClick={() => p.onExplain(it.id)} />
                    </span>
                    {caveat ? (
                      <p id={`${inputId}-cv`} className="rs-picker__caveat">
                        {caveat}
                      </p>
                    ) : null}
                    {p.mode === 'overlay' && !it.overlayEligible && it.overlayNote ? <p className="rs-picker__caveat">{it.overlayNote}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </ResponsivePanel>
  );
}
