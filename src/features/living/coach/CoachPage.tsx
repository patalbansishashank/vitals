import '../boot';
/**
 * Coach (`/coach`, `/coach/:conversationId`; living-mode.md, Coach). One continuous conversation on the page (no card
 * around it): your messages as plain bubbles at the right, the Coach's text at the left with the cards each turn
 * produced (read · log · edit · destructive · blocked · UI-only), and the composer floating at the foot. The header
 * holds the title, a status capsule (a proposal scrolled out of view, the connection) and the one ⋯ ("What the Coach
 * knows", quiet mode's numbers). Works in both modes — without a plan it is the planning helper. Everything comes from a
 * `CoachAdapter`; the page never talks to a provider, and destructive cards are completed only by the person in the
 * typed dialog.
 */
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Inbox, MessageCircle, Utensils, Scale, Route } from 'lucide-react';
import {
  CardHead,
  GradientCard,
  Icon,
  Key,
  KeyLink,
  MonoMeta,
  Page,
  ResponsivePanel,
  StatusCapsule,
  StatusDot,
  toast,
} from '@/components';
import { TopBar, type MenuEntry } from '@/app/shell';
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
import { BRIEFING_COPY, COACH_COPY as T, INFO } from './copy';
import { CoachTurnRow } from './components/CoachTurnRow';
import { BriefingBody } from './components/BriefingBody';
import {
  CoachProviderBanner,
  blockedReason,
  capabilityLine,
  connectionCapsule,
} from './components/CoachStateNotice';
import { ServerChatsPanel, whenText } from './components/ServerChats';
import { infoSpec } from '../components/info';
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
  const offline = status.kind === 'offline';
  // sending can't work until the person fixes Settings: the composer says so honestly (disabled), the page says why
  // (the Coach on the paired server that can't answer yet, or is still being checked, too)
  const blocked = !ready || !!blockedReason(status) || status.kind === 'serverUnavailable';
  const server = adapter.server;
  const serverChat = server?.current() ?? null;
  const [chatsOpen, setChatsOpen] = useState(false);

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
        {
          conversationId,
          text: msg.text,
          ...(msg.photo ? { photo: msg.photo } : {}),
          context: { date: todayDate, screen: 'coach', ...from },
        },
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
  // (nothing to bring into view while the conversation is empty: the page stays at its top, under the header)
  const lastTurnKey = `${turns.length}:${turns.at(-1)?.id ?? ''}:${busy}`;
  const hasTurns = turns.length > 0;
  useEffect(() => {
    if (hasTurns) logRef.current?.lastElementChild?.scrollIntoView?.({ block: 'center' });
  }, [lastTurnKey, hasTurns]);

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
    .filter(
      (c) =>
        (c.class === 'edit' || c.class === 'destructive') && (c.state === 'pending' || c.state === 'stale'),
    );
  const pendingKey = pending.map((c) => c.id).join(' ');

  // "1 proposal waiting" shows in the header while a pending proposal is scrolled out of view
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
    logRef.current
      ?.querySelector(`[data-card-id="${first.id}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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
    if (action === 'adjust')
      setPrefill((p) => ({ text: T.adjustDraft(card.title.replace(/^Proposal · /, '')), n: p.n + 1 }));
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

  /* ------------------------------------------------------------------ header */
  // the one ⋯: the page's own items first (the shell adds its global items after a divider)
  const menu: MenuEntry[] = [];
  if (ready)
    menu.push({ id: 'coach-briefing', label: BRIEFING_COPY.title, onSelect: () => setBriefOpen(true) });
  if (quietMode)
    menu.push({
      id: 'coach-numbers',
      label: showNumbers ? T.hideNumbers : T.showNumbers,
      onSelect: () => setShowNumbers((v) => !v),
    });
  if (server) {
    // the Coach on the paired server: its temporary chats
    menu.push({ id: 'coach-chats', label: T.server.chats, onSelect: () => setChatsOpen(true) });
    if (serverChat) {
      menu.push({ id: 'coach-new', label: T.server.fresh, onSelect: () => server.fresh() });
      menu.push({
        id: 'coach-keep',
        label: T.server.keep(server.retentionHours()),
        onSelect: () =>
          void server.keep().then((r) => {
            toast(
              r.ok
                ? T.server.kept(whenText(r.expiresAt ?? serverChat.expiresAt, new Date()))
                : (r.message ?? T.server.listFailed),
            );
          }),
      });
      menu.push({
        id: 'coach-delete',
        label: T.server.remove,
        tone: 'danger',
        onSelect: () =>
          void server
            .remove()
            .then((r) => toast(r.ok ? T.server.removed : (r.message ?? T.server.listFailed))),
      });
    }
  }
  // the header's status icons: the connection's state (offline, busy), then proposals waiting
  const capsule = (
    <>
      {connectionCapsule(status)}
      {waiting.length ? (
        <StatusCapsule
          icon={Inbox}
          label={T.proposalsWaiting(waiting.length)}
          attention
          onClick={showPending}
        />
      ) : null}
    </>
  );

  /* ------------------------------------------------------------------ conversation rows */
  const rows: ReactNode[] = [];
  // facts about this conversation, at its start: what the model can't do, quiet mode
  const limit = ready ? capabilityLine(status) : null;
  if (limit)
    rows.push(
      <p key="limit" className="lv-coach-fact">
        {limit}
      </p>,
    );
  // the chat is temporary on the server: when it goes, as the one line at its start
  else if (serverChat?.expiresAt && turns.length)
    rows.push(
      <p key="until" className="lv-coach-fact">
        {T.server.until(whenText(serverChat.expiresAt, now))}
      </p>,
    );
  if (quiet)
    rows.push(
      <p key="quiet" className="lv-coach-fact">
        {T.quiet}
      </p>,
    );
  let prevDay: string | null = null;
  let prevSegment: number | undefined;
  turns.forEach((turn, i) => {
    const day = localDateOf(new Date(turn.at));
    if (day !== prevDay) {
      rows.push(
        <h3 key={`day-${day}`} className="lv-coach-day lm-meta">
          {fmtDay(day)}
        </h3>,
      );
      prevDay = day;
    }
    if (turn.segment !== undefined && prevSegment !== undefined && turn.segment !== prevSegment) {
      rows.push(
        <p key={`seg-${turn.id}`} className="lv-coach-fact">
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
  const empty = turns.length === 0 && !kept;
  const starters = [
    {
      id: 'meal',
      title: T.starters.meal,
      prompt: T.starters.mealPrompt,
      icon: Utensils,
      domain: 'food' as const,
    },
    {
      id: 'weight',
      title: T.starters.weight,
      prompt: T.starters.weightPrompt,
      icon: Scale,
      domain: 'body' as const,
    },
    {
      id: 'plan',
      title: view?.plan ? T.starters.plan : T.starters.choose,
      prompt: view?.plan ? T.starters.planPrompt : T.starters.choose,
      icon: Route,
      domain: 'plan' as const,
    },
  ];
  const introduction = empty ? (
    <div className="lv-coach-start" role={status.problem ? 'alert' : undefined}>
      <GradientCard
        domain="plan"
        glow="tr"
        head={
          <CardHead
            icon={MessageCircle}
            title={T.title}
            info={infoSpec(INFO.coach, {
              footer: (
                <div className="lv-coach-keys">
                  <Key variant="text" onClick={() => setBriefOpen(true)}>
                    {BRIEFING_COPY.title}
                  </Key>
                  <KeyLink variant="text" to={T.settingsTo}>
                    {T.settingsLink}
                  </KeyLink>
                </div>
              ),
            })}
          />
        }
      >
        <MonoMeta className="lv-coach-status" tone="hue">
          <StatusDot tone={blocked ? 'neutral' : 'live'} label={blocked ? T.setup : T.ready} pulse={busy} />
          {!quiet && ready ? [status.provider, status.model].filter(Boolean).join(' · ') : null}
        </MonoMeta>
        {!ready ? (
          <>
            <p className="lv-coach-setup-line">{status.problem ? T.setupFailed.title : T.noProvider.title}</p>
            {status.problem ? <MonoMeta>{status.problem}</MonoMeta> : null}
            <KeyLink variant="primary" arrow to={T.settingsTo}>
              {status.problem ? T.setupFailed.fix : T.noProvider.setup}
            </KeyLink>
          </>
        ) : null}
        {unknownConversation ? <p className="lv-coach-setup-line">{T.unknownConversation}</p> : null}
      </GradientCard>
      {!blocked && !unknownConversation ? (
        <div className="lv-coach-starters">
          {starters.map((starter) => (
            <GradientCard key={starter.id} domain={starter.domain} size="slim" className="lv-coach-starter">
              <button
                type="button"
                className="lv-coach-starter-key"
                aria-label={starter.title}
                onClick={() => {
                  setPrefill((p) => ({ text: starter.prompt, n: p.n + 1 }));
                }}
              >
                <Icon icon={starter.icon} size={22} />
                <span>
                  <strong>{starter.title}</strong>
                  <span className="lv-coach-starter-prompt">{starter.prompt}</span>
                </span>
              </button>
            </GradientCard>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <TopBar title={T.title} status={capsule} menu={menu} />
      <CoachProviderBanner status={status} />
      <Page className="lv-coach">
        {introduction}
        {ready ? (
          <section className="lv-coach-conv" aria-labelledby={convHeadingId}>
            <h2 id={convHeadingId} className="lm-sr">
              {T.conversation}
            </h2>
            <div
              ref={logRef}
              role="log"
              aria-label={T.logLabel}
              aria-live="off"
              className="lv-coach-log"
              data-empty={empty || undefined}
            >
              {rows}

              {kept ? (
                <div className="lv-coach-turn" data-role="you" data-kept="true">
                  <span className="lm-sr">{T.you}</span>
                  <div className="lv-coach-body">
                    <div className="lv-coach-bubble">
                      <p className="lv-coach-text">{kept.text}</p>
                    </div>
                    <p className="lv-coach-note" data-state="kept">
                      {T.notSent}
                    </p>
                    <div className="lv-coach-keys">
                      <Key
                        size="sm"
                        variant="action"
                        disabledReason={offline ? T.offlineReason : undefined}
                        onClick={() => {
                          const m = kept;
                          setKept(null);
                          void send(m, m.from);
                        }}
                      >
                        {T.sendNow}
                      </Key>
                      <Key size="sm" variant="outlined" onClick={() => setKept(null)}>
                        {T.discardKept}
                      </Key>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
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
            disabled={blocked}
            chips={[]}
            vision={status.vision}
          />
        </div>
        <div className="lm-sr" aria-live="polite">
          {announcement}
        </div>
        <ResponsivePanel open={briefOpen} onClose={() => setBriefOpen(false)} title={BRIEFING_COPY.title}>
          <BriefingBody model={briefing} />
        </ResponsivePanel>
        {server ? (
          <ServerChatsPanel
            open={chatsOpen}
            onClose={() => setChatsOpen(false)}
            controls={server}
            now={now}
            onOpened={() => setChatsOpen(false)}
          />
        ) : null}
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
