import '../boot';
/**
 * Coach (`/coach`, `/coach/:conversationId`; living-mode.md, Coach). One continuous conversation: rows separated by
 * hairlines, the cards each turn produced inline (read · log · edit · destructive · blocked · UI-only), the composer at
 * the foot, and "What the Coach knows" in a slide-in panel (a bottom sheet on phones). Works in both modes — without a
 * plan it is the planning helper (IA: the Coach exists in both modes). Everything comes from a `CoachAdapter`; the
 * page never talks to a provider, and destructive cards are completed only by the person in the typed dialog.
 */
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { BookOpenText } from 'lucide-react';
import { Engraved, Faceplate, Key, KeyLink, Page, ResponsivePanel, toast } from '@/components';
import { TopBar } from '@/app/shell';
import { localDateOf, useLivingClock, useToday } from '../clock';
import { useLiving } from '../data/source';
import { useLivingActions } from '../data/actions';
import { fmtDay } from '../format';
import { livingPaths } from '../paths';
import { withClock, type ChangeAction } from '../model/changeCard';
import { CoachComposer, type CoachComposerMessage } from '../components/CoachComposer';
import type { ChangeActionExtra, ChangeCardView } from '../components/ChangeCard';
import { TypedConfirmDialog } from '../components/TypedConfirmDialog';
import { MAIN_CONVERSATION, useCoachAdapter, useCoachRevision, type CoachTurn } from './adapter';
import { BRIEFING_COPY, COACH_COPY as T } from './copy';
import { CoachTurnRow } from './components/CoachTurnRow';
import { BriefingBody } from './components/BriefingBody';
import { CoachStateNotice, blockedReason } from './components/CoachStateNotice';
import './coach.css';

/** What a tab hands over with a draft: the screen it came from (the message's "[context: from train, …]"), a date, a slot. */
type DraftContext = { date?: string; slot?: string; slotName?: string; screen?: string };

interface DraftState {
  /** `prefill`: put the text in the composer to finish instead of sending it (Food's "Tell the Coach instead"). */
  draft?: { text?: string; photo?: File; context?: Record<string, unknown>; prefill?: boolean };
}

