import { useEffect, useState, type ReactNode } from 'react';
import { BookOpenText } from 'lucide-react';
import {
  CATEGORY_LABEL,
  GradeBadge,
  InlineWarning,
  Key,
  KeyLink,
  ResponsivePanel,
  Spinner,
  VisuallyHidden,
} from '@/components';
import type { Mechanism } from '@/content/evidence/schema';
import { EXPLORATORY_SERIES, GOAL_CAPABILITY, type MetricId, type SeriesId } from '@/engine/types/metrics';
import { STATUS_LABEL, type CapabilityAvailability, type OutputStatus, type UncertaintyKind } from '@/lib/bodyContracts';
import { WARRANT_LABEL, hasWarrantContent, modelStatusLabel, observationText, warrantText } from '@/content/evidence/warrants';
import { sentence } from './copy';
import { Disclaimer } from './components/bits';
import { SourceRefLinks } from './components/SourceRefLinks';
import { useEvidenceRepository, useEvidenceSnapshot, useMechanisms } from './hooks';
import { ARTICLE_SECTIONS, mechanismHref, type EvidenceNavState } from './links';
import { orderForMetric } from './explainOrder';
import { metricInfo } from './metricLabels';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import './evidence.css';

/** Catalogue unit in the user's energy unit ("kcal/d" → "kJ/d", "kcal/kg FFM/d" → "kJ/kg FFM/d"); others unchanged. */
function catalogueUnitIn(unit: string, energy: EnergyUnit): string {
  return energy === 'kJ' ? unit.replace(/^kcal\b/, 'kJ') : unit;
}

export interface ExplainDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Mechanisms to explain (e.g. the ones driving a curve). */
  mechanismIds?: readonly string[];
  /** Or a metric: its catalogue entry plus the mechanisms that list it in `relatedMetricIds`. */
  metricId?: string;
  /** Or a model parameter: the mechanisms that list it in `relatedParamIds`. */
  paramId?: string;
  /** Panel title; defaults to the metric label, the single mechanism's title, or "Explain". */
  title?: ReactNode;
  /**
   * Where "Open in Evidence" should offer to come back to, e.g.
   * `{ to: location.pathname + location.search, label: 'Spring cut results' }`.
   */
  returnTo?: { to: string; label: string };
  /** How many key numbers to show per mechanism (default 3). */
  keyNumbers?: number;
  /**
   * The metric's value where the reader is looking (the crosshair or selected day of a results view), with its unit
   * and range. Omitted = no reading block.
   */
  reading?: ExplainReading | null;
  /** "What is driving it on this day": the related values the caller already has for that moment. */
  drivers?: readonly ExplainDriver[] | null;
  /** Heading of the drivers list (default "What is driving it here"; shown in sentence case). */
  driversTitle?: string;
  /**
   * The metric's unit as the caller displays it (converted to the user's units, e.g. "kJ/d", "lb", "mmol/L vs start").
   * Default: the catalogue unit, with energy in the Settings energy unit.
   */
  unit?: string;
  /** C6 status of the metric in this view (results: the run's series status). */
  status?: ExplainStatus | null;
}

/**
 * The C6 status of what the drawer explains (the info sheet carries the warrant and limits; the operating screen shows
 * only the word): the run's status of the series, the kind of uncertainty its range expresses and why.
 */
export interface ExplainStatus {
  status?: OutputStatus;
  /** What the shown range is (default for a range: a parameter-sensitivity range with unvalidated coverage). */
  uncertaintyKind?: UncertaintyKind;
  /** Short reason ("outside the model's calibration domain", "measured value kept at the start"). */
  reason?: string;
  /**
   * Further info-sheet rows the caller knows (range basis, model-limit stop, time resolution, named assumptions, model or
   * policy version, coverage): label · value pairs, shown under "How to read it" and never on the operating screen.
   */
  details?: ReadonlyArray<{ label: string; value: string }>;
}

export interface ExplainReading {
  /** Where the value is read: "Tue 14 Oct · day 10, 06:00", "Plan A · end of week 16". */
  when: string;
  /** Formatted value ("1.4", "−2.3"). */
  value: string;
  unit?: string;
  /** Formatted range ("0.9–2.0"): P10–P90 of the model variations, never called "likely". */
  range?: string;
  /** One short line under the value (e.g. how to read another day). */
  note?: string;
}

export interface ExplainDriver {
  label: string;
  value: string;
  unit?: string;
  /** A short qualifier after the value ("of a 72 h fast"). */
  note?: string;
}

