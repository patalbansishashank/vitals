/**
 * <ChangeCard> (COMPONENTS §13.11; living-mode.md, Coach: change review by confirmation class). One component, a look
 * per confirmation class, driven by the pure model in `../model/changeCard` (states, transitions, actions on offer):
 *   read        — one collapsed line "⌕ looked at · …" with a disclosure listing each lookup
 *   log         — applied with values, source and likely range; Edit · Undo (24 h); "what I saw" for photos
 *   edit        — a proposal: diff, goal dates before → after, metric impacts; Apply (solid, never pre-focused) ·
 *                 Adjust · Discard; turns stale with a refreshed version (Apply only after taking the update)
 *   destructive — "Needs your confirmation"; carries no action itself — "Review and confirm…" asks the page to open
 *                 the typed-confirmation dialog, which only the person can complete
 *   blocked     — the safety rule in plain words + the allowed alternatives as keys
 *   uiOnly      — "Only you can change that" + a link to the setting
 * Standalone (Today, Plan details) it is a Faceplate; inside the Coach conversation an inset region, so faceplates
 * never nest. Chrome is achromatic; colour sits on the destructive and blocked marks only.
 */
import { useId, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Diamond, Lock, Octagon, Search, TriangleAlert } from 'lucide-react';
import { EM_DASH, Faceplate, Field, Icon, Key, KeyLink, NumberField, RangeBar, StatusMark, cx, energyInText, formatNumber, formatSigned, type IconComponent } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { daysBetween } from '@/living/dates';
import { fmtDateRange, kcal as fmtKcal } from '../format';
import { availableActions, timeLeftText, withClock, type ChangeAction, type ChangeCardModel, type ChangeClass, type ChangeState } from '../model/changeCard';
import { CARD_COPY as C } from '../coach/copy';
import type { CardActionExtra, MarkersReviewCard } from '@/ai/coach/types';
import { SourceChip, type SourceInfo } from './Estimate';
import './changeCard.css';

/** One component of a logged meal, as the app computed it (grams and energy are the engine's, never the UI's). */
export interface MealComponentView {
  id: string;
  name: string;
  /** "1 katori", "2", "1 plate". */
  portion?: string;
  grams: number;
  /** Likely grams; equal to `grams` when you typed them. */
  gramsLow: number;
  gramsHigh: number;
  kcal?: number;
  /** You typed these grams. */
  yours?: boolean;
}

/** The "what I saw" / meal detail of a log card. */
export interface MealCardView {
  /** The photo it was read from (72 px thumbnail); alt text from the "what I saw" summary. */
  photo?: { url: string; alt: string };
  components: MealComponentView[];
  /** Visible-fat cue: "looks glossy: about 2 tsp oil added". */
  cue?: string;
  /** Reference objects seen: "steel plate (about 26 cm)". */
  saw?: string[];
  /** What it could not see: "how deep the katori is". */
  unseen?: string[];
  /** Freshly read from a photo: highlighted until "Looks right". */
  review?: boolean;
  /** Confidence 0.4–0.7: one chip set on the weakest field; logs when answered. */
  ask?: { componentId: string; question: string; options: Array<{ id: string; label: string }> };
}

/** The card model plus the meal detail some log cards carry (and, E20, the read blood test report's review rows). */
export type ChangeCardView = ChangeCardModel & { meal?: MealCardView; markers?: MarkersReviewCard };

/** What a decision carries besides its action. */
export interface ChangeActionExtra {
  /** Blocked cards: the alternative chosen. */
  alternativeId?: string;
  /** Meal cards: grams you typed for a component, or the answer to the one question. */
  componentId?: string;
  grams?: number;
  optionId?: string;
  /** Destructive cards: reported by the page after the person completed the typed confirmation. */
  outcome?: 'confirmed';
  /** E20 blood test report cards: the rows ticked in the review table (`markers.confirm` input). */
  markers?: CardActionExtra['markers'];
}

