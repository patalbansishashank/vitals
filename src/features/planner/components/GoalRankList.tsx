import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowLeftRight, Ellipsis, Link2, X } from 'lucide-react';
import { GradeBadge, Icon, IconKey, KeyBank, Menu, Popover, Select, Swatch, VisuallyHidden, useReducedMotion, type MenuItem } from '@/components';
import type { GoalDraft, GoalMode, GoalStrength } from '@/state/plannerStore';
import { gradeDHelp, STRENGTH_HELP, STRENGTH_LABEL, goalMetric, modeSpec, modeTakesAmount } from '../catalogue';
import type { GoalRelation } from '../relations';
import { TargetEditor } from './TargetEditor';

export interface GoalRankListProps {
  goals: readonly GoalDraft[];
  onMove: (from: number, to: number) => void;
  onUpdate: (key: string, patch: Partial<Omit<GoalDraft, 'key' | 'metric'>>) => void;
  onRemove: (key: string) => void;
  onExplain?: (metricId: string) => void;
  /** Connector shown on each row (index → relation to a higher-ranked goal). */
  connectors?: ReadonlyMap<number, GoalRelation>;
  /** Per-goal chips ("needs a waist measurement", "not available in safety mode"). */
  flags?: ReadonlyMap<string, ReactNode>;
  /** Read-only (running state). */
  readOnly?: boolean;
}

