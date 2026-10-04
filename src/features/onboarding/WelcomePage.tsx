import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Checkbox, Dialog, Faceplate, Icon, IconKey, Key, KeyLink, Notice, VisuallyHidden, cx } from '@/components';
import { Wordmark } from '@/app/shell';
import { paths } from '@/app/paths';
import { lastRoute } from '@/app/lastRoute';
import { isStorageAvailable } from '@/state/persistence';
import { useSafetyStore } from '@/state/safetyStore';
import { nowIso } from './clock';
import {
  ACK_VERSIONS,
  CONSENT,
  DISCLAIMER_CHANGES,
  HARD_STOP,
  LIFTED_NAME,
  PROGRESS,
  SCREENING,
  SETTINGS_SAFETY,
  STEP_NAMES,
  WELCOME,
} from './copy';
import { DisclaimerFooter, DisclaimerFull } from './Disclaimer';
import { DownloadsBlock } from '@/features/home/DownloadsBlock';
import { ExampleRecording } from './ExampleRecording';
import { gateStatus, type GateInput } from './gate';
import { HelpCard } from './HelpCard';
import { SafetySummary } from './SafetySummary';
import { ScreeningForm, questionDomId } from './ScreeningForm';
import { evaluateScreening, liftedRestrictions, missingQuestions, type AcknowledgementId, type ScreeningAnswers } from './safetyRules';
// the bus and the safety definitions only (the store registers the same ones): the first-run screen must not wait for
// the whole command registry, which brings the engine and the catalogues
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/safety';
import './onboarding.css';

type Step = 'intro' | 'screening' | 'consent' | 'stop';
type Review = 'settings' | 'import' | 'expired' | 'update' | null;
const STEP_INDEX: Record<Exclude<Step, 'stop'>, number> = { intro: 0, screening: 1, consent: 2 };

function readReview(v: string | null): Review {
  return v === 'settings' || v === 'import' || v === 'expired' || v === 'update' ? v : null;
}

/**
 * Draft answers for the form: the stored answers. The SCOFF items are never stored (DS-10), only their outcome
 * (`scoffRisk`); the draft keeps that outcome, so a review (Settings, an imported file, the yearly check) does not
 * silently drop it. Answering all five items again replaces it.
 */
function draftFrom(stored: ScreeningAnswers | null): ScreeningAnswers {
  if (!stored) return {};
  const d: ScreeningAnswers = { ...stored };
  if (d.ageBand === 'under-18') delete d.ageBand;
  return d;
}

/**
 * /welcome — first run (design/screens/onboarding-safety.md): intro → "About you" screening → consent
 * (with the safety summary) → Your body. Also serves the hard stop (under 18), re-consent after a
 * disclaimer change, and "Review my answers" (Settings, imports, yearly review). Full-screen, no tab bar.
 */