/**
 * The warrant words come from the evidence provider (`@/content/evidence/warrants`, the one source for the sheet, the
 * article and the reading guide); re-exported here for the sheet's existing callers.
 */
export { WARRANT_LABEL, warrantText };

const AVAILABILITY_TEXT: Readonly<Record<CapabilityAvailability, string>> = {
  supported: 'Can be a goal',
  scenario: 'Can be a goal, as a labelled scenario',
  observedOnly: 'Followed from your own records, not planned for',
  unavailable: 'Not a goal',
};

const UNCERTAINTY_TEXT: Readonly<Record<UncertaintyKind, string>> = {
  none: 'No range',
  measurementRepeatability: 'Measurement repeatability',
  parameterSensitivity: '10th–90th percentile of model variations; coverage not validated',
  scenario: 'Scenario range',
  conditionalResidual: 'Conditional residual range, not a full prediction interval',
  heuristic: 'Fixed display range',
  calibratedPrediction: 'Calibrated prediction interval',
};

/**
 * "How to read it" (C6 info sheet): the status, what a range is, whether it can be a goal and on what estimand, and the
 * warrants with their scope. Rows only for what is known; nothing here is shown on the operating screens.
 */
export function readingGuide(metricId: string | undefined, status: ExplainStatus | null | undefined, hasRange: boolean): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const cap = metricId ? (GOAL_CAPABILITY as Readonly<Partial<Record<string, (typeof GOAL_CAPABILITY)[MetricId]>>>)[metricId] : undefined;
  const st = status?.status ?? (metricId && EXPLORATORY_SERIES.has(metricId as SeriesId) ? 'exploratory' : undefined);
  if (st) rows.push({ label: 'Status', value: [STATUS_LABEL[st], status?.reason].filter(Boolean).join(' · ') });
  if (hasRange) rows.push({ label: 'Range', value: UNCERTAINTY_TEXT[status?.uncertaintyKind ?? 'parameterSensitivity'] });
  if (cap) {
    rows.push({ label: 'As a goal', value: AVAILABILITY_TEXT[cap.availability] });
    rows.push({ label: 'What it estimates', value: cap.estimand });
    for (const w of cap.warrants) rows.push({ label: 'Warrant', value: warrantText(w) });
  }
  for (const d of status?.details ?? []) rows.push({ label: d.label, value: d.value });
  return rows;
}

/** Mechanisms shown open-able up front for a metric; the rest sit behind "Show n more". */
const LEAD_COUNT = 5;

const TOP_NUMBERS = 3;

