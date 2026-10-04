/**
 * B2 · reading a report (design intake-v3 §8.3): choose a PDF or photo (stored on this device), read it with
 * `markers.import` (text PDFs on the device; pages without text and photos go to the AI provider only after the
 * consent line), a few questions about the test, then the review table. Every row starts unticked; "Tick all
 * high-confidence" is a visible action the person takes; calculated rows and everything Vitals does not plan on are
 * shown, never confirmable. Only ticked rows go to `markers.confirm`. Nothing is accepted silently.
 */
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Chip, ErrorText, Key, KeyBank, Notice, ProgressRule, Select, TextInput, toast, useMediaQuery, MQ } from '@/components';
import { readAiConfig } from '@/commands/ai/config';
import { getPreset } from '@/ai/providers/presets';
import { useCoachAvailable } from '@/features/living/coach/availability';
import { MARKER_UNITS, checkBounds, formatMarkerDate, unitsOf, type ExtractionRow, type MarkerContext, type MarkerExtraction, type MarkerId, type MarkersView } from '@/markers';
import { FASTING_GROUPS, M, acceptedUnit, confidenceLevel, convertedText, isConfirmable, parseTyped, todayIso, type ConfidenceLevel } from './markers';
import { confirmExtraction, deleteReport, hasCommand, importReport, storeReport, type ConfirmInput, type ImportHandle } from './markersApi';
import { CardFootSlot } from '../components/widgetTypes';
import { MarkerDateInput, MarkersCard, MarkersFoot } from './markersParts';

/* ------------------------------------------------------------------------------------------- provider */

/** The connected AI provider's name, or null when none can read images. */
function useProvider(): string | null {
  const available = useCoachAvailable();
  if (!available) return null;
  const cfg = readAiConfig();
  if (!cfg) return null;
  return getPreset(cfg.presetId)?.label ?? 'your AI provider';
}

/* ------------------------------------------------------------------------------------------- the flow */

type Stage =
  | { k: 'choose' }
  | { k: 'consent'; attachmentId: string; photo: boolean; pages: number }
  | { k: 'reading'; attachmentId: string; text: string; progress?: number }
  | { k: 'error'; kind: 'noText' | 'notReport' | 'failed' | 'unavailable' | 'photoNoProvider'; attachmentId?: string }
  | { k: 'review'; attachmentId: string; extraction: MarkerExtraction };

export interface MarkersReportProps {
  onSaved: (view: MarkersView | null) => void;
  onBack?: () => void;
  /** "Type the values" / "Type instead": switch to the manual table. */
  onTypeInstead: () => void;
  today?: string;
  /** Tests and screenshots: start at the review table with this extraction. */
  initialExtraction?: { attachmentId: string; extraction: MarkerExtraction };
}

