/* ==========================================================================
   The Table twin of the r071 pictures (AUDIT §5.2, house rule: every chart keeps a twin).

   Each new picture exports a pure `<picture>Twin(props): TwinData` next to its component: the rows of the table that
   say what the picture says. A page puts `<ChartTwin data={…} />` into its card's (i) panel (`InfoSpec.twin`, which
   the `T` key opens), or turns on the picture's own `twin` prop, which draws `<InlineTwin />` under the picture
   (a "Table" key and the table), the way Hypnogram and StateStrip always did. The markup is the one of `TwinTable`
   (pinned equal to charts/living by the contract test).
   ========================================================================== */
import { useId, useState } from 'react';
import { TwinKey, TwinTable, toCSV } from './TwinTable';

export interface TwinData {
  /** Accessible name of the scroll region: "Steps, last seven days, table". */
  title: string;
  /** The picture's spoken sentence, as the table caption. */
  caption: string;
  /** Column headings; the first column is the row header. */
  head: string[];
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
  /** "vitals-steps.csv" */
  fileName: string;
  /** Singular and plural of a row (default day / days). */
  rowNoun?: [string, string];
}

/** The CSV of a twin: the head row, then every row. */
export const twinCsv = (d: Pick<TwinData, 'head' | 'rows'>): string => toCSV([d.head, ...d.rows]);

/** A twin's file name from a picture label: "Steps, last 7 days" → "vitals-steps-last-7-days.csv". */
export const twinFileName = (label: string): string => `vitals-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;

/** The table, with its row count, CSV key and scroll region. */
export function ChartTwin({ data, id }: { data: TwinData; id?: string }) {
  const own = useId();
  return (
    <TwinTable id={id ?? `${own}-twin`} title={data.title} caption={data.caption} rows={data.rows.length} rowNoun={data.rowNoun} fileName={data.fileName} csv={() => twinCsv(data)}>
      <thead>
        <tr>
          {data.head.map((h, i) => (
            <th key={i} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </TwinTable>
  );
}

/** A "Table" key that shows and hides the twin under a picture: the picture's own `twin` prop draws this. */
export function InlineTwin({ data }: { data: TwinData }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="lmz-twin">
      <TwinKey open={open} onToggle={() => setOpen((o) => !o)} controls={`${id}-twin`} />
      {open ? <ChartTwin data={data} id={`${id}-twin`} /> : null}
    </div>
  );
}
