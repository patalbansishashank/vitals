import { useEffect, useState } from 'react';
import {
  EmptyStage,
  Faceplate,
  HeroNumber,
  KeyLink,
  MonoMeta,
  Page,
  ProgressRule,
  formatNumber,
} from '@/components';
import { useReveal } from '@/components/lib/reveal';
import { TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { Markdown } from './lib/miniMarkdown';
import { ActivityIntakeValidationSection, PlannerBenchmarksSection } from './components/ValidationSections';
import { loadPlannerBenchmarks } from './plannerBenchmarks';
import { loadValidationReport } from './validationReport';
import type { PlannerBenchmarks } from '@/content/evidence/validation/plannerBenchmarks';
import './evidence.css';

/** The headline counts, read from the report's "Results at a glance" table (null when its wording changes). */
export function readHeadline(
  text: string,
): {
  met: number;
  mustPass: number;
  known: number;
  tracked: number | null;
  scenarios: number | null;
  expectations: number | null;
  modelDate: string | null;
} | null {
  const must = /\*\*(\d+) of (\d+) met\*\*;\s*(\d+) known misses/.exec(text);
  if (!must) return null;
  const tracked = /\|\s*Tracked misses\s*\|\s*(\d+)/.exec(text);
  const scen = /\|\s*Study scenarios\s*\|\s*(\d+) scenarios, (\d+) expectations/.exec(text);
  const modelDate = /\*Model version of ([^*\n]+)\.\*/.exec(text);
  return {
    met: Number(must[1]),
    mustPass: Number(must[2]),
    known: Number(must[3]),
    tracked: tracked ? Number(tracked[1]) : null,
    scenarios: scen ? Number(scen[1]) : null,
    expectations: scen ? Number(scen[2]) : null,
    modelDate: modelDate?.[1] ?? null,
  };
}

/** Dated model targets met against known misses; this is not the software CI pass rate. */
function ResultsSummary({ text }: { text: string }) {
  const [ref, pending] = useReveal<HTMLDivElement>();
  const h = readHeadline(text);
  if (!h || h.mustPass <= 0) return null;
  const metPct = (h.met / h.mustPass) * 100;
  return (
    <Faceplate title="Model comparison results" className="ev-vsum">
      <p className="ev-vsum__context">
        {h.modelDate ? `Model snapshot: ${h.modelDate}. ` : 'Dated model snapshot. '}
        These counts describe model targets, not the app’s software test status or prediction accuracy.
        No untouched study holdout has been evaluated; unresolved study details remain unknown.
      </p>
      <p className="ev-vsum__big">
        <HeroNumber value={h.met} size="num-l" label={`${formatNumber(h.met)} model targets met`} />
        <span className="ev-vsum__of">of {formatNumber(h.mustPass)} model targets met</span>
      </p>
      <div
        ref={ref}
        className="ev-vsum__bar"
        data-reveal={pending ? 'pending' : undefined}
        role="img"
        aria-label={`${h.met} model targets met, ${h.known} known model misses, each with its cause`}
      >
        <span className="ev-vsum__met" style={{ width: `${metPct}%` }} />
        <span className="ev-vsum__miss" style={{ width: `${100 - metPct}%` }} />
      </div>
      <ul className="ev-vsum__legend lm-meta">
        <li data-k="met">
          <span className="lm-num">{formatNumber(h.met)}</span> met
        </li>
        <li data-k="miss">
          <span className="lm-num">{formatNumber(h.known)}</span> known misses, each with its cause
        </li>
        {h.tracked !== null ? (
          <li data-k="tracked">
            <span className="lm-num">{formatNumber(h.tracked)}</span> tracked
          </li>
        ) : null}
      </ul>
      {h.scenarios !== null && h.expectations !== null ? (
        <MonoMeta as="p" className="ev-vsum__scale">
          {formatNumber(h.scenarios)} study scenarios · {formatNumber(h.expectations)} expectations
        </MonoMeta>
      ) : null}
    </Faceplate>
  );
}

type State =
  { status: 'loading' } | { status: 'ready'; text: string } | { status: 'missing' } | { status: 'error' };

/**
 * /evidence/validation — the model validation report (listed under Settings › About and Evidence; Back returns to where
 * the reader came from), its headline results first as a bar, then the report's sections folded, rendered
 * from a copy bundled at build time
 * (docs/VALIDATION_REPORT.md) with a small dependency-free Markdown reader, followed by the planner benchmarks (when the
 * harness has published them) and the activity intake checks (a snapshot of the validation suite's rows).
 */
export default function ValidationReportPage() {
  const [state, setState] = useState<State>(
    loadValidationReport ? { status: 'loading' } : { status: 'missing' },
  );
  useEffect(() => {
    if (!loadValidationReport) return;
    let alive = true;
    loadValidationReport().then(
      (text) => alive && setState({ status: 'ready', text }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const [bench, setBench] = useState<PlannerBenchmarks | null | 'invalid'>(null);
  useEffect(() => {
    let alive = true;
    loadPlannerBenchmarks().then(
      (b) => alive && setBench(b),
      () => alive && setBench('invalid'),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      {/* Back returns where the reader came from (Settings › About or Evidence), not always to Settings */}
      <TopBar title="Model evidence report" back />
      <Page className="ev-page ev-vpage">
        {state.status === 'loading' ? (
          <ProgressRule label="Loading the validation report" reducedText="Loading…" />
        ) : state.status === 'ready' ? (
          <>
            <ResultsSummary text={state.text} />
            {/* each section folds (a section list to open, not a 37 000 px page); the results at a glance start open */}
            <Faceplate as="article" className="ev-md" aria-label="Model evidence report">
              <Markdown
                source={state.text}
                headingOffset={1}
                fold={{ level: 2, open: ['Results at a glance'] }}
              />
            </Faceplate>
          </>
        ) : (
          <EmptyStage
            title={
              state.status === 'error'
                ? 'The validation report could not be loaded.'
                : 'The validation report is not published yet.'
            }
            action={<KeyLink to={paths.evidence}>Open Evidence</KeyLink>}
          >
            {state.status === 'error' ? 'Reload the page to try again.' : null}
          </EmptyStage>
        )}
        <PlannerBenchmarksSection report={bench} />
        <ActivityIntakeValidationSection />
      </Page>
    </>
  );
}