/** Six-dot drag grip (⠿), authored on the 20 px grid. */
function Grip() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {[6, 10, 14].map((y) => (
        <g key={y}>
          <circle cx="7.5" cy={y} r="1.25" fill="currentColor" />
          <circle cx="12.5" cy={y} r="1.25" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

interface DragState {
  index: number;
  dy: number;
  target: number;
  rects: DOMRect[];
  gap: number;
}

interface Pending {
  index: number;
  pointerId: number;
  startY: number;
  touch: boolean;
  timer: number | null;
}

const LIFT_PX_MOUSE = 4;
const LIFT_PX_TOUCH = 6;
const LONG_PRESS_MS = 250;

/**
 * GoalRankList (COMPONENTS §8, planner-goals.md §7/§9): an ordered, drag-sortable list of up to six goals. Rank is
 * information, so ranks are numbered text.
 * - Pointer: drag the ⠿ handle (lifts after 4 px; touch lifts on a 250 ms press or a 6 px drag). Rows slide 200 ms.
 * - Keyboard: focus the handle → Space picks up → ↑/↓ move → Space drops, Escape cancels. Every move is announced.
 * - Accessible path without dragging: the row's "move" menu (to top / up / down / to bottom).
 */
export function GoalRankList({ goals, onMove, onUpdate, onRemove, onExplain, connectors, flags, readOnly }: GoalRankListProps) {
  const reduced = useReducedMotion();
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const handleRefs = useRef(new Map<string, HTMLButtonElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [settling, setSettling] = useState(false);
  const [picked, setPicked] = useState<{ key: string; origin: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const pending = useRef<Pending | null>(null);
  const instructionsId = useId();
  const n = goals.length;

  const nameOf = (g: GoalDraft) => goalMetric(g.metric)?.label ?? g.metric;
  const say = (text: string) => setAnnounce((prev) => (prev === text ? `${text}\u00a0` : text));

  const clearPending = () => {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };

  const lift = useCallback(
    (index: number) => {
      const rects = goals.map((g) => rowRefs.current.get(g.key)?.getBoundingClientRect() ?? new DOMRect());
      const gap = rects.length > 1 ? Math.max(0, rects[1]!.top - rects[0]!.bottom) : 0;
      setDrag({ index, dy: 0, target: index, rects, gap });
      const g = goals[index];
      if (g) say(`${nameOf(g)} lifted, rank ${index + 1} of ${n}.`);
    },
    [goals, n],
  );

  const targetFor = (d: DragState, dy: number) => {
    const r = d.rects[d.index]!;
    const centre = r.top + r.height / 2 + dy;
    let t = 0;
    d.rects.forEach((o, j) => {
      if (j !== d.index && o.top + o.height / 2 < centre) t += 1;
    });
    return t;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (readOnly || e.button !== 0 || n < 2) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const touch = e.pointerType === 'touch';
    clearPending();
    pending.current = { index, pointerId: e.pointerId, startY: e.clientY, touch, timer: null };
    if (touch) pending.current.timer = window.setTimeout(() => lift(index), LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dy = e.clientY - p.startY;
    if (!drag) {
      if (Math.abs(dy) >= (p.touch ? LIFT_PX_TOUCH : LIFT_PX_MOUSE)) {
        if (p.timer) window.clearTimeout(p.timer);
        p.timer = null;
        lift(p.index);
      }
      return;
    }
    e.preventDefault();
    setDrag((d) => (d ? { ...d, dy, target: targetFor(d, dy) } : d));
  };

  const endDrag = (commit: boolean) => {
    const d = drag;
    clearPending();
    if (!d) return;
    setSettling(true);
    setDrag(null);
    if (commit && d.target !== d.index) {
      const g = goals[d.index]!;
      onMove(d.index, d.target);
      say(`${nameOf(g)} moved to rank ${d.target + 1} of ${n}.`);
    } else if (commit) {
      say(`${nameOf(goals[d.index]!)} dropped at rank ${d.index + 1} of ${n}.`);
    }
  };

  useEffect(() => {
    if (!settling) return;
    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setSettling(false)));
    return () => window.cancelAnimationFrame(id);
  }, [settling]);

  useEffect(() => () => clearPending(), []);

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (readOnly) return;
    const g = goals[index]!;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!picked) {
        setPicked({ key: g.key, origin: index });
        say(`${nameOf(g)} picked up, rank ${index + 1} of ${n}. Use the up and down arrow keys to move it, space to drop, escape to cancel.`);
      } else {
        setPicked(null);
        say(`${nameOf(g)} dropped at rank ${index + 1} of ${n}.`);
      }
      return;
    }
    if (!picked) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = index + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= n) {
        say(`${nameOf(g)} is already at rank ${index + 1} of ${n}.`);
        return;
      }
      onMove(index, to);
      say(`${nameOf(g)} moved to rank ${to + 1} of ${n}.`);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const to = e.key === 'Home' ? 0 : n - 1;
      if (to !== index) onMove(index, to);
      say(`${nameOf(g)} moved to rank ${to + 1} of ${n}.`);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (picked.origin !== index) onMove(index, picked.origin);
      setPicked(null);
      say(`Reorder cancelled. ${nameOf(g)} is back at rank ${picked.origin + 1} of ${n}.`);
    }
  };

  // keep keyboard focus on the moved handle after the list re-renders
  useEffect(() => {
    if (picked) handleRefs.current.get(picked.key)?.focus();
  }, [goals, picked]);

  const moveItems = (index: number): MenuItem[] => {
    const g = goals[index]!;
    const mv = (to: number) => () => {
      onMove(index, to);
      say(`${nameOf(g)} moved to rank ${to + 1} of ${n}.`);
    };
    return [
      { id: 'top', label: 'Move to top', onSelect: mv(0), disabled: index === 0 },
      { id: 'up', label: 'Move up', onSelect: mv(index - 1), disabled: index === 0 },
      { id: 'down', label: 'Move down', onSelect: mv(index + 1), disabled: index === n - 1 },
      { id: 'bottom', label: 'Move to bottom', onSelect: mv(n - 1), disabled: index === n - 1 },
    ];
  };

  const shiftOf = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.index) return drag.dy;
    const slot = drag.rects[drag.index]!.height + drag.gap;
    if (drag.index < i && i <= drag.target) return -slot;
    if (drag.target <= i && i < drag.index) return slot;
    return 0;
  };

  return (
    <div className="lp-ranklist" data-dragging={drag ? 'true' : undefined}>
      <p id={instructionsId} className="lm-sr">
        Drag the handle, or focus it and press space, then the arrow keys, then space again. Each goal also has a move menu.
      </p>
      <ol className="lp-ranklist__list" aria-label={`Goals in priority order, ${n} of 6`}>
        {goals.map((g, i) => (
          <GoalRow
            key={g.key}
            setRowEl={(el) => {
              if (el) rowRefs.current.set(g.key, el);
              else rowRefs.current.delete(g.key);
            }}
            setHandleEl={(el) => {
              if (el) handleRefs.current.set(g.key, el);
              else handleRefs.current.delete(g.key);
            }}
            goal={g}
            index={i}
            count={n}
            shift={shiftOf(i)}
            lifted={drag?.index === i}
            picked={picked?.key === g.key}
            animate={!reduced && !settling && drag !== null}
            instructionsId={instructionsId}
            connector={connectors?.get(i)}
            flag={flags?.get(g.key)}
            readOnly={readOnly}
            moveItems={moveItems(i)}
            onHandlePointerDown={(e) => onPointerDown(e, i)}
            onHandlePointerMove={onPointerMove}
            onHandlePointerUp={() => endDrag(true)}
            onHandlePointerCancel={() => endDrag(false)}
            onHandleKeyDown={(e) => onHandleKey(e, i)}
            onHandleBlur={() => {
              if (picked?.key === g.key) {
                setPicked(null);
                say(`${nameOf(g)} dropped at rank ${i + 1} of ${n}.`);
              }
            }}
            onUpdate={(patch) => onUpdate(g.key, patch)}
            onRemove={() => {
              onRemove(g.key);
              say(`${nameOf(g)} removed. ${n - 1} goal${n - 1 === 1 ? '' : 's'} left.`);
            }}
            onExplain={onExplain}
          />
        ))}
      </ol>
      <div className="lm-sr" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  );
}

