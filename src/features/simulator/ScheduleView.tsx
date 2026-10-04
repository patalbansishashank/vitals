/**
 * The schedule tab (simulator-schedule.md): program tray | summary + raster (+ bar, preview) | day editor.
 * ≥ 1280 px three columns with the editor docked; 1024–1279 the editor is a right drawer; below 1024 the tray is a
 * rail above the raster, the editor a bottom sheet, and the action bar carries "painting with …" and the Run key.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronUp, X } from 'lucide-react';
import { ActionBar } from '@/app/shell';
import { Faceplate, IconKey, Key, MQ, ResponsivePanel, Sheet, toast, useMediaQuery } from '@/components';
import type { PersonProfile } from '@/engine';
import { useScheduleStore, type Scenario } from '@/state/scheduleStore';
import { DayEditor, type EditorTarget } from './components/DayEditor';
import { DeleteProgramDialog } from './components/DeleteProgramDialog';
import { SchedulePreview } from './components/Preview';
import { ProgramTray } from './components/ProgramTray';
import { WeekScrubber } from './components/WeekScrubber';
import { RasterBar } from './components/RasterBar';
import { ScheduleRaster, type RasterCommand } from './components/ScheduleRaster';
import { StarterPicker } from './components/StarterPicker';
import { SummaryStrip } from './components/SummaryStrip';
import { SCRUBBER_MIN_WEEKS, diffDaysISO, formatDayShort, rowDays } from './lib/calendar';
import type { EditScope } from './editing';
import { ruleTitle } from './safety';
import { useResolvedProfile, useScheduleModel } from './useScheduleModel';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { editSchedule, redoSchedule, sealSchedule, undoSchedule } from './commands';

export interface ScheduleViewProps {
  scenario: Scenario;
  profile: PersonProfile;
  /** The mobile action bar's Run key (rendered by the page). */
  runKey: ReactNode;
}

