import { useEffect, useState, type ReactNode } from 'react';
import { BookOpenText } from 'lucide-react';
import {
  GradeBadge,
  InlineWarning,
  Key,
  KeyLink,
  ResponsivePanel,
  Spinner,
  Swatch,
  VisuallyHidden,
} from '@/components';
import type { EvidenceTopic, Mechanism } from '@/content/evidence/schema';
import { topicDisplayName } from '@/content/evidence/sources';
import { CategoryMark, Disclaimer } from './components/bits';
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
   * and likely range. Omitted = no reading block.
   */
  reading?: ExplainReading | null;
  /** "What is driving it on this day": the related values the caller already has for that moment. */
  drivers?: readonly ExplainDriver[] | null;
  /** Engraved heading of the drivers list (default "what is driving it here"). */
  driversTitle?: string;
  /**
   * The metric's unit as the caller displays it (converted to the user's units, e.g. "kJ/d", "lb", "mmol/L vs start").
   * Default: the catalogue unit, with energy in the Settings energy unit.
   */
  unit?: string;
}

export interface ExplainReading {
  /** Where the value is read: "Tue 14 Oct · day 10, 06:00", "Plan A · end of week 16". */
  when: string;
  /** Formatted value ("1.4", "−2.3"). */
  value: string;
  unit?: string;
  /** Formatted likely range without the word "likely" ("0.9–2.0"). */
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

/** Mechanisms shown open-able up front for a metric; the rest sit behind "Show n more". */
const LEAD_COUNT = 5;

const TOP_NUMBERS = 3;

function Entry({
  mechanism: m,
  topic,
  returnTo,
  keyNumbers,
}: {
  mechanism: Mechanism;
  topic: EvidenceTopic;
  returnTo?: ExplainDrawerProps['returnTo'];
  keyNumbers: number;
}) {
  const state: EvidenceNavState = { from: 'evidence', returnTo };
  return (
    <div className="ev-xp__entry">
      <p className="ev-xp__eng lm-eng">
        <CategoryMark category={m.category} /> <span aria-hidden="true">·</span> {topicDisplayName(topic.slug, topic.title)}
      </p>
      <div className="ev-xp__grade">
        <GradeBadge grade={m.grade} />
        <p>
          Grade {m.grade} — {m.gradeReason}
        </p>
      </div>
      <p className="ev-xp__p">{m.summary}</p>
      <div className="ev-well ev-xp__well">
        <p className="lm-eng ev-well__label">how Vitals models it</p>
        <p className="ev-xp__p">{m.howModelled}</p>
      </div>
      {m.keyNumbers.length ? (
        <>
          <p className="lm-eng ev-xp__label">key numbers</p>
          <dl className="ev-xp__numbers">
            {m.keyNumbers.slice(0, keyNumbers).map((k, i) => (
              <div key={i}>
                <dt>{k.label}</dt>
                <dd>{k.value}</dd>
              </div>
            ))}
          </dl>
          {m.keyNumbers.length > keyNumbers ? (
            <p className="ev-xp__more lm-eng">{m.keyNumbers.length - keyNumbers} more in the full entry</p>
          ) : null}
        </>
      ) : null}
      {m.caveats ? (
        <>
          <p className="lm-eng ev-xp__label">contested and uncertain</p>
          <p className="ev-xp__p ev-xp__caveat">{m.caveats}</p>
        </>
      ) : null}
      <div>
        <KeyLink
          to={mechanismHref(m.id, ARTICLE_SECTIONS.equation)}
          state={state}
          size="sm"
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
  driversTitle = 'what is driving it here',
  unit,
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
            <p className="ev-xp__eng lm-eng">
              {metric.category ? <CategoryMark category={metric.category} /> : null}
              {metricUnit && metricUnit !== 'state' ? (
                <>
                  <span aria-hidden="true">·</span> {metricUnit}
                </>
              ) : null}
            </p>
            {metric.description ? <p className="ev-xp__p">{metric.description}</p> : null}
            {metric.grade ? (
              <div className="ev-xp__grade">
                <GradeBadge grade={metric.grade} />
                <p>Grade {metric.grade} for this channel as a whole.</p>
              </div>
            ) : null}
            {metric.caveat ? <p className="ev-xp__p">{metric.caveat}</p> : null}
          </div>
        ) : null}

        {reading ? (
          <section className="ev-xp__reading" aria-label="Value at this point">
            <p className="lm-eng ev-xp__when">{reading.when}</p>
            <p className="ev-xp__value">
              <span className="lm-num">{reading.value}</span>
              {reading.unit ? <span className="lm-unit">{reading.unit}</span> : null}
            </p>
            {reading.range ? <p className="ev-xp__range">likely {reading.range}{reading.unit ? `\u2009${reading.unit}` : ''}</p> : null}
            {drivers && drivers.length ? (
              <>
                <p className="lm-eng ev-xp__label">{driversTitle}</p>
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
          <p className="lm-eng ev-xp__label">
            {found.length} {found.length === 1 ? 'mechanism' : 'mechanisms'} behind this{metric && found.length > 1 ? ', most direct first' : ''}
          </p>
        ) : null}

        {single ? (
          <Entry
            mechanism={found[0]!.mechanism}
            topic={found[0]!.topic}
            returnTo={returnTo}
            keyNumbers={keyNumbers}
          />
        ) : (
          <>
            {(metric && !showAll ? found.slice(0, LEAD_COUNT) : found).map((r, i) => (
              <details key={r.mechanism.id} className="ev-xp__details" open={i === 0}>
                <summary>
                  <Swatch category={r.mechanism.category} shape="square" />
                  <h3 className="ev-xp__summary">{r.mechanism.title}</h3>
                  <GradeBadge grade={r.mechanism.grade} size="sm" tooltip={false} />
                </summary>
                <Entry mechanism={r.mechanism} topic={r.topic} returnTo={returnTo} keyNumbers={keyNumbers} />
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
            {missing.length === 1 ? 'One mechanism is' : `${missing.length} mechanisms are`} not in the
            library yet ({missing.join(', ')}).
          </InlineWarning>
        ) : null}

        <Disclaimer className="ev-xp__disclaimer" />
      </div>
    </ResponsivePanel>
  );
}
