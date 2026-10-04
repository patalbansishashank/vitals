/**
 * B1 · typing the values (design intake-v3 §8.2). Groups (lipids open first, the rest collapsed with "n of m
 * entered"), one test date per group and, for lipids and sugar, a fasting bank; per marker the value, its unit (a
 * switch converts the typed value; Lp(a) never converts, it re-labels), the lab's printed range (two numbers or the
 * printed text) and the status against that range. Bounds come from the shared unit table: implausible values are a
 * field error, unusual ones ask "Is X right?". Only entered, accepted rows are saved, through `markers.set`.
 * A real table from 768 px; below, one fieldset block per marker.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { ErrorText, Key, KeyBank, Notice, Select, TextInput, cx, useMediaQuery, MQ } from '@/components';
import { GROUP_LABEL, GROUP_ORDER, MARKER_UNITS, checkBounds, formatMarkerDate, markersOfGroup, unitsOf, type BoundCheck, type MarkerGroupId, type MarkerId, type MarkerReading, type MarkerReadingInput, type MarkersView } from '@/markers';
import { FASTING_GROUPS, M, convertTyped, convertedText, parseTyped, rangeStatus, todayIso, type RangeStatus } from './markers';
import { setMarkers } from './markersApi';
import { MarkerDateInput, MarkersCard, MarkersFoot, RangeStatusText } from './markersParts';

type Fasting = 'yes' | 'no' | 'unsure';

interface RowDraft {
  value: string;
  unit: string;
  low: string;
  high: string;
  text: string;
  textMode: boolean;
  /** "Yes, keep it" pressed for a value outside the usual bounds. */
  keep: boolean;
  /** Left the field once: messages show from then on. */
  touched: boolean;
  /** Lp(a) unit switched: the value was re-labelled, not converted. */
  relabelled: boolean;
}

interface GroupDraft {
  date: string;
  fasting?: Fasting;
  open: boolean;
}

export interface RowEval {
  n: number | null;
  check: BoundCheck | null;
  /** Typed but not a number, or outside plausibility. */
  blocked: boolean;
  /** Outside the usual bounds and not yet kept. */
  ask: boolean;
  ready: boolean;
  status: RangeStatus | null;
}

export function evalRow(id: MarkerId, d: RowDraft): RowEval {
  const n = parseTyped(d.value);
  const typed = d.value.trim() !== '';
  const check = n === null ? null : checkBounds(id, n, d.unit);
  const blocked = (typed && n === null) || (check !== null && !check.ok && check.level === 'block');
  const ask = check !== null && !check.ok && check.level === 'ask' && !d.keep;
  const ready = n !== null && !blocked && !ask;
  const status = d.textMode ? null : rangeStatus(n, parseTyped(d.low), parseTyped(d.high));
  return { n, check, blocked, ask, ready, status };
}

const emptyRow = (id: MarkerId): RowDraft => ({ value: '', unit: unitsOf(id)[0]!, low: '', high: '', text: '', textMode: false, keep: false, touched: false, relabelled: false });

function initialRows(initial: readonly MarkerReading[]): Record<MarkerId, RowDraft> {
  const out = {} as Record<MarkerId, RowDraft>;
  for (const id of Object.keys(MARKER_UNITS) as MarkerId[]) {
    const r = initial.find((x) => x.id === id);
    if (!r) {
      out[id] = emptyRow(id);
      continue;
    }
    const units = unitsOf(id);
    out[id] = {
      ...emptyRow(id),
      value: String(r.value),
      unit: units.includes(r.unit) ? r.unit : units[0]!,
      low: r.labRange?.low !== undefined ? String(r.labRange.low) : '',
      high: r.labRange?.high !== undefined ? String(r.labRange.high) : '',
      text: r.labRange?.text && r.labRange.low === undefined && r.labRange.high === undefined ? r.labRange.text : '',
      textMode: Boolean(r.labRange?.text && r.labRange.low === undefined && r.labRange.high === undefined),
      keep: true,
    };
  }
  return out;
}

