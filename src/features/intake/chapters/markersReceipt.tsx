/**
 * The markers chapter's end receipt (design intake-v3 §8.4): one row per group and test date ("lipids · LDL 192,
 * HDL 41 mg/dL · 14 Sep 2026") with Change, then "What these change in your plan": one line per active note with its
 * BecauseChip (short form when the line is narrow, never cut with "…"). Rule wording comes from the interaction table through the notes; the screen never writes it. Lines a
 * doctor should see are a caution notice, never a block.
 */
import { Key, Notice } from '@/components';
import { MARKER_UNITS, type MarkerNote, type MarkersDoc } from '@/markers';
import type { DateStyle } from '@/markers';
import { BecauseChip } from '@/markers/ui/BecauseChip';
import { M, currentReadings, groupReceipts } from './markers';

export interface MarkersReceiptProps {
  doc: MarkersDoc;
  notes: readonly MarkerNote[];
  dateStyle?: DateStyle;
  today?: string;
  /** Change a group's values (opens the table) or, when skipped, the entry answer. */
  onChange: () => void;
}

export function MarkersReceipt({ doc, notes, dateStyle = 'day-month', today, onChange }: MarkersReceiptProps) {
  const skipped = doc.chapter === 'skipped';
  const rows = skipped ? [] : groupReceipts(currentReadings(doc), dateStyle);
  // one doctor line per marker (several rules may name the same reading)
  const clinician = notes.filter((n, i, all) => n.kind === 'clinician' && all.findIndex((m) => m.kind === 'clinician' && m.markerId === n.markerId) === i);
  const plan = notes.filter((n) => n.kind !== 'clinician');
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
