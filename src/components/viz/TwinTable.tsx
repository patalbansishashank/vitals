/* ==========================================================================
   <TwinTable>: the table twin of a plotted series, with its CSV. The markup
   contract is the one of charts/living/TrendLane's TwinTable (components
   never import features, so it is kept here); __tests__/contract.test.tsx
   renders both and fails on any difference. `rowNoun` is additive: left out,
   the bar reads "N days" as TrendLane's does. The markup is therefore frozen
   (r071 restyles it through selectors in viz.css outside the copy block, never
   by changing it); `TwinKey` is the one part that is free to change.
   ========================================================================== */
import type { ReactNode } from 'react';
import { Download, Table2 } from 'lucide-react';
import { Key } from '../Key';
import './viz.css';

/** Save text as a file (the charts module's downloadText, copied). */
export function downloadText(text: string, fileName: string, type = 'text/csv'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV with quoted cells where needed. */
export function toCSV(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const cell = (v: string | number) => {
    const s = String(v).replace(/−/g, '-');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export interface TwinTableProps {
  id: string;
  /** Accessible name of the scroll region ("Weight trend table"). */
  title: string;
  caption: string;
  rows: number;
  fileName: string;
  csv: () => string;
  children: ReactNode;
  /** Row noun, singular and plural (default day / days). */
  rowNoun?: [string, string];
}

/** Table-twin shell: row count, CSV download, a scrollable table with sticky header. */
export function TwinTable({ id, title, caption, rows, fileName, csv, children, rowNoun = ['day', 'days'] }: TwinTableProps) {
  return (
    <div className="lmc-twin" id={id}>
      <div className="lmc-twin__bar">
        <span>{rows === 1 ? `1 ${rowNoun[0]}` : `${rows} ${rowNoun[1]}`}</span>
        <span className="lmc-twin__grow" />
        <Key size="sm" variant="outlined" icon={Download} onClick={() => downloadText(csv(), fileName)}>
          Download CSV
        </Key>
      </div>
      <div className="lmc-twin__wrap" tabIndex={0} role="region" aria-label={title}>
        <table className="lmc-twin__table">
          <caption className="lm-sr">{caption}</caption>
          {children}
        </table>
      </div>
    </div>
  );
}

/** The "Table" text key that shows and hides a chart's twin. */
export function TwinKey({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    // (r071) a text key with the table icon and no box: the same icon and key in both states, so "Table" and
    // "Hide table" read as one button (r068 G11 asked for that; the outline is what went)
    <Key size="sm" variant="text" icon={Table2} aria-expanded={open} aria-controls={controls} onClick={onToggle} className="lmv-twinkey">
      {open ? 'Hide table' : 'Table'}
    </Key>
  );
}