function initialGroups(initial: readonly MarkerReading[], today: string, focus?: MarkerId): Record<MarkerGroupId, GroupDraft> {
  const out = {} as Record<MarkerGroupId, GroupDraft>;
  for (const g of GROUP_ORDER) {
    const rs = initial.filter((r) => MARKER_UNITS[r.id].group === g);
    const date = rs.map((r) => r.date).sort().pop() ?? today;
    const f = rs.find((r) => r.fasting !== undefined)?.fasting;
    out[g] = {
      date,
      ...(f !== undefined ? { fasting: f ? 'yes' : 'no' } : {}),
      open: g === 'lipids' || rs.length > 0 || (focus !== undefined && MARKER_UNITS[focus].group === g),
    };
  }
  return out;
}

export interface MarkersTableProps {
  /** Saved readings to start from (Change). */
  initial?: readonly MarkerReading[];
  /** Open and focus this marker's row (`?edit=ldl`). */
  focusMarker?: MarkerId;
  today?: string;
  onSaved: (view: MarkersView | null) => void;
  onBack?: () => void;
  onSkip?: () => void;
}

export function MarkersTable({ initial = [], focusMarker, today = todayIso(), onSaved, onBack, onSkip }: MarkersTableProps) {
  const [rows, setRows] = useState(() => initialRows(initial));
  const [groups, setGroups] = useState(() => initialGroups(initial, today, focusMarker));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wide = useMediaQuery(MQ.md);

  useEffect(() => {
    if (!focusMarker) return;
    const el = document.getElementById(`marker-${focusMarker}`);
    el?.scrollIntoView?.({ block: 'center' });
    el?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [focusMarker]);

  const evals = useMemo(() => {
    const out = {} as Record<MarkerId, RowEval>;
    for (const id of Object.keys(rows) as MarkerId[]) out[id] = evalRow(id, rows[id]);
    return out;
  }, [rows]);

  const ids = Object.keys(rows) as MarkerId[];
  const ready = ids.filter((id) => evals[id].ready);
  const anyAsk = ids.some((id) => evals[id].ask);
  const anyBlocked = ids.some((id) => evals[id].blocked);
  const reason = anyBlocked ? M.table.saveBlocked : anyAsk ? M.table.saveAsk : ready.length === 0 ? M.table.saveNone : undefined;

  const patch = (id: MarkerId, p: Partial<RowDraft>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const patchGroup = (g: MarkerGroupId, p: Partial<GroupDraft>) => setGroups((s) => ({ ...s, [g]: { ...s[g], ...p } }));

  const changeUnit = (id: MarkerId, to: string) => {
    const d = rows[id];
    if (to === d.unit) return;
    const v = convertTyped(id, d.value, d.unit, to);
    const lo = convertTyped(id, d.low, d.unit, to);
    const hi = convertTyped(id, d.high, d.unit, to);
    if (v === null) patch(id, { unit: to, relabelled: d.value.trim() !== '', keep: false });
    else patch(id, { unit: to, value: v, low: lo ?? d.low, high: hi ?? d.high, relabelled: false, keep: false });
  };

  const clearGroup = (g: MarkerGroupId) => setRows((r) => ({ ...r, ...Object.fromEntries(markersOfGroup(g).map((id) => [id, emptyRow(id)])) }));

  const save = async () => {
    if (reason) return;
    const readings: MarkerReadingInput[] = ready.map((id) => {
      const d = rows[id];
      const g = groups[MARKER_UNITS[id].group];
      const low = parseTyped(d.low);
      const high = parseTyped(d.high);
      const labRange = d.textMode
        ? d.text.trim()
          ? { text: d.text.trim(), unit: d.unit }
          : undefined
        : low !== null || high !== null
          ? { ...(low !== null ? { low } : {}), ...(high !== null ? { high } : {}), unit: d.unit }
          : undefined;
      const fasting = FASTING_GROUPS.has(MARKER_UNITS[id].group) && g.fasting && g.fasting !== 'unsure' ? g.fasting === 'yes' : undefined;
      return { id, value: evals[id].n!, unit: d.unit, date: g.date, ...(labRange ? { labRange } : {}), ...(fasting !== undefined ? { fasting } : {}) };
    });
    setBusy(true);
    setError(null);
    const r = await setMarkers({ readings, chapter: 'manual' });
    setBusy(false);
    if (!r.ok) {
      setError(r.message && r.message !== 'pending' ? `${M.table.saveFailed} ${r.message}` : M.table.saveFailed);
      return;
    }
    onSaved(r.value);
  };

  const footer = (
    <MarkersFoot
      notice={error ? <Notice severity="danger" layout="ruled" title={error} announce /> : null}
      left={
        onBack ? (
          <Key variant="default" onClick={onBack}>
            ‹ {M.table.back}
          </Key>
        ) : null
      }
      right={
        <>
          {onSkip ? (
            <Key variant="quiet" onClick={onSkip}>
              {M.table.skipTable}
            </Key>
          ) : null}
          <Key variant="solid" onClick={() => void save()} disabledReason={reason} loading={busy}>
            {M.table.save(ready.length)}
          </Key>
        </>
      }
      reason={reason}
    />
  );

  return (
    <MarkersCard prompt={M.manual.prompt} skipText={M.manual.skipText} footer={footer} id="ik-markers-manual" className="lm-mk-card--wide">
      <p className="lm-mk-note">{M.table.lead}</p>
      {GROUP_ORDER.map((g) => (
        <MarkerGroup
          key={g}
          group={g}
          draft={groups[g]}
          rows={rows}
          evals={evals}
          today={today}
          wide={wide}
          onGroup={(p) => patchGroup(g, p)}
          onRow={patch}
          onUnit={changeUnit}
          onClear={() => clearGroup(g)}
        />
      ))}
    </MarkersCard>
  );
}

interface GroupProps {
  group: MarkerGroupId;
  draft: GroupDraft;
  rows: Record<MarkerId, RowDraft>;
  evals: Record<MarkerId, RowEval>;
  today: string;
  wide: boolean;
  onGroup: (p: Partial<GroupDraft>) => void;
  onRow: (id: MarkerId, p: Partial<RowDraft>) => void;
  onUnit: (id: MarkerId, unit: string) => void;
  onClear: () => void;
}

function MarkerGroup({ group, draft, rows, evals, today, wide, onGroup, onRow, onUnit, onClear }: GroupProps) {
  const auto = useId();
  const panelId = `${auto}-panel`;
  const ids = markersOfGroup(group);
  const label = GROUP_LABEL[group];
  const entered = ids.filter((id) => evals[id].n !== null).length;
  const dateText = formatMarkerDate(draft.date);
  return (
    <section className="lm-mk-group" data-open={draft.open || undefined} aria-label={label}>
      <h3 className="lm-mk-group__head">
        <button type="button" className="lm-mk-group__toggle" aria-expanded={draft.open} aria-controls={panelId} aria-label={`${label} · ${M.table.entered(entered, ids.length)}`} onClick={() => onGroup({ open: !draft.open })}>
          <span aria-hidden="true" className={cx('lm-ik-why__chev', draft.open && 'is-open')}>
            ▾
          </span>
          <span className="lm-mk-group__name">{label}</span>
          <span className="lm-mk-group__count">{M.table.entered(entered, ids.length)}</span>
        </button>
      </h3>
      <div id={panelId} hidden={!draft.open} className="lm-mk-group__panel">
        <div className="lm-mk-group__bar">
          <label className="lm-mk-inline">
            <span className="lm-mk-inline__label">{M.table.testedOn}</span>
            <MarkerDateInput value={draft.date} max={today} onChange={(date) => onGroup({ date })} label={M.table.dateLabel(label)} />
          </label>
          {FASTING_GROUPS.has(group) ? (
            <span className="lm-mk-inline">
              <span className="lm-mk-inline__label" aria-hidden="true">
                {M.table.fasting}
              </span>
              <KeyBank<Fasting>
                size="md"
                label={M.table.fastingLabel(label)}
                value={draft.fasting}
                onChange={(fasting) => onGroup({ fasting })}
                options={[
                  { value: 'yes', label: M.table.fastingOptions.yes },
                  { value: 'no', label: M.table.fastingOptions.no },
                  { value: 'unsure', label: M.table.fastingOptions.unsure },
                ]}
              />
            </span>
          ) : null}
          {entered > 0 ? (
            <Key variant="quiet" size="sm" onClick={onClear} aria-label={M.table.clearLabel(label)} className="lm-mk-group__clear">
              {M.table.clear}
            </Key>
          ) : null}
        </div>
        {wide ? (
          <div className="lm-mk-scroll">
            <table className="lm-mk-table">
              <caption className="lm-sr">{label}</caption>
              <thead>
                <tr>
                  <th scope="col">{M.table.cols.marker}</th>
                  <th scope="col" className="lm-mk-num-col">
                    {M.table.cols.value}
                  </th>
                  <th scope="col">{M.table.cols.unit}</th>
                  <th scope="col">{M.table.cols.range}</th>
                  <th scope="col" className="lm-mk-col-date">
                    {M.table.cols.date}
                  </th>
                  <th scope="col">{M.table.cols.status}</th>
                </tr>
              </thead>
              {ids.map((id) => (
                <MarkerRowWide key={id} id={id} d={rows[id]} e={evals[id]} date={dateText} onRow={(p) => onRow(id, p)} onUnit={(u) => onUnit(id, u)} />
              ))}
            </table>
          </div>
        ) : (
          <div className="lm-mk-blocks">
            {ids.map((id) => (
              <MarkerRowBlock key={id} id={id} d={rows[id]} e={evals[id]} date={dateText} onRow={(p) => onRow(id, p)} onUnit={(u) => onUnit(id, u)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  id: MarkerId;
  d: RowDraft;
  e: RowEval;
  date: string;
  onRow: (p: Partial<RowDraft>) => void;
  onUnit: (unit: string) => void;
}

function useRowIds(id: MarkerId) {
  const auto = useId();
  return { err: `${auto}-${id}-err`, ask: `${auto}-${id}-ask`, conv: `${auto}-${id}-conv`, status: `${auto}-${id}-status` };
}

function ValueInput({ id, d, e, onRow, ids }: Pick<RowProps, 'id' | 'd' | 'e' | 'onRow'> & { ids: ReturnType<typeof useRowIds> }) {
  const label = MARKER_UNITS[id].label;
  const showErr = d.touched && e.blocked;
  const showAsk = d.touched && e.ask;
  const described = [showErr ? ids.err : null, showAsk ? ids.ask : null, ids.conv, ids.status].filter(Boolean).join(' ');
  return (
    <TextInput
      className="lm-mk-num"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={d.value}
      aria-label={M.table.value(label)}
      aria-invalid={showErr || undefined}
      aria-describedby={described}
      onChange={(ev) => onRow({ value: ev.target.value, keep: false, relabelled: false })}
      onBlur={() => onRow({ touched: true })}
    />
  );
}

function UnitSelect({ id, d, onUnit }: Pick<RowProps, 'id' | 'd' | 'onUnit'>) {
  const units = unitsOf(id);
  if (units.length === 1) return <span className="lm-mk-unit-only">{units[0]}</span>;
  return <Select value={d.unit} onChange={onUnit} label={M.table.unit(MARKER_UNITS[id].label)} options={units.map((u) => ({ value: u, label: u }))} className="lm-mk-unit" />;
}

function RangeInputs({ id, d, onRow }: Pick<RowProps, 'id' | 'd' | 'onRow'>) {
  const label = MARKER_UNITS[id].label;
  return (
    <span className="lm-mk-range">
      {d.textMode ? (
        <TextInput className="lm-mk-range__text" value={d.text} placeholder={M.table.rangeTextPlaceholder} aria-label={M.table.rangeText(label)} maxLength={60} onChange={(ev) => onRow({ text: ev.target.value })} />
      ) : (
        <span className="lm-mk-range__nums">
          <TextInput className="lm-mk-num lm-mk-num--range" inputMode="decimal" autoComplete="off" value={d.low} aria-label={M.table.low(label)} onChange={(ev) => onRow({ low: ev.target.value })} />
          <span aria-hidden="true">–</span>
          <TextInput className="lm-mk-num lm-mk-num--range" inputMode="decimal" autoComplete="off" value={d.high} aria-label={M.table.high(label)} onChange={(ev) => onRow({ high: ev.target.value })} />
        </span>
      )}
      <button type="button" className="lm-mk-link" onClick={() => onRow({ textMode: !d.textMode })}>
        {d.textMode ? M.table.rangeAsNumbers : M.table.rangeAsText}
      </button>
    </span>
  );
}

/** Field error, the "is this right?" question, the conversion line and the Lp(a) note. */
function RowMessages({ id, d, e, onRow, ids }: Pick<RowProps, 'id' | 'd' | 'e' | 'onRow'> & { ids: ReturnType<typeof useRowIds> }) {
  const conv = e.n !== null && !e.blocked ? convertedText(id, e.n, d.unit) : null;
  const msg = e.check && !e.check.ok ? e.check.message : M.table.enterNumber;
  return (
    <>
      <span id={ids.conv} className="lm-mk-conv">
        {conv ? `= ${conv}` : null}
      </span>
      {d.relabelled ? <span className="lm-mk-conv">{M.table.noConvert}</span> : null}
      {d.touched && e.blocked ? <ErrorText id={ids.err}>{msg}</ErrorText> : null}
      {d.touched && e.ask ? (
        <span className="lm-mk-ask" id={ids.ask} role="group" aria-label={msg}>
          <span className="lm-mk-ask__q">{msg}</span>
          <Key size="sm" variant="default" onClick={() => onRow({ keep: true })}>
            {M.table.askYes}
          </Key>
          <Key
            size="sm"
            variant="quiet"
            onClick={(ev) => {
              const row = (ev.currentTarget as HTMLElement).closest('[data-marker-row]');
              row?.querySelector<HTMLInputElement>('input.lm-mk-num')?.focus();
            }}
          >
            {M.table.askEdit}
          </Key>
        </span>
      ) : null}
    </>
  );
}

function MarkerRowWide({ id, d, e, date, onRow, onUnit }: RowProps) {
  const ids = useRowIds(id);
  const spec = MARKER_UNITS[id];
  return (
    <tbody id={`marker-${id}`} data-marker-row={id} className="lm-mk-tr">
      <tr>
        <th scope="row" className="lm-mk-name">
          <span className="lm-mk-name__label">{spec.label}</span>
          <span className="lm-mk-name__plain">{spec.plain}</span>
        </th>
        <td className="lm-mk-num-col">
          <ValueInput id={id} d={d} e={e} onRow={onRow} ids={ids} />
        </td>
        <td>
          <UnitSelect id={id} d={d} onUnit={onUnit} />
        </td>
        <td>
          <RangeInputs id={id} d={d} onRow={onRow} />
        </td>
        <td className="lm-mk-date-cell lm-mk-col-date">{e.n !== null ? date : '—'}</td>
        <td>
          <RangeStatusText status={e.status} id={ids.status} />
        </td>
      </tr>
      <tr className="lm-mk-tr__msg">
        <td />
        <td colSpan={5}>
          <RowMessages id={id} d={d} e={e} onRow={onRow} ids={ids} />
        </td>
      </tr>
    </tbody>
  );
}

function MarkerRowBlock({ id, d, e, date, onRow, onUnit }: RowProps) {
  const ids = useRowIds(id);
  const spec = MARKER_UNITS[id];
  return (
    <fieldset id={`marker-${id}`} data-marker-row={id} className="lm-mk-block">
      <legend className="lm-mk-name">
        <span className="lm-mk-name__label">{spec.label}</span> <span className="lm-mk-name__plain">{spec.plain}</span>
      </legend>
      <div className="lm-mk-block__row">
        <ValueInput id={id} d={d} e={e} onRow={onRow} ids={ids} />
        <UnitSelect id={id} d={d} onUnit={onUnit} />
      </div>
      <RowMessages id={id} d={d} e={e} onRow={onRow} ids={ids} />
      <div className="lm-mk-block__row lm-mk-block__row--range">
        <span className="lm-mk-inline__label">{M.table.cols.range}</span>
        <RangeInputs id={id} d={d} onRow={onRow} />
      </div>
      <div className="lm-mk-block__row lm-mk-block__row--meta">
        <span className="lm-mk-date-cell">{e.n !== null ? date : '—'}</span>
        <RangeStatusText status={e.status} id={ids.status} />
      </div>
    </fieldset>
  );
}
