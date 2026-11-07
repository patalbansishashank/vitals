/**
 * A program's row sheet (SPEC §4: an object row opens its row sheet on tap and the row's other actions live there; the
 * row keeps one key of its own, Paint). A bottom sheet on phones, a 392 px side panel from 1024 px, like the meal sheet.
 * - title · ✕: the program's letter and name. The sheet commits nothing itself: every key closes it, then acts;
 * - one fact line: the row's numbers and the days painted with it ("80 % · 2 310 kcal · 12 h eating · 84 A days");
 * - text keys flush with the text: "Edit all A days" and "Duplicate", then "Delete" in rose on its own line
 *   ("Delete · replace with…" while days use it: the dialog that follows asks which program takes them).
 * A key that cannot act (a full program list, the last program) stays focusable and says why as its tooltip.
 */
import { Key, ResponsivePanel } from '@/components';
import type { DayTemplate } from '@/engine';
import { MAX_PROGRAMS } from '../lib/ops';

export interface ProgramSheetProps {
  /** The sheet is open (it keeps its program on screen while it slides away). */
  open: boolean;
  /** The program it acts on; null renders nothing. */
  program: DayTemplate | null;
  /** The row's numbers in one line: "80 % · 2 310 kcal · 12 h eating". */
  summary: string;
  /** Days painted with the program. */
  days: number;
  /** The program list is full (MAX_PROGRAMS): no duplicate. */
  full: boolean;
  /** It is the only program: it cannot be deleted. */
  last: boolean;
  onClose(): void;
  onEdit(): void;
  onDuplicate(): void;
  onDelete(): void;
}

export function ProgramSheet({
  open,
  program,
  summary,
  days,
  full,
  last,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: ProgramSheetProps) {
  if (!program) return <ResponsivePanel open={false} onClose={onClose} title="" />;
  const id = program.id;
  const fact = `${summary} · ${days > 0 ? `${days} ${id} day${days === 1 ? '' : 's'}` : `no ${id} days`}`;
  const then = (act: () => void) => () => {
    onClose();
    act();
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={`${id} · ${program.label}`}
      className="sim-progsheet"
    >
      <div className="sim-progsheet__body">
        <p className="sim-progsheet__fact">{fact}</p>
        <div className="sim-progsheet__keys">
          <Key variant="outlined" onClick={then(onEdit)}>
            Edit all {id} days
          </Key>
          <Key
            variant="outlined"
            onClick={then(onDuplicate)}
            disabledReason={full ? `A schedule holds up to ${MAX_PROGRAMS} programs` : undefined}
          >
            Duplicate
          </Key>
        </div>
        <Key
          variant="danger"
          className="sim-progsheet__delete"
          onClick={then(onDelete)}
          disabledReason={last ? 'A schedule needs at least one program' : undefined}
        >
          {days > 0 ? 'Delete · replace with…' : 'Delete'}
        </Key>
      </div>
    </ResponsivePanel>
  );
}
