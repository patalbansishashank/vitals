/**
 * The blood-markers chapter's answer widgets for the registry (`./index.ts`), loaded on first use: the widgets read
 * reports, dispatch `markers.*` and evaluate the rules, none of which Your body, the summary or the Coach's intake view
 * need. The QuestionCard renders them under Suspense.
 */
import { lazy, type ComponentType } from 'react';

const load = () => import('./markersChapter');
export const INTAKE_WIDGETS: Readonly<Record<string, ComponentType<never>>> = {
  markersEntry: lazy(() => load().then((m) => ({ default: m.MarkersEntryWidget }))) as ComponentType<never>,
  markersTable: lazy(() => load().then((m) => ({ default: m.MarkersTableWidget }))) as ComponentType<never>,
  markersReport: lazy(() => load().then((m) => ({ default: m.MarkersReportWidget }))) as ComponentType<never>,
};
