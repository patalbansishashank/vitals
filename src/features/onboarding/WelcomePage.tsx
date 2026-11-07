import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Checkbox, Dialog, Faceplate, Icon, IconKey, Key, KeyLink, MQ, Notice, cx, useMediaQuery } from '@/components';
import { RingMark } from '@/components/brand/RingMark';
import { Frost } from '@/app/shell/Frost';
import { paths } from '@/app/paths';
import { TODAY_PATH } from '@/app/shell/nav';
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
import { FlowSteps } from './FlowSteps';
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
/** The hard stop's h1 (in the header): its card is labelled by it. */
const STOP_TITLE_ID = 'lm-stop-title';

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
 * (with the safety outcome) → Your body. Also serves the hard stop (under 18), re-consent after a
 * disclaimer change, and "Review my answers" (Settings, imports, yearly review). Full-screen, no tab bar. The header
 * is the setup flow's one intake header, the same as the intake chapters' (the shell's pushed header classes): Back,
 * the step's name centred, the step segments under it; no count, no ⋯, nothing else. The step's one primary key sits
 * in a sticky foot, in a pill of its own over the frost (on the intro, on phones only); the brand mark leads the
 * intro's own text.
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
  const barRef = useRef<HTMLElement>(null);
  useHeaderFrost(barRef);
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
      // First run always continues to Your body setup (spec §2); reviews return where they came from, else to Today (home
      // in every mode, 0.6.3: never the last screen, which could be Settings)
      const target = firstRun ? `${paths.body}?setup=basics` : (from ?? (review === 'settings' ? paths.settings('safety') : null) ?? TODAY_PATH);
      navigate(target, { replace: true });
    },
    [from, review, navigate],
  );

  // A fully set-up visitor who opens /welcome without a step goes back to Vitals.
  if (gate.status === 'ready' && !requested) return <Navigate to={from ?? TODAY_PATH} replace />;

  const back: (() => void) | null =
    step === 'screening' ? () => (review === 'settings' ? finish() : go('intro')) : step === 'consent' ? () => go('screening', { review: review ?? undefined }) : null;
  const showProgress = step !== 'stop' && review !== 'settings';
  const title = step === 'stop' ? HARD_STOP.title : STEP_NAMES[step];

  return (
    <div className="lm-onb" data-step={step}>
      <header ref={barRef} className="lm-ctx-slot lm-onb__bar">
        {/* the shell's tintless frost: clear at rest, in over the first 80 px of scroll (useHeaderFrost) */}
        <Frost side="top" />
        <div className="lm-ctx" data-phone="pushed" data-desk="pushed">
          <div className="lm-ctx__row">
            {back ? <IconKey className="lm-ctx__back" icon={ChevronLeft} label={PROGRESS.back} onClick={back} /> : null}
            <div className="lm-ctx__heading">
              {/* the step's name is its h1, as a chapter's is; the intro's h1 is its headline, so its name is plain text */}
              {step === 'intro' ? (
                <p className="lm-title">{title}</p>
              ) : (
                <h1 ref={headingRef} id={step === 'stop' ? STOP_TITLE_ID : undefined} className="lm-title" tabIndex={-1}>
                  {title}
                </h1>
              )}
            </div>
          </div>
          {showProgress ? (
            <div className="lm-ctx__progress">
              <StepSegments current={STEP_INDEX[step as Exclude<Step, 'stop'>]} />
            </div>
          ) : null}
        </div>
      </header>
      <main id="main" className="lm-onb__main" tabIndex={-1}>
        {step === 'intro' ? <IntroStep headingRef={headingRef} onStart={() => go('screening')} /> : null}
        {step === 'screening' ? (
          <ScreeningStep
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

/** The header's frost follows the scroll like the shell's: `--lm-frost` 0 at the top, 1 after 80 px. */
function useHeaderFrost(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => el.style.setProperty('--lm-frost', Math.min(1, Math.max(0, window.scrollY / 80)).toFixed(2));
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [ref]);
}

/** The three first-run steps as the flow's segments: the finished ones filled, the step you are on gold, the track after it. */
function StepSegments({ current }: { current: number }) {
  const names = [STEP_NAMES.intro, STEP_NAMES.screening, STEP_NAMES.consent];
  return (
    <FlowSteps
      list
      label={PROGRESS.label}
      steps={names.map((n, i) => ({
        id: n,
        state: i < current ? 'done' : i === current ? 'current' : 'todo',
        srText: `${n}${i < current ? PROGRESS.done : i === current ? PROGRESS.current(i + 1, names.length) : ''}`,
      }))}
    />
  );
}

/**
 * The step's sticky foot: its keys in a floating pill over the mirrored header frost (onboarding.css). Its height is
 * written to `--lm-onb-foot-h` so focus scrolling keeps what it moves to clear of the foot.
 */
function Foot({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--lm-onb-foot-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--lm-onb-foot-h');
    };
  }, []);
  return (
    <div ref={ref} className={cx('lm-onb-foot', className)}>
      <div className="lm-onb-foot__frost" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="lm-onb-foot__inner">{children}</div>
    </div>
  );
}

type HeadingRef = RefObject<HTMLHeadingElement | null>;

/* ---------------------------------------------------------------------------
   Step 1 — intro
   --------------------------------------------------------------------------- */

