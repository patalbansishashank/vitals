/* ==========================================================================
   Table-view twin (CHART_SPEC §9, COMPONENTS §12): the visible metrics and
   time range at the current resolution, values with likely ranges, CSV.
   ========================================================================== */
import type { EnergyUnitChoice } from '@/components';
import type { ChartSeries, IntakeContext, Resolution, TimeBase } from '../types';
import { formatNumber, formatRange, unitSuffix } from './format';
import { valueAt } from './series';
import { describeSample, sampleT, SAMPLES_PER_DAY, visibleIndexRange } from './time';
import { intakeEnergy } from './intake';

export interface TableColumn {
  id: string;
  header: string;
  unit: string;
  decimals: number;
}

export interface TableCell {
  v: number;
  lo: number;
  hi: number;
  /** "19.8 (18.6–21.0)" */
  text: string;
}

export interface TableRow {
  t: number;
  label: string;
  cells: TableCell[];
}

export interface TableModel {
  res: Resolution;
  columns: TableColumn[];
  rows: TableRow[];
}

export interface TableOptions {
  /** Unit of the intake and maintenance columns (Settings › energy; default kcal). Series keep their own units. */
  energyUnit?: EnergyUnitChoice;
}

export function buildTable(
  time: TimeBase,
  series: readonly ChartSeries[],
  x0: number,
  x1: number,
  res: Resolution,
  intake?: IntakeContext,
  opts: TableOptions = {},
): TableModel {
  const columns: TableColumn[] = [];
  const energyUnit = opts.energyUnit ?? 'kcal';
  const energy = intake ? intakeEnergy(intake, energyUnit) : null;
  if (intake) {
    columns.push({ id: 'intake', header: 'Intake', unit: energyUnit, decimals: 0 });
    columns.push({ id: 'maintenance', header: 'Maintenance', unit: energyUnit, decimals: 0 });
  }
  for (const s of series) columns.push({ id: s.id, header: s.label, unit: s.unit, decimals: s.format.decimals });
  const n = time.days * SAMPLES_PER_DAY[res];
  const [i0, i1] = visibleIndexRange(x0, x1, res, n, 0);
  const rows: TableRow[] = [];
  for (let i = i0; i <= i1; i++) {
    const t = sampleT(i, res);
    const cells: TableCell[] = [];
    if (energy) {
      const d = Math.min(time.days - 1, Math.floor(t));
      const tot = energy.total[d] ?? NaN;
      const mt = energy.maintenance[d] ?? NaN;
      cells.push({ v: tot, lo: NaN, hi: NaN, text: formatNumber(tot, 0) });
      cells.push({ v: mt, lo: NaN, hi: NaN, text: formatNumber(mt, 0) });
    }
    for (const s of series) {
      const cv = valueAt(s, t, res);
      const d = s.format.decimals;
      const range = Number.isFinite(cv.lo) && Number.isFinite(cv.hi) ? ` (${formatRange(cv.lo, cv.hi, d)})` : '';
      cells.push({ v: cv.v, lo: cv.lo, hi: cv.hi, text: formatNumber(cv.v, d) + range });
    }
    rows.push({ t, label: describeSample(time, t, res), cells });
  }
  return { res, columns, rows };
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const plain = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '');

/** CSV with value / low / high columns per metric; plain ASCII numbers. */
export function tableToCSV(model: TableModel): string {
  const head = ['time'];
  for (const c of model.columns) {
    const u = unitSuffix(c.unit);
    const name = u ? `${c.header} (${u})` : c.header;
    head.push(name);
    if (c.id !== 'intake' && c.id !== 'maintenance') head.push(`${c.header} likely low`, `${c.header} likely high`);
  }
  const lines = [head.map(csvEscape).join(',')];
  for (const r of model.rows) {
    const cells = [r.label];
    model.columns.forEach((c, k) => {
      const cell = r.cells[k]!;
      cells.push(plain(cell.v, c.decimals));
      if (c.id !== 'intake' && c.id !== 'maintenance') cells.push(plain(cell.lo, c.decimals), plain(cell.hi, c.decimals));
    });
    lines.push(cells.map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