export function MarkersReport({ onSaved, onBack, onTypeInstead, today = todayIso(), initialExtraction }: MarkersReportProps) {
  const provider = useProvider();
  const [stage, setStage] = useState<Stage>(() => (initialExtraction ? { k: 'review', ...initialExtraction } : { k: 'choose' }));
  const handle = useRef<ImportHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => handle.current?.cancel(), []);

  const read = async (attachmentId: string, allowVision: boolean) => {
    setStage({ k: 'reading', attachmentId, text: M.report2.reading });
    const h = importReport(attachmentId, {
      allowVision,
      onProgress: (p) => setStage((s) => (s.k === 'reading' ? { ...s, text: p.stage ?? s.text, progress: p.progress } : s)),
    });
    handle.current = h;
    const r = await h.result;
    handle.current = null;
    if (!r.ok) {
      if (r.code === 'cancelled') setStage({ k: 'choose' });
      else setStage({ k: 'error', kind: r.code === 'invalid_input' ? 'notReport' : 'failed', attachmentId });
      return;
    }
    const ex = r.value;
    const unread = ex.unreadPages?.length ?? 0;
    const found = ex.rows.length + ex.displayOnly.length;
    if (unread > 0 && !allowVision && provider) {
      setStage({ k: 'consent', attachmentId, photo: false, pages: unread });
      return;
    }
    if (found === 0) {
      setStage({ k: 'error', kind: unread > 0 ? (provider ? 'failed' : 'noText') : 'notReport', attachmentId });
      return;
    }
    setStage({ k: 'review', attachmentId, extraction: ex });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!hasCommand('markers.import')) {
      setStage({ k: 'error', kind: 'unavailable' });
      return;
    }
    const photo = file.type.startsWith('image/');
    if (photo && !provider) {
      setStage({ k: 'error', kind: 'photoNoProvider' });
      return;
    }
    const stored = await storeReport(file);
    if (!stored.ok) {
      setStage({ k: 'error', kind: 'failed' });
      return;
    }
    if (photo) setStage({ k: 'consent', attachmentId: stored.value, photo: true, pages: 1 });
    else void read(stored.value, false);
  };

  const chooseAgain = () => {
    setStage({ k: 'choose' });
    queueMicrotask(() => fileRef.current?.click());
  };

  if (stage.k === 'review') {
    return <ReviewTable extraction={stage.extraction} attachmentId={stage.attachmentId} today={today} onSaved={onSaved} onBack={() => setStage({ k: 'choose' })} />;
  }

  const back = onBack ? (
    <div className="lm-mk-footrow">
      <Key variant="default" onClick={onBack}>
        ‹ {M.table.back}
      </Key>
    </div>
  ) : null;

  return (
    <MarkersCard prompt={M.report.prompt} skipText={M.report.skipText} footer={back} id="ik-markers-report">
      {stage.k === 'choose' || stage.k === 'error' ? (
        <div className="lm-mk-file">
          <label className="lm-key lm-mk-file__key" data-variant="default" data-size="md">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              className="lm-sr"
              aria-label={M.report2.chooseLabel}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void onFile(f);
              }}
            />
            <span className="lm-key__label">{M.report2.choose}</span>
          </label>
          <p className="lm-mk-note">{M.report2.privacy}</p>
        </div>
      ) : null}
      {stage.k === 'error' ? <ReportError kind={stage.kind} onTypeInstead={onTypeInstead} onChooseAnother={chooseAgain} onRetry={stage.attachmentId ? () => void read(stage.attachmentId!, false) : undefined} /> : null}
      {stage.k === 'consent' ? (
        <div className="lm-mk-consent" role="group" aria-label={M.report2.consent(stage.pages, provider ?? '', stage.photo)}>
          <p className="lm-mk-consent__line">{M.report2.consent(stage.pages, provider ?? 'your AI provider', stage.photo)}</p>
          <span className="lm-mk-footrow__right">
            <Key variant="quiet" onClick={onTypeInstead}>
              {M.report2.typeInstead}
            </Key>
            <Key variant="solid" onClick={() => void read(stage.attachmentId, true)}>
              {M.report2.send}
            </Key>
          </span>
        </div>
      ) : null}
      {stage.k === 'reading' ? (
        <div className="lm-mk-reading">
          <ProgressRule label={stage.text} reducedText={stage.text} {...(stage.progress !== undefined && stage.progress > 0 ? { value: stage.progress } : {})} />
          <p className="lm-mk-reading__text" role="status">
            {stage.text}
          </p>
          <Key variant="quiet" onClick={() => handle.current?.cancel()}>
            {M.report2.cancel}
          </Key>
        </div>
      ) : null}
    </MarkersCard>
  );
}

function ReportError({ kind, onTypeInstead, onChooseAnother, onRetry }: { kind: Extract<Stage, { k: 'error' }>['kind']; onTypeInstead: () => void; onChooseAnother: () => void; onRetry?: () => void }) {
  const title =
    kind === 'noText' ? M.report2.noTextNoProvider : kind === 'notReport' ? M.report2.notReport : kind === 'photoNoProvider' ? M.report2.photoNeedsProvider : kind === 'unavailable' ? M.report2.unavailable : M.report2.failed;
  const actions =
    kind === 'notReport' ? (
      <Key size="sm" onClick={onChooseAnother}>
        {M.report2.chooseAnother}
      </Key>
    ) : (
      <>
        {kind === 'failed' && onRetry ? (
          <Key size="sm" onClick={onRetry}>
            {M.report2.tryAgain}
          </Key>
        ) : null}
        <Key size="sm" onClick={onTypeInstead}>
          {M.report2.typeValues}
        </Key>
      </>
    );
  return <Notice severity="caution" layout="ruled" title={title} actions={actions} announce />;
}

/* ------------------------------------------------------------------------------------------- review */

type YesNo = 'yes' | 'no';
type Fasting = 'yes' | 'no' | 'unsure';
type Med = 'thyroid' | 'metformin' | 'ppi' | 'none';