export function ScheduleView({ scenario, profile, runKey }: ScheduleViewProps) {
  const sid = scenario.id;
  const schedule = scenario.schedule;
  const resolved = useResolvedProfile(profile);
  const model = useScheduleModel(schedule, resolved)!;
  const st = useScheduleStore.getState;
  const n = schedule.horizonDays;
  const lg = useMediaQuery(MQ.lg);
  const xl = useMediaQuery(MQ.xl);
  const [params, setParams] = useSearchParams();

  const [armed, setArmedRaw] = useState<number | null>(null);
  const [selection, setSelection] = useState<Set<number>>(() => new Set([0]));
  const [anchor, setAnchor] = useState(0);
  const [focusRaw, setFocusDay] = useState(0);
  const [target, setTarget] = useState<EditorTarget>({ day: 0, program: 0 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [scope, setScope] = useState<EditScope>('day');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [programSheet, setProgramSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // the weekday header sticks under the (wrapping) context bar on mobile: measure it
  useEffect(() => {
    const slot = document.querySelector<HTMLElement>('.lm-ctx-slot');
    const root = rootRef.current;
    if (!slot || !root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => root.style.setProperty('--sim-ctx-h', `${slot.offsetHeight}px`));
    ro.observe(slot);
    return () => ro.disconnect();
  }, [scenario.started]);

  // clamp to the current horizon / program list (horizon or programs may shrink)
  const focusDay = Math.min(focusRaw, n - 1);
  const armedIdx = armed !== null && armed < schedule.programs.length ? armed : null;
  const tgt: EditorTarget =
    target.day !== null && target.day >= n
      ? { day: n - 1, program: 0 }
      : target.day === null && target.program >= schedule.programs.length
        ? { day: focusDay, program: 0 }
        : target;
  const sel = useMemo(() => new Set([...selection].filter((d) => d < n)), [selection, n]);

  const setArmed = (i: number | null) => {
    setArmedRaw(i);
  };
  const select = (days: number[], a: number) => {
    setSelection(new Set(days));
    setAnchor(a);
  };
  const openDay = (d: number) => {
    setTarget({ day: d, program: schedule.days[d]?.program ?? 0 });
    setScope('day');
    setFocusDay(d);
    setEditorOpen(true);
    // below 1024 px the editor is a 60 % sheet: bring the tapped week up so the cell stays visible above it
    if (!lg)
      window.requestAnimationFrame(() =>
        document
          .querySelector(`.sim-raster [data-day="${d}"]`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
  };

  // Deep links (IA §2): ?day=2026-10-14 opens the day editor; results remedy links add ?days=a-b&fix=W-… (0-based,
  // inclusive) to pre-select the affected range. Adopted during render, then dropped from the URL.
  const dayParam = params.get('day');
  const daysParam = params.get('days');
  const fixParam = params.get('fix');
  const linkKey = dayParam || daysParam ? `${dayParam}|${daysParam}|${fixParam}` : '';
  const [linked, setLinked] = useState('');
  const link = useMemo(() => {
    if (!linkKey) return null;
    const d = dayParam ? diffDaysISO(schedule.startDate, dayParam) : Number.NaN;
    const m = daysParam ? /^(\d+)-(\d+)$/.exec(daysParam) : null;
    const a = m ? Math.min(n - 1, Math.max(0, Number(m[1]))) : Number.isFinite(d) ? d : Number.NaN;
    const b = m ? Math.min(n - 1, Math.max(a, Number(m[2]))) : a;
    if (!Number.isFinite(a) || a < 0 || a >= n) return null;
    return { a, b, day: Number.isFinite(d) && d >= 0 && d < n ? d : null };
  }, [linkKey, dayParam, daysParam, schedule.startDate, n]);
  if (linkKey && linkKey !== linked) {
    setLinked(linkKey);
    if (link) {
      const range: number[] = [];
      for (let d = link.a; d <= link.b; d++) range.push(d);
      setSelection(new Set(range));
      setAnchor(link.a);
      setFocusDay(link.day ?? link.a);
      if (link.day !== null) {
        setTarget({ day: link.day, program: schedule.days[link.day]?.program ?? 0 });
        setScope('day');
        setEditorOpen(true);
      }
    }
  }
  useEffect(() => {
    if (!linkKey) return;
    if (link) {
      const id = window.requestAnimationFrame(() =>
        document.querySelector(`.sim-raster [data-day="${link.a}"]`)?.scrollIntoView({ block: 'center' }),
      );
      if (fixParam)
        toast(
          `${link.b > link.a ? `Days ${link.a + 1}–${link.b + 1}` : `Day ${link.a + 1}`} selected · ${ruleTitle(fixParam)}`,
        );
      void id;
    }
    setParams(
      (p) => {
        p.delete('day');
        p.delete('days');
        p.delete('fix');
        return p;
      },
      // keep the linked day scrolled into view (ScrollRestoration would reset to the top)
      { replace: true, preventScrollReset: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per incoming link
  }, [linkKey]);

  // ⌘Z / ⇧⌘Z undo-redo (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoSchedule(sid);
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redoSchedule(sid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sid, st]);

  // Painting onto days a fast event covers changes nothing there until the fast moves (QA 2026-10-01): say so.
  const strokeDays = useRef<Set<number>>(new Set());
  const explainFastOverride = (days: Iterable<number>, program: number) => {
    const hit = [...days]
      .filter((d) => {
        const c = model.compiled.days[d];
        const span = model.fasts[d]?.span;
        return !!c && !!span && span.eventIndex >= 0 && (c.zeroIntake || (c.mealDropMask ?? 0) > 0);
      })
      .sort((a, b) => a - b);
    if (hit.length === 0 || schedule.programs[program]?.energy.kind === 'zero') return;
    const a = hit[0]!;
    const b = hit[hit.length - 1]!;
    toast(
      `${hit.length === 1 ? `Day ${a + 1} is` : `Days ${a + 1}–${b + 1} are`} inside a fast: the fast overrides program ${
        schedule.programs[program]?.id ?? ''
      }’s food there (training and sleep still apply).`,
    );
  };
  const paintSelection = () => {
    if (armedIdx === null) return;
    editSchedule(sid, [{ op: 'paint', days: [...sel], program: armedIdx }]);
    explainFastOverride(sel, armedIdx);
  };
  const clearSelection = () => {
    const days = sel.size > 0 ? [...sel] : [focusDay];
    editSchedule(sid, [{ op: 'clear', days }]);
    if (days.length > 1)
      toast(`${days.length} days cleared to ${schedule.programs[0]!.id}`, {
        action: { label: 'Undo', onClick: () => undoSchedule(sid) },
      });
  };
  const onCommand = (c: RasterCommand) => {
    if (c.kind === 'paintSelection') paintSelection();
    else if (c.kind === 'clearSelection') clearSelection();
    else if (c.kind === 'arm') setArmed(c.program);
    else if (c.kind === 'copyWeek') {
      st().copyWeek(sid, c.row);
      toast(`Week ${c.row + 1} copied`);
    } else if (c.kind === 'pasteWeeks') {
      const clip = useScheduleStore.getState().clipboard;
      if (!clip) return;
      const rows = [...new Set([...sel].map((d) => Math.floor((d + model.grid.offset) / 7)))].filter(
        (r) => r !== clip.fromRow,
      );
      if (rows.length === 0) return;
      editSchedule(sid, [{ op: 'copyWeek', fromRow: clip.fromRow, toRows: rows, cols: clip.cols as never }]);
      toast(`Week ${clip.fromRow + 1} pasted`, { action: { label: 'Undo', onClick: () => undoSchedule(sid) } });
    }
  };

  const rowPct = useMemo(() => {
    const out: number[] = [];
    for (let r = 0; r < model.grid.rows; r++) {
      const days = rowDays(model.grid, r);
      out.push(days.reduce((a, d) => a + (model.cells[d]?.pct ?? 0), 0) / Math.max(1, days.length));
    }
    return out;
  }, [model]);

  if (!scenario.started) {
    return (
      <div className="sim-sched sim-sched--empty">
        <StarterPicker onPick={(id) => void sendCommand('scenario.applyStarter', { id: sid, starter: id })} />
        <ActionBar>
          <div className="sim-ab__text">
            <span className="lm-eng">no days painted</span>
            <b>Pick a starter</b>
          </div>
          {runKey}
        </ActionBar>
      </div>
    );
  }

  const armedProg = armedIdx !== null ? schedule.programs[armedIdx] : null;
  const editorDay = tgt.day;
  const panelOpen = xl || editorOpen;
  const panelTitle =
    editorDay !== null
      ? formatDayShort(model.cells[editorDay]!.iso)
      : `Program ${schedule.programs[tgt.program]?.id ?? ''}`;

  const tray = (
    <ProgramTray
      programs={schedule.programs}
      resolved={resolved}
      maintKcal={model.programMaintKcal}
      usage={model.usage}
      armed={armedIdx}
      onArm={(i) => setArmed(i)}
      onEdit={(i) => {
        const first = schedule.days.findIndex((d) => d.program === i);
        setTarget(first >= 0 ? { day: first, program: i } : { day: null, program: i });
        setScope('all');
        setEditorOpen(true);
        if (first >= 0) setFocusDay(first);
      }}
      onAdd={(preset) => {
        const idx = editSchedule(sid, [{ op: 'addProgram', preset }])?.programIndex ?? -1;
        if (idx >= 0) {
          setArmed(idx);
          const letter = st().scenarios.find((x) => x.id === sid)?.schedule.programs[idx]?.id ?? '';
          toast(`Program ${letter} added and armed · drag across days to paint it`);
        }
      }}
      onDuplicate={(i) => {
        const idx = editSchedule(sid, [{ op: 'duplicateProgram', index: i }])?.programIndex ?? -1;
        if (idx >= 0) setArmed(idx);
      }}
      onDelete={(i) => setDeleting(i)}
      className="sim-sched__tray"
    />
  );

  return (
    <div ref={rootRef} className="sim-sched" data-editor={xl ? 'docked' : undefined}>
      {tray}
      <div className="sim-sched__main">
        <SummaryStrip model={model} focusDay={focusDay} />
        <Faceplate variant="flush" className="sim-rasterface" aria-label="Schedule">
          <RasterBar
            sid={sid}
            model={model}
            selection={sel}
            focusDay={focusDay}
            armed={armedIdx}
            onSelect={select}
            onPaintSelection={paintSelection}
            onClearSelection={clearSelection}
          />
          {model.grid.rows >= SCRUBBER_MIN_WEEKS ? (
            <WeekScrubber
              model={model}
              rowPct={rowPct}
              focusDay={focusDay}
              onJump={(row) => {
                const days = rowDays(model.grid, row);
                if (days[0] !== undefined) setFocusDay(days[0]);
                rootRef.current
                  ?.querySelector<HTMLElement>(`.sim-raster__grid [role="row"][aria-rowindex="${row + 2}"]`)
                  ?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
              }}
            />
          ) : null}
          <ScheduleRaster
            model={model}
            armed={armedIdx}
            selection={sel}
            anchor={Math.min(anchor, n - 1)}
            focusDay={focusDay}
            editorDay={panelOpen ? editorDay : null}
            onSelect={select}
            onFocusDay={setFocusDay}
            onOpenDay={openDay}
            onPaint={(days, stroke) => {
              if (armedIdx === null) return;
              editSchedule(sid, [{ op: 'paint', days, program: armedIdx }], stroke);
              for (const d of days) strokeDays.current.add(d);
            }}
            onStrokeEnd={() => {
              sealSchedule(sid);
              if (armedIdx !== null) explainFastOverride(strokeDays.current, armedIdx);
              strokeDays.current = new Set();
            }}
            onCommand={onCommand}
            onSelectPhase={(p) => {
              const days: number[] = [];
              for (let d = p.startDay; d < p.endDay; d++) days.push(d);
              select(days, p.startDay);
              setFocusDay(p.startDay);
            }}
            onRenamePhase={(p, name) => {
              if (p.explicit) editSchedule(sid, [{ op: 'renameBlock', index: p.blockIndex, name }]);
              else
                editSchedule(sid, [
                  {
                    op: 'setBlocks',
                    blocks: model.phases.map((q) => ({
                      name: q === p ? name : q.name,
                      startDay: q.startDay,
                      endDay: q.endDay,
                    })),
                  },
                ]);
            }}
            rowPct={rowPct}
          >
            <SchedulePreview
              profile={profile}
              schedule={schedule}
              cautions={model.check.counts.caution + model.check.counts.danger}
            />
          </ScheduleRaster>
        </Faceplate>
      </div>
      <ResponsivePanel
        open={panelOpen}
        onClose={() => setEditorOpen(false)}
        title={panelTitle}
        dockAtXl
        detents={['half', 'full']}
        defaultDetent="half"
        className="sim-sched__editor"
      >
        <DayEditor
          sid={sid}
          model={model}
          target={tgt}
          scope={scope}
          onScope={setScope}
          onNavigate={(d) => {
            setTarget({ day: d, program: schedule.days[d]?.program ?? 0 });
            setFocusDay(d);
            select([d], d);
          }}
        />
      </ResponsivePanel>
      <DeleteProgramDialog
        key={deleting ?? -1}
        programs={schedule.programs}
        index={deleting}
        usage={model.usage}
        onCancel={() => setDeleting(null)}
        onDelete={(i, r) => {
          editSchedule(sid, [{ op: 'deleteProgram', index: i, replaceWith: r }]);
          setDeleting(null);
          if (armedIdx === i) setArmed(null);
          toast(`Program deleted`, { action: { label: 'Undo', onClick: () => undoSchedule(sid) } });
        }}
      />
      {!lg ? (
        <>
          <ActionBar>
            {sel.size > 1 ? (
              <div className="sim-ab__bulk">
                <span className="sim-ab__count">{sel.size} days</span>
                {armedProg ? (
                  <Key size="sm" onClick={paintSelection}>
                    Paint {armedProg.id}
                  </Key>
                ) : null}
                <Key size="sm" variant="quiet" onClick={clearSelection}>
                  Clear
                </Key>
                <IconKey size="sm" icon={X} label="Deselect" onClick={() => select([focusDay], focusDay)} />
              </div>
            ) : (
              <button
                type="button"
                className="sim-ab__text sim-ab__arm"
                onClick={() => setProgramSheet(true)}
                aria-haspopup="dialog"
              >
                <span className="lm-eng">
                  {armedProg ? 'painting with · tap days' : 'nothing armed · tap opens a day'}
                </span>
                <b>
                  {armedProg ? `${armedProg.id} · ${armedProg.label}` : 'Pick a program'}
                  <ChevronUp size={14} aria-hidden="true" />
                </b>
              </button>
            )}
            {runKey}
          </ActionBar>
          <Sheet
            open={programSheet}
            onClose={() => setProgramSheet(false)}
            title="Paint with"
            detents={['peek', 'half']}
            defaultDetent="peek"
          >
            <ProgramTray
              programs={schedule.programs}
              resolved={resolved}
              maintKcal={model.programMaintKcal}
              usage={model.usage}
              armed={armedIdx}
              onArm={(i) => {
                setArmed(i);
                setProgramSheet(false);
              }}
              onEdit={(i) => {
                setProgramSheet(false);
                setTarget({ day: null, program: i });
                setScope('all');
                setEditorOpen(true);
              }}
              onAdd={(preset) => {
                const idx = editSchedule(sid, [{ op: 'addProgram', preset }])?.programIndex ?? -1;
                if (idx >= 0) setArmed(idx);
              }}
              onDuplicate={(i) => void editSchedule(sid, [{ op: 'duplicateProgram', index: i }])}
              onDelete={(i) => {
                setProgramSheet(false);
                setDeleting(i);
              }}
              className="sim-tray--sheet"
            />
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