export interface ChangeCardProps {
  card: ChangeCardView;
  /** The clock's now (undo windows, expiry). */
  now: Date;
  /** `standalone` = a Faceplate (Today, Plan details); `conversation` = an inset region inside the Coach's faceplate. */
  context?: 'standalone' | 'conversation';
  onAction: (action: ChangeAction, extra?: ChangeActionExtra) => void;
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** Quiet mode: portions without kcal (the page's "show numbers" turns it off). */
  quiet?: boolean;
  className?: string;
  /**
   * Shown in place of the item list (E20: the Coach's review table of a read blood test report). On a pending report
   * card the table's own save key is the Apply (it passes the ticked rows), so the card shows no Apply key of its own.
   */
  detail?: ReactNode;
}

const MARK: Record<ChangeClass, IconComponent> = { read: Search, log: Check, edit: Diamond, destructive: Octagon, blocked: TriangleAlert, uiOnly: Lock };

/** The object named on the card's keys: "logged lunch", "proposal: no training Thu–Sat", "end Spring cut". */
export function cardObject(card: Pick<ChangeCardModel, 'class' | 'title'>): string {
  const segs = card.title.split(' · ').map((s) => s.trim());
  const first = segs[0] ?? card.title;
  const lead = first.charAt(0).toLowerCase() + first.slice(1);
  if (card.class === 'edit' && segs.length > 1) return `${lead}: ${segs.slice(1).join(' · ')}`;
  return lead;
}

/** The title as the header shows it (class prefix for confirm, blocked and UI-only cards). */
export function cardTitle(card: Pick<ChangeCardModel, 'class' | 'title'>): string {
  if (card.class === 'destructive') return `${C.needsConfirmation} · ${card.title}`;
  if (card.class === 'blocked') return `${C.notAllowed} · ${card.title}`;
  if (card.class === 'uiOnly') return card.title ? `${C.onlyYou} · ${card.title}` : C.onlyYou;
  if (card.class === 'read') return `${C.lookedAt} · ${card.title}`;
  return card.title;
}

/** Quiet mode: drop the energy segments of a " · "-joined line ("≈ 640 kcal (510–780) · protein 33 g" → "protein 33 g"). */
export function withoutEnergy(line: string): string {
  return line
    .split(' · ')
    .filter((seg) => !/\bkcal\b/.test(seg))
    .join(' · ');
}

function sourceInfo(s: NonNullable<ChangeCardModel['source']>): SourceInfo {
  const who = s.label.split(' · ')[0] ?? s.label;
  return { label: s.label, ...(s.confidence !== undefined ? { detail: C.sure(who, s.confidence) } : {}), ...(s.band ? { band: s.band } : {}) };
}

function announceFor(state: ChangeState, title: string): string {
  switch (state) {
    case 'applied':
      return C.announce.applied(title);
    case 'undone':
      return C.announce.undone(title);
    case 'discarded':
      return C.announce.discarded(title);
    case 'expired':
      return C.announce.expired(title);
    case 'stale':
      return C.announce.stale(title);
    default:
      return '';
  }
}

/* ------------------------------------------------------------------------------------------------ parts */

function Diff({ items, log, quiet }: { items: ChangeCardModel['items']; log?: boolean; quiet?: boolean }) {
  const eu = useEnergyUnit();
  if (!items.length) return null;
  return (
    <ul className="lv-card__diff" data-log={log || undefined}>
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="lv-card__row">
          <span className="lv-card__label">{it.label}</span>
          {log ? null : (
            <>
              <span className="lv-card__before">{it.before === null ? EM_DASH : energyInText(it.before, eu)}</span>
              <span className="lv-card__arrow" aria-hidden="true">
                →
              </span>
              <span className="lm-sr"> {C.changesTo} </span>
            </>
          )}
          <span className="lv-card__after">{it.after === null ? EM_DASH : quiet ? withoutEnergy(it.after) : energyInText(it.after, eu)}</span>
        </li>
      ))}
    </ul>
  );
}

function GoalDates({ rows }: { rows: NonNullable<ChangeCardModel['impact']>['goalDates'] }) {
  const ranges = rows.flatMap((r) => [r.before, r.after]).filter((x): x is [string, string] => !!x);
  const base = [...ranges.map((r) => r[0])].sort()[0];
  const off = (d: string) => (base ? daysBetween(base, d) : 0);
  const hi = ranges.length ? Math.max(...ranges.map((r) => off(r[1]))) : 0;
  const pad = Math.max(2, Math.round(hi * 0.3));
  const bar = (r: [string, string] | null) =>
    r ? (
      <RangeBar low={off(r[0])} high={off(r[1])} value={(off(r[0]) + off(r[1])) / 2} min={-pad} max={hi + pad} width={72}>
        <span className="lv-card__date">{fmtDateRange(r[0], r[1])}</span>
      </RangeBar>
    ) : (
      <span className="lv-card__date">{C.notReached}</span>
    );
  return (
    <ul className="lv-card__diff lv-card__goals">
      {rows.map((r) => (
        <li key={r.label} className="lv-card__row">
          <span className="lv-card__label">{r.label}</span>
          <span className="lv-card__before">{bar(r.before)}</span>
          <span className="lv-card__arrow" aria-hidden="true">
            →
          </span>
          <span className="lm-sr"> {C.changesTo} </span>
          <span className="lv-card__after">{bar(r.after)}</span>
        </li>
      ))}
    </ul>
  );
}