interface ContextDraft {
  date: string;
  fasting?: Fasting;
  creatine?: YesNo;
  ill?: YesNo;
  hard?: YesNo;
  meds: Med[];
}

interface RowDraft {
  ticked: boolean;
  editing: boolean;
  value: string;
  unit: string;
}

interface RowView {
  row: ExtractionRow & { markerId: MarkerId };
  level: ConfidenceLevel;
  n: number | null;
  unit: string | null;
  /** Outside plausibility, or no value/unit: cannot be ticked until edited. */
  tickable: boolean;
  why: string | null;
  ask: string | null;
}

function viewRow(row: ExtractionRow & { markerId: MarkerId }, d: RowDraft): RowView {
  const n = parseTyped(d.value);
  const unit = acceptedUnit(row.markerId, d.unit);
  const level = confidenceLevel(row.confidence);
  if (n === null || !unit) return { row, level, n, unit, tickable: false, why: M.report2.tickNeedsValue, ask: null };
  const b = checkBounds(row.markerId, n, unit);
  if (!b.ok && b.level === 'block') return { row, level, n, unit, tickable: false, why: b.message, ask: null };
  return { row, level, n, unit, tickable: true, why: null, ask: !b.ok ? b.message : null };
}

const yesNo = (v: YesNo | undefined): boolean | undefined => (v === undefined ? undefined : v === 'yes');