function IntroStep({ headingRef, onStart }: { headingRef: HeadingRef; onStart: () => void }) {
  // the import is a real secondary key (r068 V-WE-1): beside Get started inline on desktop, in the docked foot on phones
  const desktop = useMediaQuery(MQ.lg);
  return (
    <>
      <div className="lm-onb-intro">
        <div className="lm-onb-intro__text">
          <span className="lm-wordmark lm-onb-intro__brand" role="img" aria-label="Vitals">
            <RingMark size={22} />
            <span aria-hidden="true">vitals</span>
          </span>
          <h1 ref={headingRef} className="lm-onb-display" tabIndex={-1}>
            {WELCOME.headline}
          </h1>
          <p className="lm-onb-intro__body">{WELCOME.body}</p>
          <div className="lm-onb-intro__actions">
            <Key variant="primary" size="lg" arrow onClick={onStart} className="lm-onb-intro__start">
              {WELCOME.start}
            </Key>
            {desktop ? (
              <KeyLink to={paths.settings('data')} variant="outlined" size="lg" className="lm-onb-intro__import">
                {WELCOME.importAction}
              </KeyLink>
            ) : null}
          </div>
        </div>
        <div className="lm-onb-intro__footer">
          <DisclaimerFooter />
        </div>
      </div>
      <Foot className="lm-onb-intro__foot">
        {desktop ? null : (
          <KeyLink to={paths.settings('data')} variant="outlined" size="lg" aria-label={WELCOME.importAction} className="lm-onb-foot__second">
            {WELCOME.importShort}
          </KeyLink>
        )}
        <Key variant="primary" size="lg" arrow onClick={onStart}>
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
  draft: ScreeningAnswers;
  setDraft: Dispatch<SetStateAction<ScreeningAnswers>>;
  review: Review;
  scoffPrivacyNote: boolean;
  storedAnswers: ScreeningAnswers | null;
  onCommit: (answers: ScreeningAnswers) => void;
}

function ScreeningStep({ draft, setDraft, review, scoffPrivacyNote, storedAnswers, onCommit }: ScreeningStepProps) {
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
      <div className="lm-onb-col lm-onb-col--form">
        <details className="lm-onb-why lm-material">
          <summary>
            {SCREENING.whyTitle}
            <Icon icon={ChevronRight} size={16} />
          </summary>
          <p>{SCREENING.why}</p>
        </details>
        {!storage ? <Notice severity="caution" title={SCREENING.storageBlocked} /> : null}
        {reviewNote ? <Notice severity="info" title={reviewNote} /> : null}
        <ScreeningForm answers={draft} onChange={setDraft} scoffPrivacyNote={scoffPrivacyNote} />
      </div>
      <Foot>
        <Key variant="primary" size="lg" disabledReason={missing.length > 0 ? SCREENING.continueBlocked : undefined} onClick={submit}>
          {review && !under18 ? SCREENING.save : SCREENING.continue}
        </Key>
        {/* how many are left is a real key beside Continue: it takes you to the next unanswered question (r068 WE-1) */}
        <span className="lm-onb-foot__note" aria-live="polite">
          {missing.length > 0 ? (
            <Key variant="outlined" size="lg" trailingIcon={ArrowDown} onClick={jumpToMissing} aria-label={`${SCREENING.remaining(missing.length)}. ${SCREENING.jumpTo}`}>
              {SCREENING.remainingShort(missing.length)}
            </Key>
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
            <Key variant="text" onClick={() => setConfirmLift(null)}>
              {SETTINGS_SAFETY.turnOffKeep}
            </Key>
            <Key
              variant="text"
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

function ConsentStep({ answers, updated, onAccept }: { answers: ScreeningAnswers; updated: boolean; onAccept: () => void }) {
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
        <SafetySummary outcome={outcome} locks={false} bodyNote={false} />
        <Faceplate title={CONSENT.heading}>
          <ul className="lm-onb-points">
            {CONSENT.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="lm-onb-consent-check" onKeyDown={onCheckKey}>
            <Checkbox checked={checked} onChange={setChecked} label={CONSENT.check} />
            <button type="button" className="lm-onb-disclosure" aria-haspopup="dialog" onClick={() => setFull(true)}>
              {CONSENT.fullDisclaimer}
              <Icon icon={ChevronRight} size={16} />
            </button>
          </div>
        </Faceplate>
      </div>
      <Foot>
        <Key variant="primary" size="lg" disabledReason={checked ? undefined : CONSENT.continueBlocked} onClick={onAccept}>
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

function StopStep({ onMistake }: { onMistake: () => void }) {
  return (
    <div className="lm-onb-col">
      <p className="lm-onb-lead">{HARD_STOP.body}</p>
      <Faceplate as="section" aria-labelledby={STOP_TITLE_ID} className="lm-onb-stop">
        <HelpCard headingAs="h2" compact />
        <div className="lm-onb-stop__more">
          <p className="m-0 text-sm text-ink-2">{HARD_STOP.evidence}</p>
          <div className="flex flex-wrap gap-2">
            <KeyLink to={paths.evidence} variant="action">
              {HARD_STOP.evidenceLink}
            </KeyLink>
            <Key variant="text" onClick={onMistake}>
              {HARD_STOP.mistake}
            </Key>
          </div>
        </div>
      </Faceplate>
    </div>
  );
}
