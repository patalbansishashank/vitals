/**
 * Raster bar (simulator-schedule.md §6 "Raster bar"): the selection (or focused day) as one line, then the tools.
 * Desktop: Copy week · Paste · Repeat to end · Weekly pattern · Insert a fast as labelled keys, then Undo / Redo.
 * Phones: Undo only. With several days selected: Paint with <armed program> and Deselect.
 * Everything else — the focused week's operations (insert, delete, deload), shifting and clearing the selection,
 * naming a block, and on phones the tools above — goes to the page's header ⋯ through `onMenu` (one ⋯ per screen).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ClipboardPaste, Copy, Redo2, Repeat, Undo2, X } from 'lucide-react';
import {
  Glyphs,
  IconKey,
  Key,
  KeyBank,
  MQ,
  Popover,
  Sheet,
  Stepper,
  Switch,
  toast,
  useMediaQuery,
  type IconComponent,
  type KeySize,
  type MenuEntry,
  type MenuItem,
} from '@/components';
import { useCanUndo, useScheduleStore } from '@/state/scheduleStore';
import { formatClock, formatDayShort, rowDays, rowOf, WEEKDAYS_SHORT } from '../lib/calendar';
import type { ScheduleModel } from '../useScheduleModel';
import { TimeField } from './editorParts';
import { nextMealAt } from '../lib/fasts';
import { editSchedule, redoSchedule, undoSchedule } from '../commands';

export interface RasterBarProps {
  sid: string;
  model: ScheduleModel;
  selection: ReadonlySet<number>;
  focusDay: number;
  armed: number | null;
  onSelect: (days: number[], anchor: number) => void;
  onPaintSelection: () => void;
  onClearSelection: () => void;
  /** The bar's week and selection actions for the page's header ⋯; called again only when they change. */
  onMenu?: (entries: MenuEntry[]) => void;
  compact?: boolean;
}

type ToolId = 'pattern' | 'fast' | 'name';
/** Desktop: a popover under the key (or the bar, when opened from the header ⋯). Phones: a bottom sheet. */
type ToolMode = 'popover' | 'sheet';

function weeksText(rows: number[]): string {
  if (rows.length === 0) return '';
  const s = [...rows].sort((a, b) => a - b).map((r) => r + 1);
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1]! + 1);
  if (s.length === 1) return `week ${s[0]}`;
  return contiguous ? `weeks ${s[0]}–${s[s.length - 1]}` : `weeks ${s.join(', ')}`;
}

const isItem = (e: MenuEntry): e is MenuItem => e.kind === undefined || e.kind === 'item';

/**
 * Hands `entries` to `onMenu` whenever their ids, labels or disabled states change (not on every render: the page
 * keeps them in state). The handed-over items call the latest `onSelect`, so their closures never go stale.
 */
function useHeaderMenu(entries: MenuEntry[], onMenu: RasterBarProps['onMenu']): void {
  const latest = useRef(entries);
  useLayoutEffect(() => {
    latest.current = entries;
  });
  const signature = entries.map((e) => (isItem(e) ? `${e.id}|${e.label}|${e.disabled ? 1 : 0}` : `${e.kind}|${e.id}|${'label' in e ? e.label : ''}`)).join('\n');
  useEffect(() => {
    if (!onMenu) return;
    onMenu(
      latest.current.map((e) =>
        isItem(e)
          ? {
              ...e,
              onSelect: () => {
                const cur = latest.current.find((x) => x.id === e.id);
                if (cur && isItem(cur)) cur.onSelect();
              },
            }
          : e,
      ),
    );
  }, [signature, onMenu]);
  useEffect(() => () => onMenu?.([]), [onMenu]);
}