export function contextOf(c: ContextDraft): MarkerContext {
  const out: MarkerContext = {};
  const set = <K extends keyof MarkerContext>(k: K, v: MarkerContext[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('creatineLast2w', yesNo(c.creatine));
  set('recentIllness', yesNo(c.ill));
  set('hardTraining48h', yesNo(c.hard));
  if (c.meds.length) {
    out.thyroidMeds = c.meds.includes('thyroid');
    out.metformin = c.meds.includes('metformin');
    out.ppi = c.meds.includes('ppi');
  }
  return out;
}

/** The ticked rows and the answers about the test, as `markers.confirm` takes them (without the extraction id). */
export type ReviewApply = Omit<ConfirmInput, 'extractionId'>;

interface ReviewProps {
  extraction: MarkerExtraction;
  attachmentId: string;
  today: string;
  onSaved?: (view: MarkersView | null) => void;
  /** Back to choosing a file; no Back key when absent (the Coach's card). */
  onBack?: () => void;
  /**
   * The Coach's report card: the save key hands the ticked rows to the card's Apply (`CardActionExtra.markers`) instead
   * of saving here; no Back and no delete-file key. A failed result shows its message like a failed save.
   */
  onApply?: (input: ReviewApply) => Promise<{ ok: boolean; message?: string } | void> | void;
}

export function ReviewTable({ extraction, attachmentId, today, onSaved, onBack, onApply }: ReviewProps) {
  const wide = useMediaQuery(MQ.md);
  const slotted = useContext(CardFootSlot) !== null;
  const confirmable = useMemo(() => extraction.rows.filter(isConfirmable), [extraction]);
  const shown = useMemo(() => {
    const fromRows = extraction.rows.filter((r) => !isConfirmable(r)).map((r) => ({ name: r.nameOnReport, value: r.value === null ? '' : String(r.value), unit: r.unit ?? '', calculated: r.calculated }));
    const fromDisplay = extraction.displayOnly.map((r) => ({ name: r.name, value: r.value, unit: r.unit ?? '', calculated: false }));
    return [...fromRows, ...fromDisplay];
  }, [extraction]);
  const [rows, setRows] = useState<Record<number, RowDraft>>(() =>
    Object.fromEntries(confirmable.map((r) => [r.row, { ticked: false, editing: false, value: r.value === null ? '' : String(r.value), unit: acceptedUnit(r.markerId, r.unit) ?? r.unit ?? '' }])),
  );
  const [ctx, setCtx] = useState<ContextDraft>({ date: extraction.sampleDate && extraction.sampleDate <= today ? extraction.sampleDate : today, meds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileGone, setFileGone] = useState(false);

  const views = confirmable.map((r) => viewRow(r, rows[r.row]!));
  const highs = views.filter((v) => v.level === 'high' && v.tickable);
  const ticked = views.filter((v) => rows[v.row.row]!.ticked && v.tickable);
  const unread = extraction.unreadPages?.length ?? 0;

  const patch = (row: number, p: Partial<RowDraft>) => setRows((s) => ({ ...s, [row]: { ...s[row]!, ...p } }));
  const tickHigh = () => setRows((s) => ({ ...s, ...Object.fromEntries(highs.map((v) => [v.row.row, { ...s[v.row.row]!, ticked: true }])) }));

  const save = async () => {
    if (!ticked.length) return;
    const fasting = ctx.fasting && ctx.fasting !== 'unsure' ? ctx.fasting === 'yes' : undefined;
    const accept: ConfirmInput['accept'] = ticked.map((v) => {
      const r = v.row;
      const valueChanged = v.n !== r.value;
      const unitChanged = v.unit !== r.unit;
      const f = fasting !== undefined && FASTING_GROUPS.has(MARKER_UNITS[r.markerId].group) ? { fasting } : {};
      return { row: r.row, ...(valueChanged ? { value: v.n! } : {}), ...(unitChanged ? { unit: v.unit! } : {}), date: ctx.date, ...f };
    });
    setBusy(true);
    setError(null);
    if (onApply) {
      const r = await onApply({ accept, context: contextOf(ctx) });
      setBusy(false);
      if (r && !r.ok) setError(r.message ? `${M.report2.saveFailed} ${r.message}` : M.report2.saveFailed);
      return;
    }
    const res = await confirmExtraction({ extractionId: extraction.extractionId, accept, context: contextOf(ctx) });
    setBusy(false);
    if (!res.ok) {
      setError(res.message && res.message !== 'pending' ? `${M.report2.saveFailed} ${res.message}` : M.report2.saveFailed);
      return;
    }
    onSaved?.(res.value);
  };

  const remove = async () => {
    const r = await deleteReport(attachmentId);
    if (r.ok) {
      setFileGone(true);
      toast(M.report2.fileDeleted);
    } else toast(M.report2.deleteUnavailable);
  };

  const footer = (
    <MarkersFoot
      notice={error ? <Notice severity="danger" layout="ruled" title={error} announce /> : null}
      left={
        <>
          {onBack ? (
            <Key variant="default" onClick={onBack}>
              {/* inside the intake card its own Back (to the previous question) is already there */}
              {slotted ? M.report2.chooseAnother : `‹ ${M.table.back}`}
            </Key>
          ) : null}
          {!fileGone && !onApply ? (
            <Key variant="quiet" onClick={() => void remove()}>
              {M.report2.deleteFile}
            </Key>
          ) : null}
        </>
      }
      right={
        <Key variant="solid" onClick={() => void save()} disabledReason={ticked.length ? undefined : M.report2.saveNone} loading={busy}>
          {M.report2.save(ticked.length)}
        </Key>
      }
      reason={ticked.length ? null : M.report2.saveNone}
    />
  );

  return (
    <MarkersCard prompt={M.report2.reviewLead} footer={footer} id="ik-markers-review" className="lm-mk-card--wide">
      <ContextQuestions value={ctx} onChange={setCtx} today={today} />
      {unread > 0 ? <p className="lm-mk-note">{M.report2.partial(unread)}</p> : null}
      <div className="lm-mk-review__bar">
        <Key variant="default" size="sm" onClick={tickHigh} disabled={highs.length === 0}>
          {M.report2.tickHigh(highs.length)}
        </Key>
      </div>
      {wide ? (
        <div className="lm-mk-scroll">
          <table className="lm-mk-table lm-mk-table--review">
            <caption className="lm-sr">{M.report2.reviewLead}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="lm-sr">{M.report2.cols.tick}</span>
                </th>
                <th scope="col">{M.report2.cols.marker}</th>
                <th scope="col">{M.report2.cols.asRead}</th>
                <th scope="col">{M.report2.cols.converted}</th>
                <th scope="col">{M.report2.cols.range}</th>
                <th scope="col">{M.report2.cols.date}</th>
                <th scope="col">{M.report2.cols.confidence}</th>
                <th scope="col">
                  <span className="lm-sr">{M.report2.edit}</span>
                </th>
              </tr>
            </thead>
            {views.map((v) => (
              <ReviewRow key={v.row.row} v={v} d={rows[v.row.row]!} date={ctx.date} wide onPatch={(p) => patch(v.row.row, p)} />
            ))}
          </table>
        </div>
      ) : (
        <ul className="lm-mk-rblocks">
          {views.map((v) => (
            <ReviewRow key={v.row.row} v={v} d={rows[v.row.row]!} date={ctx.date} wide={false} onPatch={(p) => patch(v.row.row, p)} />
          ))}
        </ul>
      )}
      {extraction.notInReport.length ? (
        <ul className="lm-mk-missing">
          {extraction.notInReport.map((id) => (
            <li key={id}>{M.report2.notInReport(MARKER_UNITS[id as MarkerId]?.label ?? id)}</li>
          ))}
        </ul>
      ) : null}
      {shown.length ? (
        <details className="lm-mk-shown">
          <summary>{M.report2.shownNotUsed(shown.length)}</summary>
          <ul>
            {shown.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                <span className="lm-mk-shown__name">{s.name}</span> <span className="lm-mk-shown__value">{[s.value, s.unit].filter(Boolean).join(' ')}</span>
                {s.calculated ? <span className="lm-mk-shown__calc"> · {M.report2.calculatedNote}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </MarkersCard>
  );
}

function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  return (
    <span className="lm-mk-conf" data-level={level}>
      <Chip>
        <span className="lm-sr">read with </span>
        {M.report2.confidence[level]}
        <span className="lm-sr"> confidence</span>
      </Chip>
    </span>
  );
}

function ReviewRow({ v, d, date, wide, onPatch }: { v: RowView; d: RowDraft; date: string; wide: boolean; onPatch: (p: Partial<RowDraft>) => void }) {
  const auto = useId();
  const r = v.row;
  const label = MARKER_UNITS[r.markerId].label;
  const asRead = `${r.value ?? '—'}${r.unit ? ` ${r.unit}` : ''}${r.method ? ` (${r.method})` : ''}`;
  const valueText = v.n !== null ? `${v.n}${v.unit ? ` ${v.unit}` : ''}` : asRead;
  const conv = convertedText(r.markerId, v.n, v.unit) ?? '—';
  const reasonId = `${auto}-reason`;
  const issues = v.level === 'low' && r.issues.length ? r.issues.join('; ') : null;
  const blockMsg = !v.tickable && v.why !== M.report2.tickNeedsValue ? v.why : null;
  const note = [issues, v.tickable ? v.ask : blockMsg ? null : v.why].filter((x): x is string => Boolean(x)).join(' · ');
  const reasons = [note, blockMsg].filter(Boolean);
  const check = (
    <input
      type="checkbox"
      className="lm-mk-check"
      checked={d.ticked && v.tickable}
      disabled={!v.tickable}
      aria-label={M.report2.tickLabel(label, valueText)}
      aria-describedby={reasons.length ? reasonId : undefined}
      onChange={(e) => onPatch({ ticked: e.target.checked })}
    />
  );
  const editKey = (
    <Key size="sm" variant="quiet" onClick={() => onPatch({ editing: !d.editing })} aria-label={d.editing ? M.report2.editDone : M.report2.editLabel(label)} aria-expanded={d.editing}>
      {d.editing ? M.report2.editDone : M.report2.edit}
    </Key>
  );
  const valueCell = d.editing ? (
    <span className="lm-mk-block__row">
      <TextInput className="lm-mk-num" inputMode="decimal" value={d.value} aria-label={M.table.value(label)} aria-invalid={!v.tickable || undefined} onChange={(e) => onPatch({ value: e.target.value, ticked: false })} />
      <Select value={unitsOf(r.markerId).includes(d.unit) ? d.unit : undefined} placeholder={r.unit ?? '—'} onChange={(u) => onPatch({ unit: u, ticked: false })} label={M.table.unit(label)} options={unitsOf(r.markerId).map((u) => ({ value: u, label: u }))} className="lm-mk-unit" />
    </span>
  ) : (
    <span className="lm-mk-tab">{asRead}</span>
  );
  const reasonLine = reasons.length ? (
    <div id={reasonId}>
      {note ? <p className="lm-mk-low">{note}</p> : null}
      {blockMsg ? <ErrorText>{blockMsg}</ErrorText> : null}
    </div>
  ) : null;

  if (wide) {
    return (
      <tbody className="lm-mk-tr" data-level={v.level}>
        <tr>
          <td className="lm-mk-check-cell">{check}</td>
          <th scope="row" className="lm-mk-name">
            <span className="lm-mk-name__label">{label}</span>
            {r.nameOnReport && r.nameOnReport.toLowerCase() !== label.toLowerCase() ? <span className="lm-mk-name__plain">{r.nameOnReport}</span> : null}
          </th>
          <td>{valueCell}</td>
          <td className="lm-mk-tab">{conv}</td>
          <td className="lm-mk-tab">{r.labRange ?? '—'}</td>
          <td className="lm-mk-date-cell">{formatMarkerDate(date)}</td>
          <td>
            <ConfidenceChip level={v.level} />
          </td>
          <td>{editKey}</td>
        </tr>
        {reasonLine ? (
          <tr className="lm-mk-tr__msg">
            <td />
            <td colSpan={7}>{reasonLine}</td>
          </tr>
        ) : null}
      </tbody>
    );
  }
  return (
    <li className="lm-mk-rblock" data-level={v.level}>
      <label className="lm-mk-check-hit">{check}</label>
      <div className="lm-mk-rblock__body">
        <p className="lm-mk-rblock__line">
          <span className="lm-mk-name__label">{label}</span> {d.editing ? null : <span className="lm-mk-tab">{asRead}</span>}
        </p>
        {d.editing ? valueCell : null}
        <p className="lm-mk-rblock__line lm-mk-rblock__line--sub">
          <span>{conv !== '—' ? `= ${conv}` : ''}</span>
          {r.labRange ? <span>{`${M.report2.cols.range} ${r.labRange}`}</span> : null}
        </p>
        <p className="lm-mk-rblock__line lm-mk-rblock__line--meta">
          <span className="lm-mk-date-cell">{formatMarkerDate(date)}</span>
          <ConfidenceChip level={v.level} />
          {editKey}
        </p>
        {reasonLine}
      </div>
    </li>
  );
}

function ContextQuestions({ value, onChange, today }: { value: ContextDraft; onChange: (c: ContextDraft) => void; today: string }) {
  const set = (p: Partial<ContextDraft>) => onChange({ ...value, ...p });
  const yn = [
    { value: 'yes' as const, label: M.report2.yes },
    { value: 'no' as const, label: M.report2.no },
  ];
  const meds: Array<{ v: Med; label: string }> = [
    { v: 'thyroid', label: M.report2.medsOptions.thyroid },
    { v: 'metformin', label: M.report2.medsOptions.metformin },
    { v: 'ppi', label: M.report2.medsOptions.ppi },
    { v: 'none', label: M.report2.medsOptions.none },
  ];
  const toggleMed = (m: Med, on: boolean) => {
    if (m === 'none') return set({ meds: on ? ['none'] : [] });
    const rest = value.meds.filter((x) => x !== m && x !== 'none');
    set({ meds: on ? [...rest, m] : rest });
  };
  return (
    <section className="lm-mk-context" aria-label={M.report2.contextTitle}>
      <h3 className="lm-mk-sub">{M.report2.contextTitle}</h3>
      <div className="lm-mk-context__row">
        <span className="lm-mk-inline__label">{M.report2.testDate}</span>
        <MarkerDateInput value={value.date} max={today} onChange={(date) => set({ date })} label={M.report2.testDate} />
        <span className="lm-mk-note">{M.report2.testDateHelp}</span>
      </div>
      <div className="lm-mk-context__row">
        <span className="lm-mk-inline__label">{M.report2.fasting}</span>
        <KeyBank<Fasting>
          label={M.report2.fasting}
          value={value.fasting}
          onChange={(fasting) => set({ fasting })}
          options={[...yn, { value: 'unsure', label: M.report2.unsure }]}
        />
      </div>
      {(
        [
          ['creatine', M.report2.creatine],
          ['ill', M.report2.ill],
          ['hard', M.report2.hardTraining],
        ] as const
      ).map(([k, label]) => (
        <div className="lm-mk-context__row" key={k}>
          <span className="lm-mk-inline__label">{label}</span>
          <KeyBank<YesNo> label={label} value={value[k]} onChange={(v) => set({ [k]: v })} options={yn} />
        </div>
      ))}
      <div className="lm-mk-context__row">
        <span className="lm-mk-inline__label">{M.report2.meds}</span>
        <span className="lm-mk-chips" role="group" aria-label={M.report2.meds}>
          {meds.map((m) => (
            <Chip key={m.v} kind="filter" pressed={value.meds.includes(m.v)} onPressedChange={(on) => toggleMed(m.v, on)}>
              {m.label}
            </Chip>
          ))}
        </span>
      </div>
    </section>
  );
}
