/* ==========================================================================
   <MonitorSheet> (DATAVIZ P10, SPEC A.3.2): reorder, add and remove the signals a card shows. Since r071 it is a thin
   wrapper over `CardLibrary` (src/components/CardLibrary.tsx, `variant="monitor"`), which keeps its markup, class
   names and behaviour exactly, so the Ring's Signals card works unchanged until it migrates to `CardLibrary` itself;
   then this file goes. The pure helpers moved with the logic and are re-exported here for the callers and tests that
   import them from this path.
   ========================================================================== */
import { CardLibrary, addId, monitorCapacity, moveId, movedText, removeId, type LibraryItem } from '../CardLibrary';
import type { IconComponent } from '../icons/Icon';

export { moveId, removeId, addId, monitorCapacity, movedText };

export interface MonitorItem {
  id: string;
  label: string;
  icon?: IconComponent;
  valueText?: string | null;
  calibrating?: boolean;
}

export interface MonitorSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** In order. Items the ring cannot supply are never passed in. */
  selected: MonitorItem[];
  available: MonitorItem[];
  defaultIds: string[];
  max?: number;
  onChange(ids: string[]): void;
  onReset(): void;
  /** Default "Edit signals". */
  title?: string;
  quiet?: boolean;
  className?: string;
}

const asItem = (i: MonitorItem): LibraryItem => ({ id: i.id, label: i.label, icon: i.icon, hue: 'neutral', group: 'Signals', valueText: i.valueText, calibrating: i.calibrating });

export function MonitorSheet({ open, onOpenChange, selected, available, defaultIds, max, onChange, onReset, title = 'Edit signals', quiet = false, className }: MonitorSheetProps) {
  return (
    <CardLibrary
      variant="monitor"
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      items={[...selected, ...available].map(asItem)}
      selected={selected.map((i) => ({ id: i.id }))}
      defaultSelected={defaultIds.map((id) => ({ id }))}
      max={max}
      onChange={(next) => onChange(next.map((s) => s.id))}
      onReset={onReset}
      quiet={quiet}
      className={className}
    />
  );
}