export function RasterBar({
  sid,
  model,
  selection,
  focusDay,
  armed,
  onSelect,
  onPaintSelection,
  onClearSelection,
  onMenu,
  compact,
}: RasterBarProps) {
  const store = useScheduleStore.getState;
  const clipboard = useScheduleStore((s) => s.clipboard);
  const { undo: canUndo, redo: canRedo } = useCanUndo(sid);
  const wide = useMediaQuery(MQ.lg);
  const ks: KeySize = wide ? 'sm' : 'md';
  const [copied, setCopied] = useState<number | null>(null);
  const [tool, setTool] = useState<{ id: ToolId; via: 'key' | 'menu' } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const barAnchor = useRef<HTMLSpanElement>(null);
  const patternAnchor = useRef<HTMLSpanElement>(null);
  const fastAnchor = useRef<HTMLSpanElement>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => void (copiedTimer.current && window.clearTimeout(copiedTimer.current)), []);
  const g = model.grid;
  const sel = [...selection].sort((a, b) => a - b);
  const n = sel.length;
  const first = sel[0] ?? focusDay;
  const focusRow = rowOf(g, focusDay);
  const selRows = [...new Set(sel.map((d) => rowOf(g, d)))];
  const cell = model.cells[first];
  const prog = armed !== null ? model.schedule.programs[armed] : null;
  const base = model.schedule.programs[0]!.id;

  const label = n > 1 ? `${n} days selected` : cell ? `${formatDayShort(cell.iso)} · ${cell.letter} ${cell.label}` : '';

  const copy = () => {
    store().copyWeek(sid, focusRow);
    setCopied(focusRow);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 2000);
  };
  const paste = () => {
    if (!clipboard) return;
    const rows = selRows.filter((r) => r !== clipboard.fromRow);
    const targets = rows.length > 0 ? rows : [focusRow];
    editSchedule(sid, [{ op: 'copyWeek', fromRow: clipboard.fromRow, toRows: targets, cols: clipboard.cols as never }]);
    toast(`Week ${clipboard.fromRow + 1} pasted to ${weeksText(targets)}`, {
      action: { label: 'Undo', onClick: () => undoSchedule(sid) },
    });
  };
  const repeat = () => {
    editSchedule(sid, [{ op: 'repeatWeekToEnd', row: focusRow }]);
    if (focusRow + 1 < g.rows)
      toast(`Week ${focusRow + 1} repeated to week ${g.rows}`, {
        action: { label: 'Undo', onClick: () => undoSchedule(sid) },
      });
  };
  const shift = (delta: number) => {
    const days = sel.length > 0 ? sel : [focusDay];
    editSchedule(sid, [{ op: 'shiftDays', days, delta }]);
    onSelect(
      days.map((d) => Math.max(0, Math.min(g.nDays - 1, d + delta))),
      Math.max(0, Math.min(g.nDays - 1, first + delta)),
    );
  };
  // from the header ⋯ on desktop the popover hangs from the bar: bring it into view first
  const openFromMenu = (id: ToolId) => {
    if (wide) barRef.current?.scrollIntoView?.({ block: 'nearest' });
    setTool({ id, via: 'menu' });
  };
  const closeTool = () => setTool(null);
  const toolMode: ToolMode = wide ? 'popover' : 'sheet';
  const toolAnchor = (id: ToolId): RefObject<HTMLElement | null> =>
    tool?.via === 'key' ? (id === 'pattern' ? patternAnchor : fastAnchor) : barAnchor;

  const week = focusRow + 1;
  const entries: MenuEntry[] = [
    // phones: Redo joins the ⋯ while there is something to redo (Undo stays on the bar)
    ...(wide || !canRedo ? [] : [{ id: 'sim-redo', label: 'Redo', onSelect: () => redoSchedule(sid) }]),
    { kind: 'section', id: 'sim-week', label: `Week ${week}` },
    ...(wide
      ? []
      : [
          {
            id: 'sim-copy',
            label: `Copy week ${week}`,
            onSelect: () => {
              store().copyWeek(sid, focusRow);
              toast(`Week ${week} copied`);
            },
          },
          {
            id: 'sim-paste',
            label: clipboard ? `Paste week ${clipboard.fromRow + 1} here` : 'Paste a week',
            onSelect: paste,
            disabled: !clipboard,
          },
          { id: 'sim-repeat', label: `Repeat week ${week} to the end`, onSelect: repeat, disabled: focusRow + 1 >= g.rows },
        ]),
    {
      id: 'sim-insweek',
      label: `Insert a copy of week ${week}`,
      onSelect: () => void editSchedule(sid, [{ op: 'insertWeek', row: focusRow }]),
      disabled: g.nDays + 7 > 27 * 7,
    },
    {
      id: 'sim-delweek',
      label: `Delete week ${week}`,
      onSelect: () => void editSchedule(sid, [{ op: 'deleteWeek', row: focusRow }]),
      disabled: g.nDays - rowDays(g, focusRow).length < 7,
      tone: 'danger',
    },
    {
      id: 'sim-deload',
      label: `Deload week ${week} (lifting × ½)`,
      onSelect: () =>
        void editSchedule(sid, [{ op: 'deloadWeek', row: focusRow, habitualByWeekday: model.habitual.byWeekday as never }]),
    },
    { kind: 'section', id: 'sim-days', label: n > 1 ? `${n} days` : cell ? formatDayShort(cell.iso) : 'Days' },
    ...(wide
      ? []
      : [
          { id: 'sim-pattern', label: 'Weekly pattern…', onSelect: () => openFromMenu('pattern') },
          { id: 'sim-fast', label: 'Insert a fast…', onSelect: () => openFromMenu('fast') },
        ]),
    { id: 'sim-left', label: 'Shift a day earlier', onSelect: () => shift(-1), disabled: first <= 0 },
    { id: 'sim-right', label: 'Shift a day later', onSelect: () => shift(1), disabled: (sel[n - 1] ?? 0) >= g.nDays - 1 },
    { id: 'sim-clear', label: n > 1 ? `Clear ${n} days to ${base}` : `Clear to ${base}`, onSelect: onClearSelection },
    { id: 'sim-block', label: 'Name as a block…', onSelect: () => openFromMenu('name') },
  ];
  useHeaderMenu(entries, onMenu);

  return (
    <div ref={barRef} className="sim-bar" data-compact={compact || undefined}>
      <div className="sim-bar__label" aria-live="polite">
        {label}
      </div>
      <div className="sim-bar__tools" role="toolbar" aria-label="Schedule tools">
        {n > 1 ? (
          <>
            {prog ? (
              <Key size="sm" variant="action" onClick={onPaintSelection}>
                Paint with {prog.id}
              </Key>
            ) : null}
            <IconKey size={ks} icon={X} label="Deselect" onClick={() => onSelect([focusDay], focusDay)} />
          </>
        ) : null}
        {wide ? (
          <>
            <BarKey icon={Copy} onClick={copy}>
              {copied !== null ? `Week ${copied + 1} copied` : 'Copy week'}
            </BarKey>
            <BarKey icon={ClipboardPaste} onClick={paste} disabledReason={clipboard ? undefined : 'Copy a week first'}>
              Paste
            </BarKey>
            <BarKey
              icon={Repeat}
              onClick={repeat}
              disabledReason={focusRow + 1 >= g.rows ? 'This is the last week' : undefined}
            >
              Repeat to end
            </BarKey>
            <span ref={patternAnchor} className="sim-bar__slot">
              <BarKey
                icon={Glyphs.ProgramKey}
                onClick={() => setTool(tool?.id === 'pattern' ? null : { id: 'pattern', via: 'key' })}
                aria-haspopup="dialog"
                aria-expanded={tool?.id === 'pattern'}
              >
                Weekly pattern
              </BarKey>
            </span>
            <span ref={fastAnchor} className="sim-bar__slot">
              <BarKey
                icon={Glyphs.FastClock}
                onClick={() => setTool(tool?.id === 'fast' ? null : { id: 'fast', via: 'key' })}
                aria-haspopup="dialog"
                aria-expanded={tool?.id === 'fast'}
              >
                Insert a fast
              </BarKey>
            </span>
            <span className="sim-bar__sep" aria-hidden="true" />
          </>
        ) : null}
        <IconKey
          size={ks}
          icon={Undo2}
          label="Undo (⌘Z)"
          onClick={() => undoSchedule(sid)}
          disabledReason={canUndo ? undefined : 'Nothing to undo'}
        />
        {wide ? (
          <IconKey
            size="sm"
            icon={Redo2}
            label="Redo (⇧⌘Z)"
            onClick={() => redoSchedule(sid)}
            disabledReason={canRedo ? undefined : 'Nothing to redo'}
          />
        ) : null}
        <span ref={barAnchor} className="sim-bar__anchor" aria-hidden="true" />
      </div>
      {tool?.id === 'pattern' ? (
        <PatternTool sid={sid} model={model} focusRow={focusRow} mode={toolMode} anchorRef={toolAnchor('pattern')} onClose={closeTool} />
      ) : null}
      {tool?.id === 'fast' ? (
        <InsertFastTool sid={sid} model={model} day={first} mode={toolMode} anchorRef={toolAnchor('fast')} onClose={closeTool} />
      ) : null}
      {tool?.id === 'name' ? (
        <NameBlockTool
          sid={sid}
          days={n > 1 ? [sel[0]!, sel[n - 1]!] : [focusDay, focusDay]}
          mode={toolMode}
          anchorRef={barAnchor}
          onClose={closeTool}
        />
      ) : null}
    </div>
  );
}