function Entry({
  mechanism: m,
  returnTo,
  keyNumbers,
}: {
  mechanism: Mechanism;
  returnTo?: ExplainDrawerProps['returnTo'];
  keyNumbers: number;
}) {
  const state: EvidenceNavState = { from: 'evidence', returnTo };
  return (
    <div className="ev-xp__entry">
      <div className="ev-xp__grade">
        <GradeBadge grade={m.grade} />
        <p>
          Grade {m.grade} — {m.gradeReason}
        </p>
      </div>
      <p className="ev-xp__p">{m.summary}</p>
      <h4 className="ev-xp__label">How Vitals models it</h4>
      <p className="ev-xp__p">{m.howModelled}</p>
      {m.keyNumbers.length ? (
        <>
          <h4 className="ev-xp__label">Key numbers</h4>
          <dl className="ev-xp__numbers">
            {m.keyNumbers.slice(0, keyNumbers).map((k, i) => (
              <div key={i}>
                <dt>{k.label}</dt>
                <dd>{k.value}</dd>
              </div>
            ))}
          </dl>
          {m.keyNumbers.length > keyNumbers ? (
            <p className="ev-xp__more">{m.keyNumbers.length - keyNumbers} more in the full entry</p>
          ) : null}
        </>
      ) : null}
      {m.caveats ? (
        <>
          <h4 className="ev-xp__label">Contested and uncertain</h4>
          <p className="ev-xp__p ev-xp__caveat">{m.caveats}</p>
        </>
      ) : null}
      {/* C6: outcome-scoped warrants, population and what the evidence observed (tissue, observation type) */}
      {hasWarrantContent(m) ? (
        <>
          <h4 className="ev-xp__label">Warrant</h4>
          <dl className="ev-xp__numbers">
            {m.modelStatus && m.modelStatus !== 'production' ? (
              <div>
                <dt>In the model</dt>
                <dd>{modelStatusLabel(m)}</dd>
              </div>
            ) : null}
            {(m.warrants ?? []).map((w, i) => (
              <div key={`w${i}`}>
                <dt>{WARRANT_LABEL[w.type] ?? w.type}</dt>
                <dd>{[w.confidence, w.scope].filter(Boolean).join(' · ')}</dd>
              </div>
            ))}
            {m.outcomeScope ? (
              <div>
                <dt>Covers</dt>
                <dd>{m.outcomeScope}</dd>
              </div>
            ) : null}
            {m.population ? (
              <div>
                <dt>Population</dt>
                <dd>{m.population}</dd>
              </div>
            ) : null}
            {(m.observations ?? []).map((o, i) => (
              <div key={`o${i}`}>
                <dt>Observed</dt>
                <dd>{observationText(o)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <div>
        <KeyLink
          to={mechanismHref(m.id, ARTICLE_SECTIONS.equation)}
          state={state}
          size="sm"
          variant="action"
          icon={BookOpenText}
        >
          Open in Evidence<VisuallyHidden>: {m.title}</VisuallyHidden>
        </KeyLink>
      </div>
    </div>
  );
}

/**
 * "Explain this curve": the compact evidence for one or more mechanisms (or for a
 * metric), in a bottom Sheet below 1024 px and a side panel above. Used by the
 * Simulator and Planner; "Open in Evidence" leads to the full article.
 *
 *   <ExplainDrawer open={open} onClose={close} metricId="bhb" returnTo={{ to: here, label: 'Spring cut results' }} />
 */
export function ExplainDrawer({
  open,
  onClose,
  mechanismIds = [],
  metricId,
  paramId,
  title,
  returnTo,
  keyNumbers = TOP_NUMBERS,
  reading,
  drivers,
  driversTitle = 'What is driving it here',
  unit,
  status: outputStatus,
}: ExplainDrawerProps) {
  const repo = useEvidenceRepository();
  const snap = useEvidenceSnapshot();
  const energyUnit = useEnergyUnit();
  const metric = metricId ? metricInfo(metricId) : null;
  const metricUnit = unit ?? (metric?.unit ? catalogueUnitIn(metric.unit, energyUnit) : undefined);

  // A metric's mechanisms are found by scanning every topic's relatedMetricIds.
  useEffect(() => {
    if (open && (metricId || paramId)) void repo.loadAll();
  }, [open, metricId, paramId, repo]);

  // most defining mechanism first (ketogenesis before "Does protein knock you out of ketosis?")
  const linked =
    metricId && snap.complete ? orderForMetric(metricId, repo.mechanismsForMetric(metricId)).map((r) => r.mechanism.id) : [];
  const [showAll, setShowAll] = useState(false);
  const [shownFor, setShownFor] = useState(metricId);
  if (shownFor !== metricId) {
    setShownFor(metricId);
    setShowAll(false);
  }
  const byParam = paramId && snap.complete ? repo.mechanismsForParam(paramId).map((r) => r.mechanism.id) : [];
  const ids = [...new Set([...mechanismIds, ...linked, ...byParam])];
  const { status, found, missing, retry } = useMechanisms(open ? ids : []);
  const metricLoading = Boolean(metricId || paramId) && !snap.settled;

  const panelTitle =
    title ??
    metric?.label ??
    (found.length === 1 && ids.length === 1 ? found[0]!.mechanism.title : 'Explain');
  const single = found.length === 1 && !metric;
  // units inside the guide follow Settings › energy (an estimand reads "kJ/d" in kJ mode)
  const kj = energyUnit === 'kJ' || /\bkJ\b/.test(metricUnit ?? '');
  // a caller without a metric (a correction, a plan detail) can still hand the sheet its status rows
  const guide = (metric || outputStatus ? readingGuide(metricId, outputStatus, !!reading?.range) : []).map((g) => (kj ? { ...g, value: g.value.replace(/\bkcal\b/g, 'kJ') } : g));
  const sourcesFor = (metric?.sources ?? []).filter((s) => Boolean(repo.entryBySlug(s.topic)));

  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={panelTitle}
      defaultDetent="half"
      detents={['half', 'full']}
    >
      <div className="ev-xp">
        {metric ? (
          <div className="ev-xp__metric">
            {metric.category || (metricUnit && metricUnit !== 'state') ? (
              <p className="ev-xp__meta">
                {[
                  metric.category ? sentence(CATEGORY_LABEL[metric.category]) : null,
                  metricUnit && metricUnit !== 'state' ? metricUnit : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {metric.description ? <p className="ev-xp__p">{metric.description}</p> : null}
            {metric.grade ? (
              <div className="ev-xp__grade">
                <GradeBadge grade={metric.grade} />
                <p>Grade {metric.grade} for this channel as a whole.</p>
              </div>
            ) : null}
            {metric.caveat ? <p className="ev-xp__p">{metric.caveat}</p> : null}
            {guide.length ? (
              <>
                <h4 className="ev-xp__label">How to read it</h4>
                <dl className="ev-xp__numbers">
                  {guide.map((g, i) => (
                    <div key={`${g.label}-${i}`}>
                      <dt>{g.label}</dt>
                      <dd>{g.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
          </div>
        ) : null}

        {!metric && guide.length ? (
          <div className="ev-xp__metric">
            <h4 className="ev-xp__label">How to read it</h4>
            <dl className="ev-xp__numbers">
              {guide.map((g, i) => (
                <div key={`${g.label}-${i}`}>
                  <dt>{g.label}</dt>
                  <dd>{g.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {reading ? (
          <section className="ev-xp__reading" aria-label="Value at this point">
            <p className="ev-xp__when">{reading.when}</p>
            <p className="ev-xp__value">
              <span className="lm-num">{reading.value}</span>
              {reading.unit ? <span className="lm-unit">{reading.unit}</span> : null}
            </p>
            {/* P10–P90 of model variations: a range with its unit, not a likelihood (C6; what it is: "How to read it") */}
            {reading.range ? <p className="ev-xp__range">range {reading.range}{reading.unit ? `\u2009${reading.unit}` : ''}</p> : null}
            {drivers && drivers.length ? (
              <>
                <h4 className="ev-xp__label">{sentence(driversTitle)}</h4>
                <dl className="ev-xp__drivers">
                  {drivers.map((d) => (
                    <div key={d.label}>
                      <dt>{d.label}</dt>
                      <dd>
                        <span className="lm-num">{d.value}</span>
                        {d.unit ? <span className="lm-unit">{d.unit}</span> : null}
                        {d.note ? <span className="ev-xp__dnote"> {d.note}</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            {reading.note ? <p className="ev-xp__rnote">{reading.note}</p> : null}
          </section>
        ) : null}

        {status === 'loading' || metricLoading ? (
          <p className="ev-xp__loading" role="status">
            <Spinner size={16} /> Loading the evidence…
          </p>
        ) : null}

        {status === 'error' ? (
          <InlineWarning
            severity="caution"
            action={
              <Key size="sm" onClick={retry}>
                Try again
              </Key>
            }
          >
            Part of the library couldn’t be loaded. Check your connection.
          </InlineWarning>
        ) : null}

        {(found.length > 1 || metric) && found.length ? (
          <p className="ev-xp__count">
            {found.length} {found.length === 1 ? 'mechanism' : 'mechanisms'} behind this
          </p>
        ) : null}

        {single ? (
          <Entry
            mechanism={found[0]!.mechanism}
            returnTo={returnTo}
            keyNumbers={keyNumbers}
          />
        ) : (
          <>
            {(metric && !showAll ? found.slice(0, LEAD_COUNT) : found).map((r, i) => (
              <details key={r.mechanism.id} className="ev-xp__details" open={i === 0}>
                <summary>
                  <h3 className="ev-xp__summary">{r.mechanism.title}</h3>
                  <GradeBadge grade={r.mechanism.grade} size="sm" tooltip={false} />
                </summary>
                <Entry mechanism={r.mechanism} returnTo={returnTo} keyNumbers={keyNumbers} />
              </details>
            ))}
            {metric && !showAll && found.length > LEAD_COUNT ? (
              <div className="ev-xp__moreall">
                <Key size="sm" variant="quiet" onClick={() => setShowAll(true)}>
                  Show {found.length - LEAD_COUNT} more {found.length - LEAD_COUNT === 1 ? 'mechanism' : 'mechanisms'}
                </Key>
              </div>
            ) : null}
          </>
        )}

        {metric && !metricLoading && status !== 'loading' && !found.length ? (
          <div className="ev-xp__none">
            <p className="ev-xp__p">No mechanism is linked to this channel in the library yet.</p>
            {sourcesFor.length ? (
              <p className="ev-xp__p">
                The topics that define it:{' '}
                <SourceRefLinks refs={sourcesFor} state={{ from: 'evidence', returnTo } satisfies EvidenceNavState} />
              </p>
            ) : null}
          </div>
        ) : null}

        {missing.length ? (
          <InlineWarning severity="info">
            {missing.length === 1 ? '1 mechanism isn’t' : `${missing.length} mechanisms aren’t`} in the library yet.
          </InlineWarning>
        ) : null}

        <Disclaimer className="ev-xp__disclaimer" />
      </div>
    </ResponsivePanel>
  );
}
