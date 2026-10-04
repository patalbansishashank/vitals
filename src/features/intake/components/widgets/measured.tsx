/** M1a (design v3 §4.3): the measured figure, its unit, how it was measured and when — committed together with Save. */
import { useId, useState } from 'react';
import { InlineWarning, Key, KeyBank, NumberField, Select, formatNumber } from '@/components';
import { KJ_PER_KCAL, MEASURED_KCAL_RANGE, MEASURED_METHODS, type MeasuredValue } from '../../chapters/activity';
import { A } from '../../copy';
import type { MeasuredMethod } from '../../types';
import type { WidgetProps } from '../widgetTypes';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Out of the accepted day range (800–6 000 kcal; 3 350–25 100 kJ). */
export function measuredOutOfRange(value: number, unit: 'kcal' | 'kJ'): boolean {
  const kcal = unit === 'kJ' ? value / KJ_PER_KCAL : value;
  return kcal < MEASURED_KCAL_RANGE[0] || kcal > MEASURED_KCAL_RANGE[1];
}

export function MeasuredWidget({ value, onCommit, labelledBy }: WidgetProps<MeasuredValue>) {
  const id = useId();
  const now = new Date();
  const [figure, setFigure] = useState<number | null>(value?.value ?? null);
  const [unit, setUnit] = useState<'kcal' | 'kJ'>(value?.unit ?? 'kcal');
  const [method, setMethod] = useState<MeasuredMethod | undefined>(value?.method);
  const [month, setMonth] = useState<string | undefined>(value?.date?.slice(5, 7));
  const [year, setYear] = useState<string | undefined>(value?.date?.slice(0, 4));
  const years = Array.from({ length: 31 }, (_, i) => String(now.getFullYear() - i));
  const date = month && year ? `${year}-${month}` : undefined;
  const future = date ? date > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` : false;
  const outOfRange = figure !== null && measuredOutOfRange(figure, unit);
  const reason = figure === null ? A.measured.needValue : outOfRange ? A.measured.outOfRange(formatNumber(figure, 0), unit) : !method ? A.measured.needMethod : future ? A.measured.future : undefined;
  return (
    <div className="lm-ik-row lm-ik-measured">
      <div className="lm-ik-inline">
        <span className="lm-ik-row__label" id={`${id}-fig`}>
          {A.measured.figure}
        </span>
        <NumberField name={A.measured.figureName} value={figure} onChange={setFigure} min={0} max={40000} step={10} decimals={0} unit={unit === 'kJ' ? 'kJ/day' : 'kcal/day'} inputMode="numeric" />
        <KeyBank<'kcal' | 'kJ'> label={A.measured.unitLabel} size="lg" value={unit} onChange={setUnit} options={(['kcal', 'kJ'] as const).map((u) => ({ value: u, label: A.measured.units[u] }))} />
      </div>
      {outOfRange ? <InlineWarning severity="caution">{A.measured.outOfRange(formatNumber(figure ?? 0, 0), unit)}</InlineWarning> : null}
      <span className="lm-ik-row__label" id={`${id}-how`}>
        {A.measured.how}
      </span>
      <KeyBank<MeasuredMethod>
        labelledBy={`${labelledBy} ${id}-how`}
        size="lg"
        orientation="vertical"
        block
        value={method}
        onChange={setMethod}
        options={MEASURED_METHODS.map((m) => ({ value: m, label: A.measured.methods[m] }))}
      />
      <span className="lm-ik-row__label" id={`${id}-when`}>
        {A.measured.when}
      </span>
      <div className="lm-ik-inline">
        <Select label={A.measured.month} value={month} onChange={setMonth} placeholder={A.measured.month} options={MONTH_NAMES.map((n, i) => ({ value: String(i + 1).padStart(2, '0'), label: n }))} />
        <Select label={A.measured.year} value={year} onChange={setYear} placeholder={A.measured.year} options={years.map((y) => ({ value: y, label: y }))} />
      </div>
      {future ? <InlineWarning severity="danger">{A.measured.future}</InlineWarning> : null}
      <div className="lm-ik-done">
        <Key
          onClick={() => figure !== null && method && onCommit({ value: figure, unit, method, ...(date ? { date } : {}) })}
          disabledReason={reason}
          data-ik-done="true"
        >
          {A.measured.save}
        </Key>
      </div>
    </div>
  );
}
