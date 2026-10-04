/**
 * Raster bar / bulk toolbar (simulator-schedule.md §6 "Raster bar"): the selection label, then Copy week · Paste ·
 * Repeat to end · Pattern · Insert fast · Shift · Clear · Undo/Redo, and a menu for week operations
 * (insert, delete, deload), naming a block and select-all.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Copy,
  Eraser,
  MoreHorizontal,
  Redo2,
  Repeat,
  Undo2,
} from 'lucide-react';
import {
  Glyphs,
  IconKey,
  Key,
  KeyBank,
  MQ,
  Menu,
  Popover,
  Stepper,
  Switch,
  Tooltip,
  toast,
  useMediaQuery,
  usePopover,
  type KeySize,
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
  compact?: boolean;
}

function weeksText(rows: number[]): string {
  if (rows.length === 0) return '';
  const s = [...rows].sort((a, b) => a - b).map((r) => r + 1);
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1]! + 1);
  if (s.length === 1) return `week ${s[0]}`;
  return contiguous ? `weeks ${s[0]}–${s[s.length - 1]}` : `weeks ${s.join(', ')}`;
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
  compact,
}: RasterBarProps) {
  const store = useScheduleStore.getState;
  const clipboard = useScheduleStore((s) => s.clipboard);
  const { undo: canUndo, redo: canRedo } = useCanUndo(sid);
  const wide = useMediaQuery(MQ.lg);
  // touch layouts: 40 px keys, the less frequent tools move into the menu so the bar stays one row
  const ks: KeySize = wide ? 'sm' : 'md';
  const [copied, setCopied] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const nameAnchor = useRef<HTMLSpanElement>(null);
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

  const label =
    n > 1 ? (
      <>
        <b>{n} days selected</b>
        <span className="lm-eng">{prog ? `P paints with ${prog.id}` : 'drag to extend · ⌥ for columns'}</span>
      </>
    ) : cell ? (
      <>
        <b>
          {formatDayShort(cell.iso)} · {cell.letter} {cell.label}
        </b>
        <span className="lm-eng">{prog ? `drag to paint with ${prog.id}` : 'drag to select'}</span>
      </>
    ) : null;

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

  return (
    <div className="sim-bar" data-compact={compact || undefined}>
      <div className="sim-bar__label" aria-live="polite">
        {label}
      </div>
      <div className="sim-bar__tools" role="toolbar" aria-label="Schedule tools">
        {prog && n > 1 ? (
          <Key size="sm" onClick={onPaintSelection}>
            Paint with {prog.id}
          </Key>
        ) : null}
        <BarKey
          size={ks}
          icon={Copy}
          label={copied !== null ? `Copied wk ${copied + 1}` : 'Copy week'}
          onClick={copy}
        />
        <BarKey
          size={ks}
          icon={ClipboardPaste}
          label="Paste"
          onClick={paste}
          disabledReason={clipboard ? undefined : 'Copy a week first'}
        />
        <BarKey
          size={ks}
          icon={Repeat}
          label="Repeat to end"
          onClick={repeat}
          disabledReason={focusRow + 1 >= g.rows ? 'This is the last week' : undefined}
        />
        <PatternTool sid={sid} model={model} focusRow={focusRow} size={ks} />
        <InsertFastTool sid={sid} model={model} day={first} size={ks} />
        {wide ? (
          <>
            <IconKey
              size="sm"
              icon={ArrowLeft}
              label="Shift selection a day earlier"
              onClick={() => shift(-1)}
              disabled={first <= 0}
            />
            <IconKey
              size="sm"
              icon={ArrowRight}
              label="Shift selection a day later"
              onClick={() => shift(1)}
              disabled={(sel[n - 1] ?? 0) >= g.nDays - 1}
            />
            <BarKey size={ks} icon={Eraser} label="Clear" onClick={onClearSelection} />
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
        <span ref={nameAnchor} className="sim-bar__anchor" aria-hidden="true" />
        <Menu
          label="Week and block actions"
          trigger={(tp) => <IconKey {...tp} size={ks} icon={MoreHorizontal} label="More schedule actions" />}
          items={[
            ...(wide
              ? []
              : [
                  { id: 'redo', label: 'Redo', onSelect: () => redoSchedule(sid), disabled: !canRedo },
                  {
                    id: 'left',
                    label: 'Shift selection a day earlier',
                    onSelect: () => shift(-1),
                    disabled: first <= 0,
                  },
                  {
                    id: 'right',
                    label: 'Shift selection a day later',
                    onSelect: () => shift(1),
                    disabled: (sel[n - 1] ?? 0) >= g.nDays - 1,
                  },
                  {
                    id: 'clear',
                    label:
                      n > 1
                        ? `Clear ${n} days to ${model.schedule.programs[0]!.id}`
                        : `Clear to ${model.schedule.programs[0]!.id}`,
                    onSelect: onClearSelection,
                  },
                ]),
            {
              id: 'ins',
              separatorBefore: !wide,
              label: `Insert a copy of week ${focusRow + 1}`,
              onSelect: () => void editSchedule(sid, [{ op: 'insertWeek', row: focusRow }]),
              disabled: g.nDays + 7 > 27 * 7,
            },
            {
              id: 'del',
              label: `Delete week ${focusRow + 1}`,
              onSelect: () => void editSchedule(sid, [{ op: 'deleteWeek', row: focusRow }]),
              disabled: g.nDays - rowDays(g, focusRow).length < 7,
              tone: 'danger',
            },
            {
              id: 'deload',
              label: `Deload week ${focusRow + 1} (lifting × ½)`,
              onSelect: () => void editSchedule(sid, [{ op: 'deloadWeek', row: focusRow, habitualByWeekday: model.habitual.byWeekday as never }]),
            },
            {
              id: 'block',
              label: 'Name the selection as a block…',
              onSelect: () => setNaming(true),
              separatorBefore: true,
            },
            {
              id: 'all',
              label: 'Select all days',
              onSelect: () =>
                onSelect(
                  Array.from({ length: g.nDays }, (_, i) => i),
                  0,
                ),
            },
          ]}
        />
      </div>
      <Popover
        open={naming}
        onOpenChange={setNaming}
        anchorRef={nameAnchor}
        label="Name a block"
        placement="bottom-end"
        padding="roomy"
      >
        <form
          className="sim-pop"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get('name') ?? '').trim();
            if (v) {
              const a = sel[0] ?? focusDay;
              const b = (sel[n - 1] ?? focusDay) + 1;
              editSchedule(sid, [{ op: 'setBlock', block: { name: v.slice(0, 40), startDay: a, endDay: b } }]);
            }
            setNaming(false);
          }}
        >
          <label className="sim-field">
            <span className="lm-eng">block name for {n > 1 ? `${n} days` : 'this day'}</span>
            <input name="name" className="sim-input" maxLength={40} placeholder="fat-loss base" />
          </label>
          <div className="sim-pop__foot">
            <Key size="sm" variant="quiet" onClick={() => setNaming(false)}>
              Cancel
            </Key>
            <Key size="sm" variant="solid" type="submit">
              Name block
            </Key>
          </div>
        </form>
      </Popover>
    </div>
  );

  function shift(delta: number) {
    const days = sel.length > 0 ? sel : [focusDay];
    editSchedule(sid, [{ op: 'shiftDays', days, delta }]);
    onSelect(
      days.map((d) => Math.max(0, Math.min(g.nDays - 1, d + delta))),
      Math.max(0, Math.min(g.nDays - 1, first + delta)),
    );
  }
}

function BarKey({
  icon,
  label,
  onClick,
  disabledReason,
  size = 'sm',
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabledReason?: string;
  size?: KeySize;
}) {
  return (
    <Tooltip content={label} role="label">
      <Key
        size={size}
        variant="quiet"
        icon={icon}
        onClick={onClick}
        disabledReason={disabledReason}
        className="sim-barkey"
        aria-label={label}
      >
        <span className="sim-barkey__text">{label}</span>
      </Key>
    </Tooltip>
  );
}

function PatternTool({
  sid,
  model,
  focusRow,
  size = 'sm',
}: {
  sid: string;
  model: ScheduleModel;
  focusRow: number;
  size?: KeySize;
}) {
  const pop = usePopover();
  const g = model.grid;
  const programs = model.schedule.programs;
  const initial = () => {
    const out: number[] = [];
    for (let c = 0; c < 7; c++) {
      const d = focusRow * 7 + c - g.offset;
      out.push(d >= 0 && d < g.nDays ? (model.schedule.days[d]?.program ?? 0) : 0);
    }
    return out;
  };
  const [pattern, setPattern] = useState<number[]>(initial);
  const [range, setRange] = useState<'rest' | 'all'>('rest');
  const opts = programs.map((p, i) => ({ value: String(i), label: `${p.id} · ${p.label}` }));
  return (
    <>
      <Tooltip content="Repeat a weekly pattern" role="label">
        <Key
          size={size}
          variant="quiet"
          icon={Glyphs.ProgramKey}
          {...pop.triggerProps}
          onClick={() => {
            if (!pop.open) setPattern(initial());
            pop.setOpen(!pop.open);
          }}
          className="sim-barkey"
          aria-label="Repeat a weekly pattern"
        >
          <span className="sim-barkey__text">Pattern</span>
        </Key>
      </Tooltip>
      <Popover
        open={pop.open}
        onOpenChange={pop.setOpen}
        anchorRef={pop.anchorRef}
        label="Weekly pattern"
        placement="bottom-end"
        padding="roomy"
      >
        <div className="sim-pop">
          <p className="sim-pop__title">Weekly pattern</p>
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
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {programs[Number(o.value)]!.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="sim-pop__line">{pattern.map((p) => programs[p]?.id ?? '?').join(' ')}</p>
          <KeyBank
            size="sm"
            block
            label="Apply to"
            options={[
              { value: 'rest', label: `week ${focusRow + 1} to the end` },
              { value: 'all', label: 'every week' },
            ]}
            value={range}
            onChange={setRange}
          />
          <div className="sim-pop__foot">
            <Key size="sm" variant="quiet" onClick={() => pop.setOpen(false)}>
              Cancel
            </Key>
            <Key
              size="sm"
              variant="solid"
              onClick={() => {
                const from = range === 'all' ? 0 : Math.max(0, focusRow * 7 - g.offset);
                editSchedule(sid, [{ op: 'applyPattern', pattern, fromDay: from }]);
                pop.setOpen(false);
                toast(`Pattern ${pattern.map((p) => programs[p]?.id).join(' ')} applied`, {
                  action: { label: 'Undo', onClick: () => undoSchedule(sid) },
                });
              }}
            >
              Apply pattern
            </Key>
          </div>
        </div>
      </Popover>
    </>
  );
}

const DURATIONS = ['24', '36', '48', '72'] as const;

function InsertFastTool({
  sid,
  model,
  day,
  size = 'sm',
}: {
  sid: string;
  model: ScheduleModel;
  day: number;
  size?: KeySize;
}) {
  const pop = usePopover();
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
  return (
    <>
      <Tooltip content="Insert a water-only fast" role="label">
        <Key
          size={size}
          variant="quiet"
          icon={Glyphs.FastClock}
          {...pop.triggerProps}
          className="sim-barkey"
          aria-label="Insert a water-only fast"
        >
          <span className="sim-barkey__text">Insert fast</span>
        </Key>
      </Tooltip>
      <Popover
        open={pop.open}
        onOpenChange={pop.setOpen}
        anchorRef={pop.anchorRef}
        label="Insert a water-only fast"
        placement="bottom-end"
        padding="roomy"
      >
        <div className="sim-pop">
          <p className="sim-pop__title">
            Water-only fast from {iso ? formatDayShort(iso) : `day ${day + 1}`}
          </p>
          <div className="sim-grid2">
            <TimeField label="last meal" value={startH} onChange={setStartH} />
            <div className="sim-field">
              <span className="lm-eng">meal to meal</span>
              <Stepper
                name="fast length"
                value={hours}
                onChange={setHours}
                min={12}
                max={240}
                step={12}
                unit="h"
              />
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
              ? `fast runs to the end of the schedule`
              : `next meal ${nextIso ? `${formatDayShort(nextIso).split(' ')[0]} ` : ''}${formatClock(nextMeal % 24)} · ${nextDays} day${nextDays === 1 ? '' : 's'} later`}
            {actualH !== null && Math.round(actualH) !== hours
              ? ` · ${Math.round(actualH)} h meal to meal: no meal is scheduled at ${formatClock((t0 + hours) % 24)}`
              : ''}
          </p>
          <Switch
            checked={electrolytes}
            onChange={setElectrolytes}
            label="Electrolytes during the fast"
            labelStyle="sentence"
          />
          <Switch
            checked={refeed}
            onChange={setRefeed}
            label="Restart food gradually afterwards"
            labelStyle="sentence"
          />
          <div className="sim-pop__foot">
            <Key size="sm" variant="quiet" onClick={() => pop.setOpen(false)}>
              Cancel
            </Key>
            <Key
              size="sm"
              variant="solid"
              onClick={() => {
                editSchedule(sid, [
                  {
                    op: 'addFast',
                    fast: {
                      startDay: day,
                      startH,
                      durationH: hours,
                      electrolytes,
                      refeed: refeed ? 'auto' : 'none',
                    },
                  },
                  ]);
                pop.setOpen(false);
                toast(`${shownH} h fast inserted${shownH !== hours ? ` (next meal ${nextIso ? formatDayShort(nextIso) : ''} ${nextMeal === null ? '' : formatClock(nextMeal % 24)})` : ''}`, {
                  action: { label: 'Undo', onClick: () => undoSchedule(sid) },
                });
              }}
            >
              Insert fast
            </Key>
          </div>
        </div>
      </Popover>
    </>
  );
}
