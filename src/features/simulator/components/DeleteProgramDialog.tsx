/**
 * "Program deleted while in use" (simulator-schedule.md §8): never leaves holes — pick the program its days take.
 */
import { useState } from 'react';
import { Dialog, Key, KeyBank } from '@/components';
import type { DayTemplate } from '@/engine';

export function DeleteProgramDialog({
  programs,
  index,
  usage,
  onCancel,
  onDelete,
}: {
  programs: readonly DayTemplate[];
  index: number | null;
  usage: readonly number[];
  onCancel: () => void;
  onDelete: (index: number, replaceWith: number) => void;
}) {
  const p = index !== null ? programs[index] : undefined;
  const others = programs.map((x, i) => ({ x, i })).filter(({ i }) => i !== index);
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const replaceWith = choice !== undefined ? Number(choice) : (others[0]?.i ?? 0);
  const used = index !== null ? (usage[index] ?? 0) : 0;
  return (
    <Dialog
      open={index !== null && !!p}
      onClose={onCancel}
      title={p ? (used > 0 ? `Replace ${p.id} with…` : `Delete ${p.id}?`) : ''}
      role="alertdialog"
      footer={
        <>
          <Key variant="quiet" onClick={onCancel}>
            Keep {p?.id}
          </Key>
          <Key variant="danger" onClick={() => index !== null && onDelete(index, replaceWith)}>
            Delete {p?.id}
          </Key>
        </>
      }
    >
      {p ? (
        <div className="sim-delprog">
          <p className="m-0">
            {used > 0
              ? `${used} day${used === 1 ? '' : 's'} use ${p.id} · ${p.label}. They take the program you pick.`
              : `${p.id} · ${p.label} is not painted on any day.`}
          </p>
          {used > 0 ? (
            <KeyBank
              label="Replace with"
              options={others
                .slice(0, 6)
                .map(({ x, i }) => ({ value: String(i), label: `${x.id} · ${x.label}` }))}
              value={String(replaceWith)}
              onChange={setChoice}
              orientation="vertical"
              block
            />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