interface GoalRowProps {
  setRowEl: (el: HTMLLIElement | null) => void;
  setHandleEl: (el: HTMLButtonElement | null) => void;
  goal: GoalDraft;
  index: number;
  count: number;
  shift: number;
  lifted: boolean;
  picked: boolean;
  animate: boolean;
  instructionsId: string;
  connector?: GoalRelation;
  flag?: ReactNode;
  readOnly?: boolean;
  moveItems: MenuItem[];
  onHandlePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerUp: () => void;
  onHandlePointerCancel: () => void;
  onHandleKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onHandleBlur: () => void;
  onUpdate: (patch: Partial<Omit<GoalDraft, 'key' | 'metric'>>) => void;
  onRemove: () => void;
  onExplain?: (metricId: string) => void;
}

const STRENGTH_OPTIONS = (['must', 'should', 'nice'] as const).map((v) => ({ value: v, label: STRENGTH_LABEL[v] }));

function GoalRow({ setRowEl, setHandleEl, ...p }: GoalRowProps) {
  const { goal: g, index, count } = p;
  const metric = goalMetric(g.metric);
  if (!metric) return null;
  const spec = modeSpec(metric, g.mode);
  const name = metric.label;
  const functional = g.functional ?? metric.defaultFunctional;
  const setMode = (mode: GoalMode) => {
    const next = modeSpec(metric, mode);
    p.onUpdate({ mode, amount: modeTakesAmount(next) ? (g.amount ?? metric.target?.fallback ?? 1) : g.amount });
  };
  const menuItems: MenuItem[] = [
    ...p.moveItems,
    {
      id: 'functional',
      label: functional === 'end' ? 'Judge by the average over the plan' : 'Judge by the value at the end',
      onSelect: () => p.onUpdate({ functional: functional === 'end' ? 'mean' : 'end' }),
      separatorBefore: true,
    },
    ...(p.onExplain ? [{ id: 'explain', label: `Explain ${name.toLowerCase()}`, onSelect: () => p.onExplain?.(metric.id) }] : []),
  ];
  const style = p.shift !== 0 ? { transform: `translate3d(0, ${p.shift}px, 0)` } : undefined;
  return (
    <li
      ref={setRowEl}
      className="lp-goal"
      data-lifted={p.lifted || undefined}
      data-picked={p.picked || undefined}
      data-animate={p.animate || undefined}
      style={style}
    >
      {p.connector ? <Connector relation={p.connector} /> : null}
      <div className="lp-goal__grid">
        <button
          ref={setHandleEl}
          type="button"
          className="lp-goal__handle lm-hit"
          aria-label={`Reorder ${name}, rank ${index + 1} of ${count}`}
          aria-describedby={p.instructionsId}
          aria-pressed={p.picked}
          disabled={p.readOnly || count < 2}
          onPointerDown={p.onHandlePointerDown}
          onPointerMove={p.onHandlePointerMove}
          onPointerUp={p.onHandlePointerUp}
          onPointerCancel={p.onHandlePointerCancel}
          onLostPointerCapture={p.onHandlePointerCancel}
          onKeyDown={p.onHandleKeyDown}
          onBlur={p.onHandleBlur}
        >
          <Grip />
        </button>
        <span className="lp-goal__rank lm-num" aria-hidden="true">
          {index + 1}
        </span>
        <div className="lp-goal__metric">
          <Swatch category={metric.category} />
          <span className="lp-goal__name">{name}</span>
          <GradeBadge grade={metric.grade} size="sm" />
          {metric.grade === 'D' ? <span className="lp-goal__tag">exploratory</span> : null}
          <VisuallyHidden>, rank {index + 1}</VisuallyHidden>
        </div>
        <div className="lp-goal__mode">
          {metric.modes.length > 1 ? (
            <KeyBank
              size="sm"
              label={`${name}: goal type`}
              value={g.mode}
              onChange={setMode}
              options={metric.modes.map((m) => ({ value: m.mode, label: m.label, disabled: p.readOnly }))}
            />
          ) : (
            <span className="lp-goal__dir">
              {spec.label}
              <span aria-hidden="true">{spec.direction === 'minimise' ? '↓' : '↑'}</span>
            </span>
          )}
        </div>
        <div className="lp-goal__controls">
          {modeTakesAmount(spec) ? (
            <TargetEditor metric={metric} mode={spec} goal={g} onChange={(amount) => p.onUpdate({ amount })} disabled={p.readOnly} />
          ) : spec.target === 'zero' ? (
            <span className="lp-goal__hold">hold at the start value</span>
          ) : null}
          <span className="lp-goal__when lm-eng">{functional === 'end' ? 'at the end' : 'on average'}</span>
          <div className="lp-goal__strength">
            <Select<GoalStrength>
              size="sm"
              label={`${name}: priority strength`}
              value={g.strength}
              onChange={(strength) => p.onUpdate({ strength })}
              options={STRENGTH_OPTIONS}
              disabled={p.readOnly}
            />
          </div>
        </div>
        {p.readOnly ? null : (
          <div className="lp-goal__actions">
            <Menu
              label={`${name}: move and options`}
              placement="bottom-end"
              items={menuItems}
              trigger={(t) => (
                <IconKey {...t} icon={Ellipsis} label={`Move ${name} and more`} size="sm" variant="quiet" />
              )}
            />
            <IconKey icon={X} label={`Remove ${name}`} size="sm" variant="quiet" onClick={p.onRemove} />
          </div>
        )}
        {metric.grade === 'D' || metric.caveat || metric.note || p.flag ? (
          <div className="lp-goal__notes">
            {p.flag}
            {metric.grade === 'D' ? <p className="lp-goal__help">{gradeDHelp(metric.id)}</p> : null}
            {metric.caveat ? <p className="lp-goal__caveat">{metric.caveat}</p> : null}
            {g.metric === 'scaleWeight' ? <p className="lp-goal__help">Planned on tissue weight, so water and glycogen swings don’t count.</p> : null}
            <p className="lm-sr">{STRENGTH_HELP[g.strength]}</p>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Connector({ relation }: { relation: GoalRelation }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const conflict = relation.kind === 'conflict';
  return (
    <div className="lp-conn" data-kind={relation.kind}>
      <span className="lp-conn__bracket" aria-hidden="true" />
      <button ref={ref} type="button" className="lp-conn__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon icon={conflict ? ArrowLeftRight : Link2} size={16} />
        <span>
          {conflict ? 'pulls against' : 'helps'} #{relation.from + 1}
          <span className="lp-conn__tag"> · {relation.tag}</span>
        </span>
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={ref} label={conflict ? 'Why these goals pull apart' : 'Why these goals help each other'} className="lp-pop">
        <p className="lp-pop__title">{conflict ? `Goal ${relation.to + 1} pulls against goal ${relation.from + 1}` : `Goal ${relation.to + 1} helps goal ${relation.from + 1}`}</p>
        <p className="lp-pop__body">{relation.text}</p>
        <p className="lp-pop__foot lm-eng">before a run this comes from the evidence table; the results show what the optimiser found</p>
      </Popover>
    </div>
  );
}
