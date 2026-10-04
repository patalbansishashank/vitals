/**
 * Scenario switcher (COMPONENTS §11): the context-bar title with a chevron → popover (desktop) / sheet (mobile)
 * listing scenarios (name, horizon, stale dot, current = check) with New · Duplicate · Rename · Delete.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog, Icon, Key, MQ, Popover, Sheet, useMediaQuery, usePopover } from '@/components';
import { paths } from '@/app/paths';
import { useScheduleStore, type Scenario } from '@/state/scheduleStore';
import { useSimulationStore } from '@/state/simulationStore';
import { formatDateShort, formatHorizon } from '../lib/calendar';
import { dispatchSync, outputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';

export function ScenarioSwitcher({ current }: { current: Scenario }) {
  const { open: popOpen, setOpen: setPopOpen, anchorRef } = usePopover();
  const lg = useMediaQuery(MQ.lg);
  const [sheet, setSheet] = useState(false);
  const open = lg ? popOpen : sheet;
  const setOpen = lg ? setPopOpen : setSheet;
  return (
    <>
      <button
        type="button"
        className="sim-switcher"
        ref={anchorRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="sim-switcher__name">{current.name}</span>
        <Icon icon={ChevronDown} size={16} />
      </button>
      {lg ? (
        <Popover
          open={popOpen}
          onOpenChange={setPopOpen}
          anchorRef={anchorRef}
          label="Scenarios"
          placement="bottom-start"
        >
          <ScenarioList current={current} onDone={() => setPopOpen(false)} />
        </Popover>
      ) : (
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Scenarios"
          detents={['half', 'full']}
          defaultDetent="half"
        >
          <ScenarioList current={current} onDone={() => setSheet(false)} />
        </Sheet>
      )}
    </>
  );
}

function ScenarioList({ current, onDone }: { current: Scenario; onDone: () => void }) {
  const scenarios = useScheduleStore((s) => s.scenarios);
  const lastRuns = useSimulationStore((s) => s.lastRuns);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const go = (id: string) => {
    void sendCommand('scenario.setActive', { id });
    navigate(paths.schedule(id));
    onDone();
  };
  return (
    <div className="sim-scenarios">
      <ul className="sim-scenarios__list" aria-label="Scenarios">
        {scenarios.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="sim-scenarios__item"
              aria-current={s.id === current.id || undefined}
              onClick={() => go(s.id)}
            >
              <span className="sim-scenarios__check">
                {s.id === current.id ? <Icon icon={Check} size={16} /> : null}
              </span>
              <span className="sim-scenarios__name">{s.name}</span>
              <span className="sim-scenarios__meta">
                {formatHorizon(s.schedule.horizonDays)} · {formatDateShort(s.schedule.startDate)}
                {lastRuns[s.id] ? ' · run' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {renaming ? (
        <form
          className="sim-scenarios__rename"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get('name') ?? '');
            void sendCommand('scenario.rename', { id: current.id, name: v });
            setRenaming(false);
          }}
        >
          <input
            name="name"
            className="sim-input"
            defaultValue={current.name}
            maxLength={60}
            autoFocus
            aria-label="Scenario name"
          />
          <Key size="sm" variant="solid" type="submit">
            Rename
          </Key>
        </form>
      ) : null}
      <div className="sim-scenarios__actions">
        <Key
          size="sm"
          variant="quiet"
          icon={Plus}
          onClick={() => {
            const id = outputOf(dispatchSync('scenario.create', { started: false }))?.scenarioId ?? '';
            navigate(paths.schedule(id));
            onDone();
          }}
        >
          New scenario
        </Key>
        <Key
          size="sm"
          variant="quiet"
          icon={Copy}
          onClick={() => {
            const id = outputOf(dispatchSync('scenario.duplicate', { id: current.id }))?.scenarioId ?? null;
            if (id) navigate(paths.schedule(id));
            onDone();
          }}
        >
          Duplicate
        </Key>
        <Key size="sm" variant="quiet" icon={Pencil} onClick={() => setRenaming(true)}>
          Rename
        </Key>
        <Key
          size="sm"
          variant="danger"
          icon={Trash2}
          onClick={() => setConfirm(true)}
          disabledReason={scenarios.length <= 1 ? 'Keep at least one scenario' : undefined}
        >
          Delete
        </Key>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete “${current.name}”?`}
        role="alertdialog"
        footer={
          <>
            <Key variant="quiet" onClick={() => setConfirm(false)}>
              Keep it
            </Key>
            <Key
              variant="danger"
              onClick={() => {
                const next = scenarios.find((s) => s.id !== current.id);
                // also forgets the scenario's last run (restorable with undo)
                void sendCommand('scenario.delete', { id: current.id });
                setConfirm(false);
                onDone();
                if (next) navigate(paths.schedule(next.id));
              }}
            >
              Delete scenario
            </Key>
          </>
        }
      >
        <p className="m-0">
          Its programs, painted days and last run are removed from this browser. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
