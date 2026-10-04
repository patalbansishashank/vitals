/* ==========================================================================
   <DataTable> — the table-view twin of every chart (CHART_SPEC §9): visible
   metrics × visible time range at the current resolution, value with likely
   range, CSV download. Sticky header + first column.
   ========================================================================== */
import { useMemo } from 'react';
import { Download, X } from 'lucide-react';
import { IconKey, Key, type EnergyUnitChoice } from '@/components';
import { formatNumber, formatRange, unitSuffix } from '../lib/format';
import { buildTable, tableToCSV } from '../lib/table';
import type { ChartSeries, IntakeContext, Resolution, TimeBase } from '../types';

export interface DataTableProps {
  time: TimeBase;
  series: readonly ChartSeries[];
  x0: number;
  x1: number;
  res: Resolution;
  intake?: IntakeContext;
  /** Unit of the intake and maintenance columns (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
  caption?: string;
  fileName?: string;
  onClose?: () => void;
}

const RES_TEXT: Record<Resolution, string> = { daily: 'daily values', '6h': '6-hourly means', hourly: 'hourly values' };

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

export function DataTable({ time, series, x0, x1, res, intake, energyUnit, caption, fileName = 'vitals-projection.csv', onClose }: DataTableProps) {
  const model = useMemo(() => buildTable(time, series, x0, x1, res, intake, { energyUnit }), [time, series, x0, x1, res, intake, energyUnit]);
  return (
    <div className="lmc-table-block">
      <div className="lmc-table-bar">
        <span>
          {caption ?? 'Table view'} · {model.rows.length} rows · {RES_TEXT[model.res]}
        </span>
        <span className="lmc-toolbar__grow" />
        <Key size="sm" icon={Download} onClick={() => downloadText(tableToCSV(model), fileName)}>
          Download CSV
        </Key>
        {onClose ? <IconKey size="sm" icon={X} label="Close table" onClick={onClose} /> : null}
      </div>
      <div className="lmc-table-wrap" tabIndex={0} role="region" aria-label={caption ?? 'Projection data table'}>
        <table className="lmc-table">
          <caption className="lmc-sr">{caption ?? 'Projection values'}; values with the likely range (80 %) in brackets.</caption>
          <thead>
            <tr>
              <th scope="col">time</th>
              {model.columns.map((c) => (
                <th key={c.id} scope="col">
                  {c.header}
                  <small>{unitSuffix(c.unit) || 'index'}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => (
              <tr key={r.t}>
                <th scope="row">{r.label}</th>
                {r.cells.map((c, k) => (
                  <td key={model.columns[k]!.id}>
                    {formatNumber(c.v, model.columns[k]!.decimals)}
                    {Number.isFinite(c.lo) && Number.isFinite(c.hi) ? (
                      <span className="lmc-rng">({formatRange(c.lo, c.hi, model.columns[k]!.decimals)})</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
