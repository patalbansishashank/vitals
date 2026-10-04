/**
 * Warnings & safety (simulator-results.md §6, §8; dossier 17 §3): the engine's warnings grouped by severity — danger,
 * caution, then information — each with a drawn status mark (colour on the mark only, REVIEW_FINDINGS #5), a risk-
 * first title, the engine's message, the affected days, `Show` (moves the crosshair to the first affected day and
 * brings the chart into view) and a specific remedy that opens the schedule with those days selected. Any caution or
 * danger ends the panel with the persistent "stop and get help" line. Always-on notes sit in a closed disclosure.
 */
import { ChevronDown } from 'lucide-react';
import { Faceplate, Key, KeyLink, StatusMark, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { StopAndGetHelp } from '@/features/onboarding';
import { SourceRefLinks, type EvidenceNavState } from '@/features/evidence';
import type { WarningGroups, WarningItem, WarningRemedy } from '../lib/warnings';
import { shortDate } from '../lib/format';

export interface WarningsPanelProps {
  groups: WarningGroups;
  startDate?: string;
  onShow: (day: number) => void;
  remedyHref: (r: WarningRemedy) => string;
  titleAs?: 'h2' | 'h3';
  /** Results not shown yet (never run / first run): the panel says so. */
  pending?: boolean;
  /** Where the Evidence library's "back" link returns to from a source link. */
  returnTo?: { to: string; label: string };
}

/** "Evidence: Safety limits › references 6, 7": the topic and source numbers behind a message, linked into the library. */
function EvidenceLine({ sources, returnTo, className }: { sources: WarningItem['sources']; returnTo?: WarningsPanelProps['returnTo']; className: string }) {
  if (!sources.length) return null;
  const state: EvidenceNavState = { from: 'evidence', ...(returnTo ? { returnTo } : {}) };
  return (
    <span className={className}>
      Evidence: <SourceRefLinks refs={sources} state={state} />
    </span>
  );
}

function Row({ w, startDate, onShow, remedyHref, returnTo }: { w: WarningItem; startDate?: string; onShow: (d: number) => void; remedyHref: (r: WarningRemedy) => string; returnTo?: WarningsPanelProps['returnTo'] }) {
  const a = shortDate(startDate, w.startDay);
  const b = shortDate(startDate, w.endDay);
  const dates = a && b ? (a === b ? a : `${a} – ${b}`) : null;
  // the engine's words, verbatim; only energy figures follow Settings › energy unit (kcal → kJ)
  const unit = useEnergyUnit();
  return (
    <li className="rs-warn" data-severity={w.severity}>
      <StatusMark severity={w.severity} label={w.severity === 'danger' ? 'Danger' : w.severity === 'caution' ? 'Caution' : 'Information'} />
      <p className="rs-warn__title">{energyInText(w.title, unit)}</p>
      <p className="rs-warn__body">{energyInText(w.body, unit)}</p>
      <p className="rs-warn__days lm-num">
        {w.daysText}
        {dates ? ` · ${dates}` : ''}
      </p>
      {w.sources.length ? (
        <p className="rs-warn__src">
          <EvidenceLine sources={w.sources} returnTo={returnTo} className="rs-warn__srcline" />
        </p>
      ) : null}
      <div className="rs-warn__acts">
        <Key size="sm" onClick={() => onShow(w.startDay)}>
          Show
        </Key>
        {w.remedy ? (
          <KeyLink size="sm" variant="quiet" to={remedyHref(w.remedy)}>
            {w.remedy.label}
          </KeyLink>
        ) : null}
      </div>
    </li>
  );
}

export function WarningsPanel({ groups, startDate, onShow, remedyHref, titleAs = 'h2', pending, returnTo }: WarningsPanelProps) {
  const rows = [...groups.danger, ...groups.caution, ...groups.info];
  const serious = groups.counts.danger + groups.counts.caution;
  const H = titleAs;
  const unit = useEnergyUnit();
  return (
    <Faceplate variant="flush" className="rs-warnings" aria-labelledby="rs-warnings-title">
      <div className="rs-warnings__bar">
        <H id="rs-warnings-title" className="lm-h3 rs-warnings__title">
          Warnings
        </H>
        <span className="rs-warnings__count lm-eng lm-num">
          {groups.counts.danger ? `${groups.counts.danger} danger · ` : ''}
          {groups.counts.caution ? `${groups.counts.caution} caution${groups.counts.caution === 1 ? '' : 's'} · ` : ''}
          {rows.length} total
        </span>
      </div>
      <div className="rs-warnings__body">
        {pending ? (
          <p className="rs-warnings__empty">Warnings appear with the projection.</p>
        ) : rows.length === 0 ? (
          <p className="rs-warnings__empty rs-warnings__empty--ok">
            <StatusMark severity="ok" label="OK" />
            <span>No cautions for this schedule.</span>
          </p>
        ) : (
          <ul className="rs-warnings__list">
            {rows.map((w) => (
              <Row key={w.key} w={w} startDate={startDate} onShow={onShow} remedyHref={remedyHref} returnTo={returnTo} />
            ))}
          </ul>
        )}
        {serious > 0 ? <StopAndGetHelp className="rs-warnings__help" /> : null}
        {groups.notes.length ? (
          <details className="rs-warnings__notes">
            <summary>
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
              About this projection <span className="lm-num">({groups.notes.length})</span>
            </summary>
            <ul>
              {groups.notes.map((n) => (
                <li key={n.key}>
                  {energyInText(n.title, unit)}
                  {n.body && n.body !== n.title ? ` ${energyInText(n.body, unit)}` : ''}
                  {n.sources.length ? (
                    <>
                      {' '}
                      <EvidenceLine sources={n.sources} returnTo={returnTo} className="rs-warn__srcline" />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Faceplate>
  );
}
