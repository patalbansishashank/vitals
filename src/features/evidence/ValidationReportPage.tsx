import { useEffect, useState } from 'react';
import { Faceplate, KeyLink, Notice, Page, ProgressRule } from '@/components';
import { TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { Markdown } from './lib/miniMarkdown';
import { ActivityIntakeValidationSection, PlannerBenchmarksSection } from './components/ValidationSections';
import { loadPlannerBenchmarks } from './plannerBenchmarks';
import { loadValidationReport } from './validationReport';
import type { PlannerBenchmarks } from '@/content/evidence/validation/plannerBenchmarks';
import './evidence.css';

type State = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'missing' } | { status: 'error' };

/**
 * /evidence/validation — the model validation report, rendered from a copy bundled at build time
 * (docs/VALIDATION_REPORT.md) with a small dependency-free Markdown reader, followed by the planner benchmarks (when the
 * harness has published them) and the activity intake checks (a snapshot of the validation suite's rows).
 */
export default function ValidationReportPage() {
  const [state, setState] = useState<State>(loadValidationReport ? { status: 'loading' } : { status: 'missing' });
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
      <TopBar title="Validation report" back={{ to: paths.evidence, label: 'Evidence' }} compactOnMobile />
      <Page className="ev-page" width="narrow">
        {state.status === 'loading' ? (
          <ProgressRule label="Loading the validation report" reducedText="Loading…" />
        ) : state.status === 'ready' ? (
          <Faceplate as="article" className="ev-md" aria-label="Validation report">
            <p className="lm-eng ev-md__eng">how the model was checked against published human studies</p>
            <Markdown source={state.text} headingOffset={1} />
          </Faceplate>
        ) : (
          <Faceplate as="div">
            <Notice severity="info" layout="ruled" title={state.status === 'error' ? 'The validation report could not be loaded.' : 'The validation report is not published yet.'}>
              <p>
                {state.status === 'error'
                  ? 'Reload the page to try again.'
                  : 'It will compare the model’s projections with published human studies, study by study. Until then, each mechanism in the Evidence library shows its own grade and sources.'}
              </p>
            </Notice>
            <div className="mt-4">
              <KeyLink to={paths.evidence}>Back to Evidence</KeyLink>
            </div>
          </Faceplate>
        )}
        <PlannerBenchmarksSection report={bench} />
        <ActivityIntakeValidationSection />
      </Page>
    </>
  );
}
