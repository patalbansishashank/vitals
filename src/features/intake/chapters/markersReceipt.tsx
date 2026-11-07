/**
 * The markers chapter's end receipt (design intake-v3 §8.4): one row per group and test date ("lipids · LDL 192,
 * HDL 41 mg/dL · 14 Sep 2026") with Change, then "What these change in your plan": one line per active note with its
 * BecauseChip (short form when the line is narrow, never cut with "…"). Rule wording comes from the interaction table through the notes; the screen never writes it. Lines a
 * doctor should see are a caution notice, never a block.
 * C6 statuses (D7-01, D7-02): a rule whose population or sample facts are not established reads "Needs context" (never
 * a match), and an eGFR without its /1.73 m² index reads "Unit unclear"; the values themselves stay exactly as entered.
 * D7-05: a reading due for a repeat or under review reads "Repeat due" / "Review" (its value and date stay as entered);
 * D7-06/D7-09: a fasting glucose or insulin reading without a stated fasting sample reads "Fasting unknown" (kept, never
 * classified as a fasting value). Why opens in the marker details, not here.
 */
import { Key, Notice } from '@/components';
import { MARKER_UNITS, freshnessOf, markerReviewStates, type MarkerEvaluation, type MarkerNote, type MarkerReading, type MarkersDoc } from '@/markers';
import type { DateStyle } from '@/markers';
import { BecauseChip } from '@/markers/ui/BecauseChip';
import { useMarkerEvaluation } from '@/markers/ui/useMarkers';
import { markersToday } from '@/markers/ui/markersDoc';
import { M, currentReadings, groupReceipts } from './markers';
import { GFR_UNIT_UNCLEAR, applicabilityLines, gfrUnitUnclear } from './markersStatus';

export interface MarkersReceiptProps {
  doc: MarkersDoc;
  notes: readonly MarkerNote[];
  dateStyle?: DateStyle;
  today?: string;
  /** Change a group's values (opens the table) or, when skipped, the entry answer. */
  onChange: () => void;
  /**
   * Rules whose applicability the evaluation could not establish (D7-01): shown as "Needs context". Absent: read from the
   * current marker evaluation (the same one whose notes the receipt shows).
   */
  applicability?: MarkerEvaluation['applicability'];
}

/** Status word of a glycaemic sample whose fasting state was not stated (D7-06/D7-09). */
export const FASTING_UNKNOWN = 'Fasting unknown';
const FASTING_MARKERS: ReadonlySet<string> = new Set(['fpg', 'insulin']);
const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)];

/** True when a fasting glucose / insulin reading carries no stated fasting state (hours, status or the legacy flag). */
export function fastingUnknown(r: Pick<MarkerReading, 'id' | 'fasting' | 'fastingHours' | 'fastingStatus'>): boolean {
  if (!FASTING_MARKERS.has(r.id)) return false;
  if (r.fastingStatus === 'fasting' || r.fastingStatus === 'nonFasting') return false;
  if (typeof r.fastingHours === 'number' && Number.isFinite(r.fastingHours)) return false;
  return r.fasting !== true && r.fasting !== false;
}

export function MarkersReceipt({ doc, notes, dateStyle = 'day-month', today, onChange, applicability: given }: MarkersReceiptProps) {
  const { evaluation } = useMarkerEvaluation(today ?? markersToday());
  const applicability = given ?? evaluation.applicability;
  const skipped = doc.chapter === 'skipped';
  const rows = skipped ? [] : groupReceipts(currentReadings(doc), dateStyle);
  // one doctor line per marker (several rules may name the same reading)
  const clinician = notes.filter((n, i, all) => n.kind === 'clinician' && all.findIndex((m) => m.kind === 'clinician' && m.markerId === n.markerId) === i);
  const plan = notes.filter((n) => n.kind !== 'clinician');
  // short statuses: unresolved population/sample applicability, and an eGFR whose indexing is not confirmed
  const label = (id: string) => MARKER_UNITS[id as keyof typeof MARKER_UNITS]?.label ?? id;
  const statuses = skipped
    ? []
    : dedupe([
        ...applicabilityLines(applicability).map((l) => l.text),
        ...(currentReadings(doc).some((r) => gfrUnitUnclear(r.id, r.unit) && r.quantityKind !== 'egfrIndexed') ? [`${MARKER_UNITS.egfr.label} · ${GFR_UNIT_UNCLEAR}`] : []),
        // D7-05: freshness and unresolved history, separately from the value (a current reading says nothing here)
        ...markerReviewStates(doc, freshnessOf(doc, today ?? markersToday()), evaluation)
          .filter((v) => v.label !== 'Current')
          .map((v) => `${label(v.markerId)} · ${v.label}`),
        ...currentReadings(doc)
          .filter(fastingUnknown)
          .map((r) => `${label(r.id)} · ${FASTING_UNKNOWN}`),
      ]);
  return (
    <section className="lm-mk-receipt" aria-label={M.receipt.title}>
      <ol className="lm-ik-receipts lm-mk-receipt__rows">
        {skipped ? (
          <ReceiptRow question={M.has.short} answer={currentReadings(doc).length ? M.receipt.skippedKept(currentReadings(doc).length) : M.receipt.skipped} onChange={onChange} />
        ) : (
          rows.map((r) => <ReceiptRow key={`${r.group}-${r.date}`} question={M.has.short} answer={r.text} onChange={onChange} />)
        )}
      </ol>
      {skipped ? null : (
        <>
          {clinician.map((n) => (
            <Notice key={`${n.rule}-${n.markerId}`} severity="caution" layout="ruled" title={M.receipt.clinician(MARKER_UNITS[n.markerId]?.label ?? n.because.label)}>
              <BecauseChip note={n} form="container" dateStyle={dateStyle} {...(today ? { today } : {})} />
            </Notice>
          ))}
          {statuses.length ? (
            <ul className="lm-mk-effects">
              {statuses.map((t) => (
                <li key={t} className="lm-mk-effect">
                  <span className="lm-mk-effect__text">{t}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <h3 className="lm-mk-sub">{M.receipt.effects}</h3>
          {plan.length ? (
            <ul className="lm-mk-effects">
              {plan.map((n) => (
                <li key={`${n.rule}-${n.markerId}`} className="lm-mk-effect">
                  <span className="lm-mk-effect__text">{n.text}</span>
                  <BecauseChip note={n} form="container" dateStyle={dateStyle} {...(today ? { today } : {})} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="lm-mk-note">{M.receipt.noEffects}</p>
          )}
        </>
      )}
    </section>
  );
}

function ReceiptRow({ question, answer, onChange }: { question: string; answer: string; onChange: () => void }) {
  return (
    <li className="lm-ik-receipt lm-mk-receipt__row">
      <span className="lm-ik-receipt__dot" aria-hidden="true" />
      <span className="lm-ik-receipt__q">{question}</span>
      <span className="lm-ik-receipt__a">{answer}</span>
      <Key variant="quiet" size="sm" className="lm-ik-receipt__change" onClick={onChange} aria-label={M.receipt.changeLabel(answer)}>
        {M.receipt.change}
      </Key>
    </li>
  );
}