function draftContext(raw: Record<string, unknown> | undefined): DraftContext {
  const out: DraftContext = {};
  for (const k of ['date', 'slot', 'slotName', 'screen'] as const) {
    const v = raw?.[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

function replyAnnouncement(turn: CoachTurn | undefined): string {
  if (!turn || turn.role !== 'coach') return '';
  const cards = turn.cards.length ? ` ${T.announceCards(turn.cards.length)}` : '';
  return turn.error ? turn.error.message : `${T.announceReply(turn.text)}${cards}`;
}

export default function CoachPage() {
  const adapter = useCoachAdapter();
  useCoachRevision(adapter);
  const clock = useLivingClock();
  const todayDate = useToday();
  const actions = useLivingActions();
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: param } = useParams();
  const [search] = useSearchParams();
  const convHeadingId = useId();

  const view = useLiving((s) => s.today(todayDate), [todayDate]);
  const status = adapter.status();
  const ready = status.kind !== 'noProvider';
  const conversations = adapter.conversations();
  const conversationId = param ?? conversations[0]?.id ?? MAIN_CONVERSATION;
  const unknownConversation = !!param && ready && !conversations.some((c) => c.id === param);
  const turns = adapter.history(conversationId);
  const briefing = useLiving(() => adapter.briefing(), [adapter, status]);
  const now = clock.now();

  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [kept, setKept] = useState<(CoachComposerMessage & { from?: DraftContext }) | null>(null);
  const [confirmCard, setConfirmCard] = useState<ChangeCardView | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);
  const [briefOpen, setBriefOpen] = useState(() => search.get('briefing') === '1');
  const [prefill, setPrefill] = useState({ text: '', n: 0 });
  // the context of a prefilled draft (Food's slot and date) goes with the next message sent
  const [carried, setCarried] = useState<DraftContext | null>(null);
  const [offscreen, setOffscreen] = useState<ReadonlySet<string>>(() => new Set());

  const quietMode = !!view?.quietMode;
  const quiet = quietMode && !showNumbers;
  const provider = status.provider ?? 'your provider';
  const chips = view?.plan ? view.coachPrompts : T.planningPrompts;
  const offline = status.kind === 'offline';

  /* ------------------------------------------------------------------ sending */
  const send = async (msg: CoachComposerMessage, from: DraftContext = {}) => {
    if (offline) {
      setKept({ ...msg, from });
      return;
    }
    if (busy || !ready) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setAnnouncement('');
    try {
      await adapter.send(
        { conversationId, text: msg.text, ...(msg.photo ? { photo: msg.photo } : {}), context: { date: todayDate, screen: 'coach', ...from } },
        (e) => {
          if (e.type === 'done') setAnnouncement(replyAnnouncement(adapter.history(conversationId).at(-1)));
          else if (e.type === 'error') setAnnouncement(e.message);
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) setAnnouncement(T.announceStopped);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };
  const stop = () => abortRef.current?.abort();

  // the newest turn stays in view: on open, when a turn is added and when the reply is done (a long conversation left
  // the reply far below the fold on a phone)
  const lastTurnKey = `${turns.length}:${turns.at(-1)?.id ?? ''}:${busy}`;
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView?.({ block: 'center' });
  }, [lastTurnKey]);

  // Today's log bar hands over a draft in the navigation state: read it once, send it, clear it.
  const takeDraft = useEffectEvent((draft: NonNullable<DraftState['draft']>) => {
    navigate(location.pathname, { replace: true, state: null });
    const text = draft.text?.trim() ?? '';
    const from = draftContext(draft.context);
    if (draft.prefill) {
      setPrefill((p) => ({ text, n: p.n + 1 }));
      setCarried(from);
      return;
    }
    if (!text && !draft.photo) return;
    if (!ready) {
      setPrefill((p) => ({ text, n: p.n + 1 }));
      setCarried(from);
      return;
    }
    void send({ text, ...(draft.photo ? { photo: draft.photo } : {}) }, from);
  });
  const draftTaken = useRef(false);
  const draft = (location.state as DraftState | null)?.draft;
  useEffect(() => {
    if (!draft || draftTaken.current) return;
    draftTaken.current = true;
    queueMicrotask(() => takeDraft(draft));
  }, [draft]);

  /* ------------------------------------------------------------------ cards */
  const pending = turns
    .flatMap((t) => t.cards)
    .map((c) => withClock(c, now))
    .filter((c) => (c.class === 'edit' || c.class === 'destructive') && (c.state === 'pending' || c.state === 'stale'));
  const pendingKey = pending.map((c) => c.id).join(' ');

  // "1 proposal waiting" pins under the context row while a pending proposal is scrolled out of view
  useEffect(() => {
    const root = logRef.current;
    if (!root || !pendingKey || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      setOffscreen((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.cardId;
          if (!id) continue;
          if (e.isIntersecting) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    });
    for (const id of pendingKey.split(' ')) {
      const el = root.querySelector(`[data-card-id="${id}"]`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [pendingKey]);
  const waiting = pending.filter((c) => offscreen.has(c.id));

  const showPending = () => {
    const first = waiting[0];
    if (!first) return;
    logRef.current?.querySelector(`[data-card-id="${first.id}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const onCardAction = async (card: ChangeCardView, action: ChangeAction, extra?: ChangeActionExtra) => {
    if (card.class === 'destructive' && action === 'review') {
      setConfirmCard(card);
      return;
    }
    if (action === 'edit' && !extra && card.class === 'log' && !card.meal) {
      navigate(livingPaths.food(todayDate));
      return;
    }
    if (action === 'adjust') setPrefill((p) => ({ text: T.adjustDraft(card.title.replace(/^Proposal · /, '')), n: p.n + 1 }));
    const r = await adapter.act(card.id, action, extra);
    if (!r.ok && r.message) toast(r.message);
  };

  const confirm = confirmCard?.confirm;
  const onConfirm = async (typed: string) => {
    if (!confirmCard || !confirm) return;
    if (confirm.word !== 'end') {
      toast(T.cantComplete);
      setConfirmCard(null);
      return;
    }
    const r = await actions.end(typed);
    if (!r.ok) {
      if (r.message) toast(r.message);
      return;
    }
    await adapter.act(confirmCard.id, 'review', { outcome: 'confirmed' });
    setConfirmCard(null);
    toast(T.ended);
  };

  /* ------------------------------------------------------------------ briefing */
  const briefingShown = briefOpen;
  const toggleBriefing = () => setBriefOpen((o) => !o);

  /* ------------------------------------------------------------------ conversation rows */
  const rows: ReactNode[] = [];
  let prevDay: string | null = null;
  let prevSegment: number | undefined;
  turns.forEach((turn, i) => {
    const day = localDateOf(new Date(turn.at));
    if (day !== prevDay) {
      rows.push(
        <h3 key={`day-${day}`} className="lv-coach-day lm-eng">
          {fmtDay(day)}
        </h3>,
      );
      prevDay = day;
    }
    if (turn.segment !== undefined && prevSegment !== undefined && turn.segment !== prevSegment) {
      rows.push(
        <p key={`seg-${turn.id}`} className="lv-coach-segment">
          {T.segment}
        </p>,
      );
    }
    if (turn.segment !== undefined) prevSegment = turn.segment;
    const prevYou = turn.error ? turns.slice(0, i).findLast((t) => t.role === 'you') : undefined;
    rows.push(
      <CoachTurnRow
        key={turn.id}
        turn={turn}
        now={now}
        quiet={quiet}
        provider={provider}
        onCardAction={(c, a, x) => void onCardAction(c, a, x)}
        onRetry={prevYou && !busy ? () => void send({ text: prevYou.text }) : undefined}
      />,
    );
  });

  const empty = !ready && status.problem ? (
    <div className="lv-coach-empty" role="alert">
      <p className="lv-coach-empty__title">{T.setupFailed.title}</p>
      <p>{T.setupFailed.reason(status.problem)}</p>
      <p>
        <KeyLink to={T.settingsTo}>{T.setupFailed.fix}</KeyLink>
      </p>
      <p className="lv-coach-note">{T.noProvider.byHand}</p>
    </div>
  ) : !ready ? (
    <div className="lv-coach-empty">
      <p className="lv-coach-empty__title">{T.noProvider.title}</p>
      <p>{T.noProvider.body}</p>
      <p>
        <KeyLink to={T.settingsTo}>{T.noProvider.setup}</KeyLink>
      </p>
      <p className="lv-coach-note">{T.noProvider.byHand}</p>
    </div>
  ) : turns.length === 0 && !kept ? (
    <div className="lv-coach-empty">
      <p>{unknownConversation ? T.unknownConversation : view?.plan ? T.emptyReady : T.emptyPlanning}</p>
    </div>
  ) : null;

  return (
    <>
      <TopBar
        title={T.title}
        params={ready && status.model ? <Engraved>{T.modelLine(status.model, status.keyOwner ?? 'your key')}</Engraved> : undefined}
        actions={
          <>
            {quietMode ? (
              <Key size="sm" variant="quiet" pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
                {T.showNumbers}
              </Key>
            ) : null}
            <Key size="sm" variant="quiet" icon={BookOpenText} pressed={briefingShown} onClick={toggleBriefing}>
              {T.briefingKey}
            </Key>
          </>
        }
      />
      <Page className="lv-coach">
        {waiting.length ? (
          <div className="lv-coach-waiting">
            <Key size="sm" onClick={showPending}>
              {T.proposalsWaiting(waiting.length)}
            </Key>
          </div>
        ) : null}
        <div className="lv-coach-grid">
          <div className="lv-coach-main">
            {ready ? <CoachStateNotice status={status} /> : null}
            {quietMode && !showNumbers ? <p className="lv-coach-quiet">{T.quiet}</p> : null}
            <Faceplate variant="flush" className="lv-coach-conv" aria-labelledby={convHeadingId}>
              <h2 id={convHeadingId} className="lm-sr">
                {T.conversation}
              </h2>
              <div ref={logRef} role="log" aria-label={T.logLabel} aria-live="off" className="lv-coach-log">
                {empty}
                {rows}
                {kept ? (
                  <div className="lv-coach-turn" data-role="you" data-kept="true">
                    <span className="lv-coach-who lm-eng">{T.you}</span>
                    <div className="lv-coach-body">
                      <p className="lv-coach-text">{kept.text}</p>
                      <p className="lv-coach-note">{T.notSent}</p>
                      <div className="lv-coach-keys">
                        <Key
                          size="sm"
                          disabledReason={offline ? T.offlineReason : undefined}
                          onClick={() => {
                            const m = kept;
                            setKept(null);
                            void send(m, m.from);
                          }}
                        >
                          {T.sendNow}
                        </Key>
                        <Key size="sm" variant="quiet" onClick={() => setKept(null)}>
                          {T.discardKept}
                        </Key>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="lv-coach-compose">
                <CoachComposer
                  key={prefill.n}
                  variant="full"
                  defaultText={prefill.text}
                  autoFocus={prefill.n > 0}
                  onSend={(m) => {
                    const from = carried ?? undefined;
                    setCarried(null);
                    void send(m, from);
                  }}
                  busy={busy}
                  onStop={stop}
                  disabledReason={!ready ? T.composerReason : blockedReason(status)}
                  chips={chips}
                  vision={status.vision}
                />
              </div>
            </Faceplate>
            <div className="lm-sr" aria-live="polite">
              {announcement}
            </div>
          </div>
        </div>
        <ResponsivePanel open={briefOpen} onClose={() => setBriefOpen(false)} title={BRIEFING_COPY.title}>
          <BriefingBody model={briefing} />
        </ResponsivePanel>
        {confirmCard && confirm ? (
          <TypedConfirmDialog
            open
            onClose={() => setConfirmCard(null)}
            title={T.confirmTitle(confirmCard.title)}
            body={confirm.consequence}
            word={confirm.word}
            instruction={T.typeToConfirm(confirm.word)}
            confirmLabel={confirm.actionLabel}
            onConfirm={onConfirm}
          />
        ) : null}
      </Page>
    </>
  );
}