export default function WelcomePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const stored = useSafetyStore(
    useShallow(
      (s): GateInput => ({
        answers: s.answers,
        answeredAt: s.answeredAt,
        questionSetVersion: s.questionSetVersion,
        acknowledgements: s.acknowledgements,
        pendingReview: s.pendingReview,
      }),
    ),
  );
  const commitAnswers = (answers: ScreeningAnswers, at: string) => void sendCommand('safety.commitScreening', { answers: answers as Record<string, unknown>, at });
  const acknowledge = (id: AcknowledgementId, version: number, at: string) => void sendCommand('safety.acknowledge', { id, version, at });
  const clearAgeAnswer = () => void sendCommand('safety.clearAgeAnswer', {});

  const gate = gateStatus(stored, nowIso());
  const requested = params.get('step');
  const review = readReview(params.get('review'));
  const from = (location.state as { from?: string } | null)?.from;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<ScreeningAnswers>(() => draftFrom(stored.answers));
  const scoffPrivacyNote = stored.answers?.scoffRisk !== undefined;

  const step: Step =
    gate.status === 'blocked'
      ? 'stop'
      : requested === 'screening'
        ? 'screening'
        : requested === 'consent'
          ? gate.status === 'needs-consent' || gate.status === 'ready'
            ? 'consent'
            : 'screening'
          : 'intro';

  const go = useCallback(
    (next: Step, opts: { review?: string; replace?: boolean } = {}) =>
      navigate(paths.welcome(next, opts.review), { replace: opts.replace, state: from ? { from } : undefined }),
    [navigate, from],
  );

  // Move focus to the step's heading on every step change (the hard stop included, design §9).
  useEffect(() => {
    const id = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    window.scrollTo?.(0, 0);
    return () => window.cancelAnimationFrame(id);
  }, [step]);

  useEffect(() => {
    document.title = `${step === 'stop' ? HARD_STOP.title.replace(/\.$/, '') : STEP_NAMES[step]} · Vitals`;
  }, [step]);

  const finish = useCallback(
    (firstRun = false) => {
      // First run always continues to Your body setup (spec §2); reviews return where they came from.
      const target = firstRun ? `${paths.body}?setup=basics` : (from ?? (review === 'settings' ? paths.settings('safety') : null) ?? lastRoute() ?? paths.body);
      navigate(target, { replace: true });
    },
    [from, review, navigate],
  );

  // A fully set-up visitor who opens /welcome without a step goes back to Vitals.
  if (gate.status === 'ready' && !requested) return <Navigate to={from ?? lastRoute() ?? paths.body} replace />;

  const back: (() => void) | null =
    step === 'screening' ? () => (review === 'settings' ? finish() : go('intro')) : step === 'consent' ? () => go('screening', { review: review ?? undefined }) : null;
  const showProgress = step !== 'stop' && review !== 'settings';

  return (
    <div className="lm-onb" data-step={step}>
      <header className="lm-onb__bar" data-back={back ? 'true' : undefined}>
        {back ? <IconKey icon={ChevronLeft} label={PROGRESS.back} onClick={back} /> : <Wordmark />}
        <div className="lm-onb__barspacer" />
        {showProgress ? <ProgressScale current={STEP_INDEX[step as Exclude<Step, 'stop'>]} /> : null}
      </header>
      <main id="main" className="lm-onb__main" tabIndex={-1}>
        {step === 'intro' ? <IntroStep headingRef={headingRef} onStart={() => go('screening')} /> : null}
        {step === 'screening' ? (
          <ScreeningStep
            headingRef={headingRef}
            draft={draft}
            setDraft={setDraft}
            review={review ?? (gate.status === 'needs-review' ? gate.reason : null)}
            scoffPrivacyNote={scoffPrivacyNote}
            storedAnswers={stored.answers}
            onCommit={(answers) => {
              commitAnswers(answers, nowIso());
              if (answers.ageBand === 'under-18') return go('stop', { replace: true });
              const consentCurrent = stored.acknowledgements.disclaimer?.version === ACK_VERSIONS.disclaimer;
              if (review && consentCurrent) return finish();
              go('consent', { review: review ?? undefined });
            }}
          />
        ) : null}
        {step === 'consent' ? (
          <ConsentStep
            headingRef={headingRef}
            answers={stored.answers ?? {}}
            updated={gate.status === 'needs-consent' && gate.updated}
            onAccept={() => {
              const firstRun = stored.acknowledgements.disclaimer === undefined;
              acknowledge('disclaimer', ACK_VERSIONS.disclaimer, nowIso());
              finish(firstRun);
            }}
          />
        ) : null}
        {step === 'stop' ? (
          <StopStep
            headingRef={headingRef}
            onMistake={() => {
              clearAgeAnswer();
              setDraft((d) => ({ ...d, ageBand: undefined }));
              go('screening', { replace: true });
              window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${questionDomId('ageBand')} [role="radio"]`)?.focus());
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Chrome
   --------------------------------------------------------------------------- */

function ProgressScale({ current }: { current: number }) {
  const names = [STEP_NAMES.intro, STEP_NAMES.screening, STEP_NAMES.consent];
  return (
    <ol className="lm-onb-progress" aria-label={PROGRESS.label}>
      {names.map((n, i) => (
        <li key={n} data-state={i < current ? 'done' : i === current ? 'current' : 'todo'} aria-current={i === current ? 'step' : undefined}>
          <VisuallyHidden>
            {n}
            {i < current ? PROGRESS.done : i === current ? PROGRESS.current(i + 1, names.length) : ''}
          </VisuallyHidden>
        </li>
      ))}
    </ol>
  );
}

function Foot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('lm-onb-foot', className)}>
      <div className="lm-onb-foot__inner">{children}</div>
    </div>
  );
}

type HeadingRef = RefObject<HTMLHeadingElement | null>;

/* ---------------------------------------------------------------------------
   Step 1 — intro
   --------------------------------------------------------------------------- */

function IntroStep({ headingRef, onStart }: { headingRef: HeadingRef; onStart: () => void }) {
  return (
    <>
      <div className="lm-onb-intro">
        <div className="lm-onb-intro__text">
          <h1 ref={headingRef} className="lm-onb-display" tabIndex={-1}>
            {WELCOME.headline}
          </h1>
          <p className="lm-onb-intro__body">{WELCOME.body}</p>
          <VisuallyHidden>{WELCOME.illustrationAlt}</VisuallyHidden>
          <div className="lm-onb-intro__actions">
            <Key variant="solid" size="lg" trailingIcon={ChevronRight} onClick={onStart} className="lm-onb-intro__start">
              {WELCOME.start}
            </Key>
            <p className="lm-onb-intro__meta">{WELCOME.time}</p>
            <p className="lm-onb-intro__meta">
              {WELCOME.importLead}{' '}
              <KeyLink to={paths.settings('data')} variant="quiet" size="sm">
                {WELCOME.importAction}
              </KeyLink>
            </p>
            <DownloadsBlock />
          </div>
        </div>
        <div className="lm-onb-intro__stage">
          <ExampleRecording />
        </div>
        <div className="lm-onb-intro__footer">
          <DisclaimerFooter />
        </div>
      </div>
      <Foot className="lm-onb-intro__foot">
        <Key variant="solid" size="lg" trailingIcon={ChevronRight} onClick={onStart}>
          {WELCOME.start}
        </Key>
      </Foot>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Step 2 — screening ("About you")
   --------------------------------------------------------------------------- */

interface ScreeningStepProps {
  headingRef: HeadingRef;
  draft: ScreeningAnswers;
  setDraft: Dispatch<SetStateAction<ScreeningAnswers>>;
  review: Review;
  scoffPrivacyNote: boolean;
  storedAnswers: ScreeningAnswers | null;
  onCommit: (answers: ScreeningAnswers) => void;
}

function ScreeningStep({ headingRef, draft, setDraft, review, scoffPrivacyNote, storedAnswers, onCommit }: ScreeningStepProps) {
  const [confirmLift, setConfirmLift] = useState<string[] | null>(null);
  // A kept eating-questions outcome counts as answered; without one the five items are required.
  const missing = useMemo(() => missingQuestions(draft, { requireScoffItems: typeof draft.scoffRisk !== 'boolean' }), [draft]);
  const storage = useMemo(() => isStorageAvailable(), []);
  const reviewNote =
    review === 'settings'
      ? SCREENING.reviewSettings
      : review === 'import'
        ? SCREENING.reviewImport
        : review === 'expired'
          ? SCREENING.reviewExpired
          : review === 'update'
            ? SCREENING.reviewUpdate
            : null;

  const jumpToMissing = () => {
    const q = missing[0];
    if (!q) return;
    const el = document.getElementById(questionDomId(q));
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const target = el?.querySelector<HTMLElement>('[role="radio"][tabindex="0"], input:not([disabled])');
    target?.focus({ preventScroll: true });
  };

  const submit = () => {
    if (missing.length > 0) return;
    if (storedAnswers && review) {
      const lifted = liftedRestrictions(evaluateScreening(storedAnswers), evaluateScreening(draft));
      if (lifted.length > 0) {
        setConfirmLift(lifted.map((l) => LIFTED_NAME[l]));
        return;
      }
    }
    onCommit(draft);
  };

  const under18 = draft.ageBand === 'under-18';
  return (
    <>
      <div className="lm-onb-col">
        <header className="lm-onb-head">
          <h1 ref={headingRef} className="lm-title" tabIndex={-1}>
            {SCREENING.title}
          </h1>
          <p className="lm-onb-lead">{SCREENING.lead}</p>
          <p className="lm-onb-sub">{SCREENING.sub}</p>
          <details className="lm-onb-why">
            <summary>
              {SCREENING.whyTitle}
              <Icon icon={ChevronRight} size={16} />
            </summary>
            <p>{SCREENING.why}</p>
          </details>
        </header>
        {!storage ? <Notice severity="caution" title={SCREENING.storageBlocked} /> : null}
        {reviewNote ? <Notice severity="info" title={reviewNote} /> : null}
        <ScreeningForm answers={draft} onChange={setDraft} scoffPrivacyNote={scoffPrivacyNote} />
      </div>
      <Foot>
        <Key variant="solid" size="lg" disabledReason={missing.length > 0 ? SCREENING.continueBlocked : undefined} onClick={submit}>
          {review && !under18 ? SCREENING.save : SCREENING.continue}
        </Key>
        <span className="lm-onb-foot__note" aria-live="polite">
          {missing.length > 0 ? (
            <button type="button" className="lm-link border-0 bg-transparent p-0" onClick={jumpToMissing} aria-label={`${SCREENING.remaining(missing.length)}. ${SCREENING.jumpTo}`}>
              {SCREENING.remaining(missing.length)}
            </button>
          ) : null}
        </span>
      </Foot>
      <Dialog
        open={confirmLift !== null}
        onClose={() => setConfirmLift(null)}
        role="alertdialog"
        title={SETTINGS_SAFETY.turnOffTitle(confirmLift?.join(' and ') ?? '')}
        footer={
          <>
            <Key onClick={() => setConfirmLift(null)}>{SETTINGS_SAFETY.turnOffKeep}</Key>
            <Key
              variant="solid"
              onClick={() => {
                setConfirmLift(null);
                onCommit(draft);
              }}
            >
              {SETTINGS_SAFETY.turnOffConfirm}
            </Key>
          </>
        }
      >
        <p className="m-0">{SETTINGS_SAFETY.turnOffBody}</p>
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Step 3 — consent ("Before you start"), with the safety summary
   --------------------------------------------------------------------------- */

function ConsentStep({ headingRef, answers, updated, onAccept }: { headingRef: HeadingRef; answers: ScreeningAnswers; updated: boolean; onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  const [full, setFull] = useState(false);
  const outcome = useMemo(() => evaluateScreening(answers), [answers]);
  const change = DISCLAIMER_CHANGES[ACK_VERSIONS.disclaimer];

  // ⌘/Ctrl + Enter continues when valid (design §7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && checked && !full) {
        e.preventDefault();
        onAccept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checked, full, onAccept]);

  // Enter on the checkbox toggles it (design §7; Space works natively).
  const onCheckKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).matches('input[type="checkbox"]')) {
      e.preventDefault();
      setChecked((c) => !c);
    }
  };

  return (
    <>
      <div className="lm-onb-col">
        <header className="lm-onb-head">
          <h1 ref={headingRef} className="lm-title" tabIndex={-1}>
            {CONSENT.title}
          </h1>
        </header>
        {updated ? (
          <Notice severity="info" title={CONSENT.updatedTitle}>
            <p className="m-0">
              {CONSENT.updatedBody}
              {change ? (
                <>
                  {' '}
                  <strong>{CONSENT.whatChanged}:</strong> {change}
                </>
              ) : null}
            </p>
          </Notice>
        ) : null}
        <SafetySummary outcome={outcome} />
        <Faceplate title={CONSENT.heading}>
          <div className="grid gap-4">
            <ol className="lm-onb-ol">
              {CONSENT.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            <div className="lm-onb-consent-check" onKeyDown={onCheckKey}>
              <Checkbox checked={checked} onChange={setChecked} label={CONSENT.check} />
              <button type="button" className="lm-link inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm" aria-haspopup="dialog" onClick={() => setFull(true)}>
                {CONSENT.fullDisclaimer}
                <Icon icon={ChevronRight} size={16} />
              </button>
            </div>
          </div>
        </Faceplate>
      </div>
      <Foot>
        <Key variant="solid" size="lg" disabledReason={checked ? undefined : CONSENT.continueBlocked} onClick={onAccept}>
          {CONSENT.continue}
        </Key>
        <span className="lm-onb-foot__note max-md:hidden">{CONSENT.shortcut}</span>
      </Foot>
      <Dialog open={full} onClose={() => setFull(false)} title={CONSENT.fullDisclaimer} size="wide">
        <DisclaimerFull size="sm" />
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Hard stop (under 18)
   --------------------------------------------------------------------------- */

function StopStep({ headingRef, onMistake }: { headingRef: HeadingRef; onMistake: () => void }) {
  return (
    <div className="lm-onb-col">
      <Faceplate as="section" aria-labelledby="lm-stop-title" className="lm-onb-stop">
        <h1 ref={headingRef} id="lm-stop-title" className="lm-title" tabIndex={-1}>
          {HARD_STOP.title}
        </h1>
        <p className="m-0 text-md leading-[1.6] text-ink">{HARD_STOP.body}</p>
        <div className="border-t border-line pt-4">
          <HelpCard headingAs="h2" compact />
        </div>
        <div className="grid gap-2 border-t border-line pt-4">
          <p className="m-0 text-sm text-ink-2">{HARD_STOP.evidence}</p>
          <div className="flex flex-wrap gap-2">
            <KeyLink to={paths.evidence}>{HARD_STOP.evidenceLink}</KeyLink>
            <Key variant="quiet" onClick={onMistake}>
              {HARD_STOP.mistake}
            </Key>
          </div>
        </div>
      </Faceplate>
    </div>
  );
}