/** A labelled desktop tool key (icon + text; the text is its name). */
function BarKey({
  icon,
  onClick,
  disabledReason,
  children,
  ...aria
}: {
  icon: IconComponent;
  onClick: () => void;
  disabledReason?: string;
  children: ReactNode;
  'aria-haspopup'?: 'dialog';
  'aria-expanded'?: boolean;
}) {
  return (
    // r068 W2-11: a labelled tool is an ordinary (outlined) key, never loose gold text beside outlined keys
    <Key size="sm" variant="outlined" icon={icon} onClick={onClick} disabledReason={disabledReason} className="sim-barkey" {...aria}>
      {children}
    </Key>
  );
}

/** The surface of a tool: a popover under its key on desktop, a bottom sheet (Cancel · title · Done) on phones. */
function ToolPanel({
  mode,
  anchorRef,
  title,
  applyLabel,
  onApply,
  onClose,
  children,
}: {
  mode: ToolMode;
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  applyLabel: string;
  onApply: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  if (mode === 'sheet')
    return (
      <Sheet open onClose={onClose} title={title} onDone={onApply} doneLabel={applyLabel} detents={['half', 'full']}>
        <div className="sim-pop sim-pop--sheet">{children}</div>
      </Sheet>
    );
  return (
    <Popover
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      anchorRef={anchorRef}
      label={title}
      placement="bottom-end"
      padding="roomy"
    >
      <div className="sim-pop">
        <p className="sim-pop__title">{title}</p>
        {children}
        <div className="sim-pop__foot">
          <Key size="sm" variant="text" onClick={onClose}>
            Cancel
          </Key>
          <Key size="sm" variant="primary" onClick={onApply}>
            {applyLabel}
          </Key>
        </div>
      </div>
    </Popover>
  );
}

function NameBlockTool({
  sid,
  days,
  mode,
  anchorRef,
  onClose,
}: {
  sid: string;
  days: [number, number];
  mode: ToolMode;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const n = days[1] - days[0] + 1;
  const apply = () => {
    const v = name.trim();
    if (v) editSchedule(sid, [{ op: 'setBlock', block: { name: v.slice(0, 40), startDay: days[0], endDay: days[1] + 1 } }]);
    onClose();
  };
  return (
    <ToolPanel mode={mode} anchorRef={anchorRef} title="Name a block" applyLabel="Name block" onApply={apply} onClose={onClose}>
      <label className="sim-field">
        <span className="lm-eng">{n > 1 ? `Block name for ${n} days` : 'Block name for this day'}</span>
        <input
          name="name"
          className="sim-input"
          maxLength={40}
          placeholder="fat-loss base"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
    </ToolPanel>
  );
}

function PatternTool({
  sid,
  model,
  focusRow,
  mode,
  anchorRef,
  onClose,
}: {
  sid: string;
  model: ScheduleModel;
  focusRow: number;
  mode: ToolMode;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const g = model.grid;
  const programs = model.schedule.programs;
  // starts from the focused week as it is now (mounted on open)
  const [pattern, setPattern] = useState<number[]>(() => {
    const out: number[] = [];
    for (let c = 0; c < 7; c++) {
      const d = focusRow * 7 + c - g.offset;
      out.push(d >= 0 && d < g.nDays ? (model.schedule.days[d]?.program ?? 0) : 0);
    }
    return out;
  });
  const [range, setRange] = useState<'rest' | 'all'>('rest');
  const apply = () => {
    const from = range === 'all' ? 0 : Math.max(0, focusRow * 7 - g.offset);
    editSchedule(sid, [{ op: 'applyPattern', pattern, fromDay: from }]);
    onClose();
    toast(`Pattern ${pattern.map((p) => programs[p]?.id).join(' ')} applied`, {
      action: { label: 'Undo', onClick: () => undoSchedule(sid) },
    });
  };
  return (
    <ToolPanel mode={mode} anchorRef={anchorRef} title="Weekly pattern" applyLabel="Apply pattern" onApply={apply} onClose={onClose}>
      <div className="sim-pattern">
        {WEEKDAYS_SHORT.map((w, c) => (
          <label key={w} className="sim-pattern__slot">
            <span className="lm-eng">{w}</span>
            <select
              className="sim-pattern__sel"
              value={String(pattern[c])}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                setPattern((p) => p.map((x, k) => (k === c ? v : x)));
              }}
              aria-label={`${w} program`}
            >
              {programs.map((pr, i) => (
                <option key={pr.id} value={String(i)}>
                  {pr.id}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <KeyBank
        size="sm"
        block
        label="Apply to"
        options={[
          { value: 'rest', label: `Week ${focusRow + 1} to the end` },
          { value: 'all', label: 'Every week' },
        ]}
        value={range}
        onChange={setRange}
      />
    </ToolPanel>
  );
}

const DURATIONS = ['24', '36', '48', '72'] as const;

function InsertFastTool({
  sid,
  model,
  day,
  mode,
  anchorRef,
  onClose,
}: {
  sid: string;
  model: ScheduleModel;
  day: number;
  mode: ToolMode;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [startH, setStartH] = useState(20);
  const [hours, setHours] = useState(36);
  const [electrolytes, setElectrolytes] = useState(true);
  const [refeed, setRefeed] = useState(true);
  const iso = model.cells[day]?.iso;
  // where the fast really ends: the first meal the programs schedule at or after the planned end
  const t0 = day * 24 + startH;
  const nextMeal = nextMealAt(model.compiled, t0 + hours);
  const actualH = nextMeal === null ? null : nextMeal - t0;
  const nextDays = nextMeal === null ? 0 : Math.floor(nextMeal / 24) - day;
  const nextIso = nextMeal === null ? undefined : model.cells[Math.floor(nextMeal / 24)]?.iso;
  const shownH = actualH === null ? hours : Math.round(actualH);
  const apply = () => {
    editSchedule(sid, [
      {
        op: 'addFast',
        fast: { startDay: day, startH, durationH: hours, electrolytes, refeed: refeed ? 'auto' : 'none' },
      },
    ]);
    onClose();
    toast(
      `${shownH} h fast inserted${shownH !== hours ? ` (next meal ${nextIso ? formatDayShort(nextIso) : ''} ${nextMeal === null ? '' : formatClock(nextMeal % 24)})` : ''}`,
      { action: { label: 'Undo', onClick: () => undoSchedule(sid) } },
    );
  };
  return (
    <ToolPanel
      mode={mode}
      anchorRef={anchorRef}
      title={`Water-only fast from ${iso ? formatDayShort(iso) : `day ${day + 1}`}`}
      applyLabel="Insert fast"
      onApply={apply}
      onClose={onClose}
    >
      <div className="sim-grid2">
        <TimeField label="Last meal" value={startH} onChange={setStartH} />
        <div className="sim-field">
          <span className="lm-eng">Meal to meal</span>
          <Stepper name="fast length" value={hours} onChange={setHours} min={12} max={240} step={12} unit="h" />
        </div>
      </div>
      <KeyBank
        size="sm"
        block
        label="Common lengths"
        options={DURATIONS.map((d) => ({ value: d, label: `${d} h` }))}
        value={
          DURATIONS.includes(String(hours) as (typeof DURATIONS)[number])
            ? (String(hours) as (typeof DURATIONS)[number])
            : undefined
        }
        onChange={(v) => setHours(Number(v))}
      />
      <p className="sim-pop__line">
        {nextMeal === null
          ? 'Runs to the end of the schedule'
          : `Next meal ${nextIso ? `${formatDayShort(nextIso).split(' ')[0]} ` : ''}${formatClock(nextMeal % 24)} · ${nextDays} day${nextDays === 1 ? '' : 's'} later`}
        {actualH !== null && Math.round(actualH) !== hours
          ? ` · ${Math.round(actualH)} h meal to meal: no meal is scheduled at ${formatClock((t0 + hours) % 24)}`
          : ''}
      </p>
      <Switch checked={electrolytes} onChange={setElectrolytes} label="Electrolytes during the fast" labelStyle="sentence" />
      <Switch checked={refeed} onChange={setRefeed} label="Restart food gradually afterwards" labelStyle="sentence" />
    </ToolPanel>
  );
}