function Impact({ impact }: { impact: NonNullable<ChangeCardModel['impact']> }) {
  return (
    <>
      {impact.goalDates.length ? <GoalDates rows={impact.goalDates} /> : null}
      {impact.metrics.length ? (
        <ul className="lv-card__diff lv-card__metrics">
          {impact.metrics.map((m) => (
            <li key={m.label} className="lv-card__row">
              <span className="lv-card__label">{m.label}</span>
              <span className="lv-card__after lm-num">
                {formatSigned(m.delta, m.decimals ?? 1)} <span className="lm-unit">{m.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function amountText(c: MealComponentView): string {
  if (c.yours) return `${formatNumber(c.grams, 0)} g`;
  const portion = c.portion ? `${c.portion} ` : '';
  const range = c.gramsLow !== c.gramsHigh ? ` (${formatNumber(c.gramsLow, 0)}–${formatNumber(c.gramsHigh, 0)})` : '';
  return `${portion}≈ ${formatNumber(c.grams, 0)} g${range}`;
}

function MealBody({
  meal,
  editing,
  editable,
  quiet,
  onEditOne,
  onAction,
}: {
  meal: MealCardView;
  editing: string | null;
  editable: boolean;
  quiet: boolean;
  onEditOne: (id: string) => void;
  onAction: ChangeCardProps['onAction'];
}) {
  const eu = useEnergyUnit();
  return (
    <div className="lv-card__meal" data-review={meal.review || undefined}>
      {meal.photo?.url ? (
        <img className="lv-card__thumb" src={meal.photo.url} alt={meal.photo.alt} width={72} height={72} />
      ) : meal.photo ? (
        <span className="lv-card__thumb" role="img" aria-label={meal.photo.alt} />
      ) : null}
      <div className="lv-card__meal-body">
        <ul className="lv-card__diff" data-log="true">
          {meal.components.map((c) => {
            const amount = amountText(c);
            return (
              <li key={c.id} className="lv-card__row">
                <span className="lv-card__label">{c.name}</span>
                <span className="lv-card__after">
                  {editable && (editing === 'all' || editing === c.id) ? (
                    <Field label={C.gramsOf(c.name)} hideLabel className="lv-card__grams">
                      <NumberField value={c.grams} min={1} max={3000} step={5} unit="g" name={c.name} onChange={(g) => onAction('edit', { componentId: c.id, grams: g })} />
                    </Field>
                  ) : editable ? (
                    <button type="button" className="lm-chip lm-hit lv-card__gram" data-kind="plain" aria-label={C.changeGrams(c.name, amount)} onClick={() => onEditOne(c.id)}>
                      {amount}
                    </button>
                  ) : (
                    <span>{amount}</span>
                  )}
                </span>
                {!quiet && c.kcal !== undefined ? <span className="lv-card__kcal lm-num">{energyInText(`${fmtKcal(c.kcal)} kcal`, eu)}</span> : null}
              </li>
            );
          })}
        </ul>
        {meal.cue ? <p className="lv-card__line">{meal.cue}</p> : null}
        {meal.saw?.length ? (
          <p className="lv-card__line">
            <span className="lm-eng">{C.saw}:</span> {meal.saw.join(', ')}
          </p>
        ) : null}
        {meal.unseen?.length ? (
          <p className="lv-card__line">
            <span className="lm-eng">{C.couldntSee}:</span> {meal.unseen.join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReadLine({ card, titleId, context, className }: { card: ChangeCardModel; titleId: string; context: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const reads = card.reads ?? [];
  const labels = reads.length ? reads.map((r) => r.label).join(' · ') : card.title;
  return (
    <article className={cx('lv-card lv-card--read', className)} data-class="read" data-context={context} aria-labelledby={titleId}>
      <button type="button" className="lv-card__readkey" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
        <span className="lv-card__mark" aria-hidden="true">
          <Icon icon={Search} size={16} />
        </span>
        <span id={titleId} className="lv-card__readtext">
          <span className="lm-eng">{C.lookedAt}</span> · {labels}
        </span>
        <span className="lm-sr">{C.showLookups}</span>
        <Icon icon={open ? ChevronDown : ChevronRight} size={16} className="lv-card__chev" />
      </button>
      <ul id={listId} className="lv-card__reads" hidden={!open}>
        {reads.map((r, i) => (
          <li key={`${r.label}-${i}`}>
            <span className="lv-card__read-label">{r.label}</span>
            {r.summary ? <span className="lv-card__read-sum">{r.summary}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

/* ------------------------------------------------------------------------------------------------ card */

export function ChangeCard({ card: given, now, context = 'standalone', onAction, headingLevel = 'h3', quiet = false, className, detail }: ChangeCardProps) {
  const card = withClock(given, now) as ChangeCardView;
  const titleId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [seen, setSeen] = useState<ChangeState>(card.state);
  const [said, setSaid] = useState('');
  const title = cardTitle(card);
  if (seen !== card.state) {
    // announce state changes (not the first render): derived during render, no effect
    setSeen(card.state);
    setSaid(announceFor(card.state, title));
  }

  if (card.class === 'read') return <ReadLine card={card} titleId={titleId} context={context} className={className} />;

  const H = headingLevel;
  const obj = cardObject(card);
  const meal = card.meal;
  const collapsed = card.state === 'discarded';
  const left = collapsed ? null : timeLeftText(card, now);
  const actions = collapsed || card.state === 'expired' ? [] : availableActions(card, now);
  const mealEditable = !!meal && card.class === 'log' && card.state === 'applied' && actions.includes('edit');
  const isEditing = mealEditable && editing !== null;

  const keys: ReactNode[] = [];
  if (meal?.review && card.state === 'applied') {
    keys.push(
      <Key key="looksRight" size="sm" aria-label={C.name.looksRight(obj)} onClick={() => onAction('dismiss')}>
        {C.looksRight}
      </Key>,
    );
  }
  const tableApplies = !!detail && !!card.markers && card.state === 'pending';
  for (const a of actions) {
    switch (a) {
      case 'apply':
        if (tableApplies) break;
        keys.push(
          card.class === 'log' ? (
            <Key key={a} size="sm" variant="solid" aria-label={C.name.logIt(obj)} onClick={() => onAction('apply')}>
              {C.logIt}
            </Key>
          ) : (
            <Key key={a} size="sm" variant="solid" aria-label={C.name.apply(obj)} onClick={() => onAction('apply')}>
              {C.apply}
            </Key>
          ),
        );
        break;
      case 'adjust':
        keys.push(
          <Key key={a} size="sm" aria-label={C.name.adjust(obj)} onClick={() => onAction('adjust')}>
            {C.adjust}
          </Key>,
        );
        break;
      case 'discard':
        keys.push(
          <Key key={a} size="sm" variant="quiet" aria-label={C.name.discard(obj)} onClick={() => onAction('discard')}>
            {C.discard}
          </Key>,
        );
        break;
      case 'undo':
        keys.push(
          <Key key={a} size="sm" aria-label={C.name.undo(obj)} onClick={() => onAction('undo')}>
            {C.undo}
          </Key>,
        );
        break;
      case 'redo':
        keys.push(
          <Key key={a} size="sm" variant="quiet" aria-label={C.name.redo(obj)} onClick={() => onAction('redo')}>
            {C.redo}
          </Key>,
        );
        break;
      case 'edit':
        keys.push(
          isEditing ? (
            <Key key={a} size="sm" onClick={() => setEditing(null)}>
              {C.done}
            </Key>
          ) : (
            <Key key={a} size="sm" aria-label={C.name.edit(obj)} onClick={() => (mealEditable ? setEditing('all') : onAction('edit'))}>
              {C.edit}
            </Key>
          ),
        );
        break;
      case 'review':
        keys.push(
          card.class === 'destructive' ? (
            <Key key={a} size="sm" aria-label={C.name.review(obj)} onClick={() => onAction('review')}>
              {C.review}
            </Key>
          ) : (
            <Key key={a} size="sm" aria-label={C.name.useUpdated(obj)} onClick={() => onAction('review')}>
              {C.useUpdated}
            </Key>
          ),
        );
        break;
      case 'dismiss':
        keys.push(
          card.class === 'destructive' ? (
            <Key key={a} size="sm" variant="quiet" aria-label={C.name.notNow(obj)} onClick={() => onAction('dismiss')}>
              {C.notNow}
            </Key>
          ) : (
            <Key key={a} size="sm" variant="quiet" aria-label={C.name.leaveIt(obj)} onClick={() => onAction('dismiss')}>
              {C.leaveIt}
            </Key>
          ),
        );
        break;
      case 'alternative':
        for (const alt of card.blocked?.alternatives ?? []) {
          keys.push(
            <Key key={`alt-${alt.id}`} size="sm" onClick={() => onAction('alternative', { alternativeId: alt.id })}>
              {alt.label}
            </Key>,
          );
        }
        break;
      case 'open':
        if (card.setting) {
          keys.push(
            <KeyLink key={a} size="sm" to={card.setting.to} onClick={() => onAction('open')}>
              {card.setting.label}
            </KeyLink>,
          );
        }
        break;
    }
  }

  const note = card.class === 'destructive' ? (card.confirm?.consequence ?? card.note) : card.note;
  let body: ReactNode = null;
  if (card.state === 'expired') {
    body = <p className="lv-card__line lv-card__expired">{C.expired}</p>;
  } else if (!collapsed) {
    body = (
      <>
        {note ? <p className="lv-card__note">{note}</p> : null}
        {detail ? (
          detail
        ) : card.class === 'log' ? (
          meal ? (
            <MealBody meal={meal} editing={editing} editable={mealEditable} quiet={quiet} onEditOne={setEditing} onAction={onAction} />
          ) : (
            <Diff items={card.items} log quiet={quiet} />
          )
        ) : null}
        {card.class === 'log' && card.totals ? (
          <p className="lv-card__line lv-card__totals">
            <span className="lm-eng">{C.total}</span> {quiet ? withoutEnergy(card.totals) : card.totals}
          </p>
        ) : null}
        {card.class === 'log' && meal?.ask && card.state === 'pending' ? (
          <div className="lv-card__ask" role="group" aria-label={meal.ask.question}>
            <p className="lv-card__line">{meal.ask.question}</p>
            <div className="lv-card__keys">
              {meal.ask.options.map((o) => (
                <Key key={o.id} size="sm" onClick={() => onAction('edit', { componentId: meal.ask!.componentId, optionId: o.id })}>
                  {o.label}
                </Key>
              ))}
            </div>
          </div>
        ) : null}
        {card.class === 'edit' && card.state === 'stale' ? (
          <div className="lv-card__stale">
            <p className="lv-card__line lv-card__stale-note">
              <StatusMark severity="caution" size={16} /> {C.stale}
            </p>
            <Diff items={card.refreshed?.items ?? card.items} />
            {card.refreshed?.impact ? <Impact impact={card.refreshed.impact} /> : null}
          </div>
        ) : card.class === 'edit' ? (
          <>
            <Diff items={card.items} />
            {card.impact ? <Impact impact={card.impact} /> : null}
          </>
        ) : null}
        {card.class === 'blocked' && card.blocked ? (
          <p className="lv-card__note">
            {card.blocked.rule}
            {card.blocked.alternatives.length ? ` ${C.options}` : ''}
          </p>
        ) : null}
      </>
    );
  }

  const inner = (
    <>
      <div className="lv-card__head">
        <span className="lv-card__mark" data-class={card.class} aria-hidden="true">
          <Icon icon={MARK[card.class]} size={16} />
        </span>
        <H id={titleId} className="lv-card__title">
          {collapsed ? `${C.discarded} · ${title}` : title}
          {card.state === 'undone' ? <span className="lm-sr"> {C.undone}</span> : null}
        </H>
        {card.source && !collapsed ? <SourceChip source={sourceInfo(card.source)} /> : null}
        {left ? <span className="lm-eng lv-card__left">{left}</span> : null}
      </div>
      {body}
      {keys.length ? <div className="lv-card__keys">{keys}</div> : null}
      <span className="lm-sr" aria-live="polite">
        {said}
      </span>
    </>
  );

  const data = { 'data-class': card.class, 'data-state': card.state, 'data-context': context };
  if (context === 'standalone') {
    return (
      <Faceplate as="article" className={cx('lv-card', className)} aria-labelledby={titleId} {...data}>
        {inner}
      </Faceplate>
    );
  }
  return (
    <article className={cx('lv-card', className)} aria-labelledby={titleId} {...data}>
      {inner}
    </article>
  );
}
