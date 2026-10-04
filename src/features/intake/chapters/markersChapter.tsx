/**
 * The blood-markers chapter's answer widgets for the intake v3 QuestionCard (design intake-v3 §8; SUITE_SPEC §13.5.5):
 * B0 entry (the statements, shown every time, and the three answers), B1 typed table, B2 report reading and review,
 * and the end receipt with its BecauseChips. The card hosts the prompt, "why we ask", Back and the default line; the
 * bodies (`MarkersEntry`, `MarkersTable`, `MarkersReport`, `MarkersReceipt`) render embedded. Everything is saved through
 * `markers.*` (./markersApi.ts) before the widget commits; nothing but the turns changes in `intake/me`.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from '@/components';
import { MARKER_IDS, type MarkerExtraction, type MarkerId, type MarkersView } from '@/markers';
import { useMarkerDateStyle, useMarkerEvaluation, markersToday } from '@/markers/ui/useMarkers';
import type { WidgetProps } from '../components/widgetTypes';
import { M, currentReadings, savedSummary, type MarkersHas } from './markers';
import { setMarkers } from './markersApi';
import { MarkersEntry } from './markersEntry';
import { MarkersEmbedded } from './markersParts';
import { MarkersReceipt } from './markersReceipt';
import { MarkersReport } from './markersReview';
import { useMarkersDoc } from './markersStore';
import { MarkersTable } from './markersTable';
import './markers.css';

const isMarkerId = (s: string | null): s is MarkerId => s !== null && (MARKER_IDS as readonly string[]).includes(s);

/** Demo extraction for screenshots and local review (development builds only; never in production). */
function useDemoExtraction(enabled: boolean): { attachmentId: string; extraction: MarkerExtraction } | null {
  const [demo, setDemo] = useState<{ attachmentId: string; extraction: MarkerExtraction } | null>(null);
  useEffect(() => {
    let alive = true;
    if (import.meta.env.DEV && enabled) void import('./markersDemo').then((m) => alive && setDemo({ attachmentId: 'demo', extraction: m.DEMO_EXTRACTION }));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return demo;
}

/** `has` (B0): skipping is saved as "skipped by choice" on the markers document, then committed as the answer. */
export function MarkersEntryWidget({ value, onCommit }: WidgetProps<MarkersHas>) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<MarkersHas | undefined>(value);
  const choose = async (v: MarkersHas) => {
    setPicked(v);
    if (v !== 'skip') return onCommit(v);
    setBusy(true);
    const r = await setMarkers({ readings: [], chapter: 'skipped' });
    setBusy(false);
    if (!r.ok) return void toast(M.table.saveFailed);
    onCommit('skip');
  };
  return (
    <MarkersEmbedded.Provider value>
      <MarkersEntry value={picked} busy={busy} onChoose={(v) => void choose(v)} />
    </MarkersEmbedded.Provider>
  );
}

/** `manual` (B1): the typed table; commits the saved summary ("4 values · lipids"). `?edit=<marker>` focuses a row. */
export function MarkersTableWidget({ onCommit }: WidgetProps<string>) {
  const mdoc = useMarkersDoc();
  const [params] = useSearchParams();
  const edit = params.get('edit');
  return (
    <MarkersEmbedded.Provider value>
      <MarkersTable
        initial={mdoc ? currentReadings(mdoc) : []}
        {...(isMarkerId(edit) ? { focusMarker: edit } : {})}
        today={markersToday()}
        onSaved={(v) => onCommit(v ? savedSummary(v.doc) : '')}
      />
    </MarkersEmbedded.Provider>
  );
}

/** `report` (B2): report reading and review; "Type instead" swaps in the table in place. */
export function MarkersReportWidget({ onCommit }: WidgetProps<string>) {
  const [typing, setTyping] = useState(false);
  const [params] = useSearchParams();
  const demo = useDemoExtraction(params.get('demo') === 'review');
  const done = (v: MarkersView | null) => onCommit(v ? savedSummary(v.doc) : '');
  return (
    <MarkersEmbedded.Provider value>
      {typing ? (
        <MarkersTable today={markersToday()} onSaved={done} />
      ) : (
        <MarkersReport key={demo ? 'demo' : 'live'} today={markersToday()} onSaved={done} onTypeInstead={() => setTyping(true)} {...(demo ? { initialExtraction: demo } : {})} />
      )}
    </MarkersEmbedded.Provider>
  );
}

/** The end of the chapter (§8.4): saved values per group and what they change in the plan, with BecauseChips. */
export function MarkersChapterReceipt({ onChange }: { onChange: () => void }) {
  const mdoc = useMarkersDoc();
  const today = markersToday();
  const { evaluation } = useMarkerEvaluation(today);
  const dateStyle = useMarkerDateStyle();
  // skipped: the answered list's row already says so
  if (!mdoc || mdoc.chapter === null || mdoc.chapter === 'skipped') return null;
  return <MarkersReceipt doc={mdoc} notes={evaluation.notes} dateStyle={dateStyle} today={today} onChange={onChange} />;
}
