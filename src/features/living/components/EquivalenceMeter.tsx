/**
 * <EquivalenceMeter> (COMPONENTS §13.13): how close a swap or a logged session comes to the prescribed stimulus. A
 * printed 0–100 scale with ticks and numerals at 0, 60, 90 and 100 (the partial and full-credit thresholds of the
 * catalogue's equivalence), an ink tick at the score, the percentage and the verdict in words. Achromatic; the detail
 * disclosure lists the per-term ratios with their intent weights and "also trained". Used by Train (swaps, logs) and
 * the Coach.
 *
 * The meter renders `EquivalenceResult` as computed by the catalogue (`sessionEquivalence` / `swapOptions`); the only
 * logic here is choosing words for the score bands the catalogue defines.
 */
import { useId } from 'react';
import { REGION_LABEL, catalogueParam, type EquivalenceResult, type StimulusTermId } from '@/catalogues';
import { cx } from '@/components';

/** User-facing words of the meter (plain, second person, no internal references). */
export const EQUIVALENCE_COPY = {
  label: 'same stimulus',
  counts: (target: string) => `counts as ${target}`,
  partly: (fix: string) => `partly — ${fix}`,
  addSet: 'add 1 set',
  different: (credited: string) => `different work — credited to ${credited}`,
  otherWork: 'other work',
  detail: 'how it compares',
  term: (label: string, pct: number, weight: number) => `${label} ${pct} % · weighs ${weight} %`,
  also: (regions: string) => `also trained: ${regions}`,
  valueText: (pct: number, verdict: string) => `${pct} %, ${verdict}`,
  terms: { hyp: 'muscle', str: 'strength', card: 'cardio', kcal: 'energy', mob: 'mobility' } as Readonly<Record<StimulusTermId, string>>,
} as const;

/** Full credit at or above (0.90) and the partial band's floor (0.60), from the catalogue's parameters. */
export const FULL_CREDIT_AT = catalogueParam('creditFull');
export const PARTIAL_CREDIT_AT = catalogueParam('creditPartial');

export type VerdictBand = 'full' | 'partial' | 'different';

export function verdictBand(score: number): VerdictBand {
  return score >= FULL_CREDIT_AT - 1e-9 ? 'full' : score >= PARTIAL_CREDIT_AT - 1e-9 ? 'partial' : 'different';
}

/** Score as a whole percentage. */
export function pctOf(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  const w = words.filter((x) => x.length > 0);
  if (w.length <= 1) return w[0] ?? '';
  return `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

function lowerFirst(s: string): string {
  return s.length > 1 && /[a-z]/.test(s[1]!) ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s;
}

/** The catalogue's first shortfall fix as a clause ("chest work is short: add 1 set"), else "add 1 set". */
export function shortfallFix(r: Pick<EquivalenceResult, 'shortfall'>): string {
  const t = r.shortfall[0]?.text?.trim();
  return t ? lowerFirst(t.replace(/\.$/, '')) : EQUIVALENCE_COPY.addSet;
}

/** What different work was credited to: the regions it trained beyond the prescription, else its strongest term. */
export function creditedTo(r: Pick<EquivalenceResult, 'alsoTrained' | 'perTerm'>): string {
  if (r.alsoTrained.length > 0) return listWords(r.alsoTrained.map((x) => REGION_LABEL[x]));
  const best = [...r.perTerm].filter((t) => t.ratio > 0).sort((a, b) => b.ratio - a.ratio || b.weight - a.weight)[0];
  return best ? EQUIVALENCE_COPY.terms[best.term] : EQUIVALENCE_COPY.otherWork;
}

/** The verdict words for a result against a target ("today’s swing"). */
export function equivalenceVerdict(r: EquivalenceResult, target: string): string {
  const band = verdictBand(r.score);
  if (band === 'full') return EQUIVALENCE_COPY.counts(target);
  if (band === 'partial') return EQUIVALENCE_COPY.partly(shortfallFix(r));
  return EQUIVALENCE_COPY.different(creditedTo(r));
}

export interface EquivalenceMeterProps {
  result: EquivalenceResult;
  /** What it is compared with, e.g. "today’s swing" or "Wednesday’s lift". */
  target: string;
  /** `sm` 120 px scale (swap lists) · `md` 180 px (default). */
  size?: 'sm' | 'md';
  /** Show the per-term disclosure. */
  detail?: boolean;
  className?: string;
}

const PAD_L = 4;
const PAD_R = 22;
const H = 28;

export function EquivalenceMeter({ result, target, size = 'md', detail = false, className }: EquivalenceMeterProps) {
  const id = useId();
  const pct = pctOf(result.score);
  const band = verdictBand(result.score);
  const verdict = equivalenceVerdict(result, target);
  const W = size === 'sm' ? 120 : 180;
  const x = (v: number) => PAD_L + (Math.max(0, Math.min(100, v)) / 100) * W;
  const partial = Math.round(PARTIAL_CREDIT_AT * 100);
  const full = Math.round(FULL_CREDIT_AT * 100);
  const majors = [0, partial, full, 100];
  const minors = Array.from({ length: 11 }, (_, i) => i * 10).filter((v) => !majors.includes(v));
  const weightSum = result.perTerm.reduce((a, t) => a + t.weight, 0) || 1;
  return (
    <div className={cx('grid gap-1 min-w-0', className)} data-band={band} data-size={size}>
      <div
        role="meter"
        aria-label={EQUIVALENCE_COPY.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={EQUIVALENCE_COPY.valueText(pct, verdict)}
        aria-describedby={`${id}-verdict`}
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
      >
        <span className="lm-eng" aria-hidden="true">
          {EQUIVALENCE_COPY.label}
        </span>
        <span className="lm-num" aria-hidden="true" style={{ minWidth: '4.5ch' }}>
          {pct} %
        </span>
        <svg width={PAD_L + W + PAD_R} height={H} viewBox={`0 0 ${PAD_L + W + PAD_R} ${H}`} aria-hidden="true" style={{ overflow: 'visible', flex: 'none' }}>
          <line x1={x(0)} x2={x(100)} y1={8.5} y2={8.5} stroke="var(--lm-line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
          {minors.map((v) => (
            <line key={`m${v}`} data-tick={v} x1={Math.round(x(v)) + 0.5} x2={Math.round(x(v)) + 0.5} y1={8} y2={11} stroke="var(--lm-line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
          ))}
          {majors.map((v) => (
            <line key={`M${v}`} data-tick={v} data-major="true" x1={Math.round(x(v)) + 0.5} x2={Math.round(x(v)) + 0.5} y1={3} y2={13} stroke="var(--lm-edge)" strokeWidth={1} shapeRendering="crispEdges" />
          ))}
          {majors.map((v) => {
            // 0 sits right of its tick, 60 is centred, 90 sits left of its tick and 100 right of its own, so the two
            // close numerals never overprint at either size.
            const anchor = v === 0 || v === 100 ? 'start' : v === full ? 'end' : 'middle';
            const dx = v === 100 ? 2 : v === full ? 1 : v === 0 ? -1 : 0;
            return (
              <text
                key={`n${v}`}
                data-numeral={v}
                x={x(v) + dx}
                y={H - 2}
                textAnchor={anchor}
                fontSize={11}
                fill="var(--lm-ink-2)"
                className="wdth-condensed"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {v}
              </text>
            );
          })}
          <rect data-score={pct} x={x(pct) - 1} y={0} width={2} height={16} fill="var(--lm-ink)" />
        </svg>
      </div>
      <p id={`${id}-verdict`} className="text-sm" style={{ color: 'var(--lm-ink)' }}>
        {verdict}
      </p>
      {detail ? (
        <details className="text-sm" style={{ color: 'var(--lm-ink-2)' }}>
          <summary className="lm-eng" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            {EQUIVALENCE_COPY.detail}
          </summary>
          <ul className="grid gap-1" style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {result.perTerm.map((t) => {
              const label = EQUIVALENCE_COPY.terms[t.term];
              const r = pctOf(t.ratio);
              const w = Math.round((t.weight / weightSum) * 100);
              return (
                <li key={t.term} className="flex items-center gap-2">
                  <svg width={64} height={8} viewBox="0 0 64 8" aria-hidden="true" style={{ flex: 'none' }}>
                    <rect x={0} y={3.5} width={64} height={1} fill="var(--lm-line-strong)" />
                    <rect x={0} y={2} width={Math.max(1, (r / 100) * 64)} height={4} fill="var(--lm-ink)" />
                  </svg>
                  <span>{EQUIVALENCE_COPY.term(label, r, w)}</span>
                </li>
              );
            })}
          </ul>
          {result.alsoTrained.length > 0 ? <p style={{ marginTop: 4 }}>{EQUIVALENCE_COPY.also(listWords(result.alsoTrained.map((r) => REGION_LABEL[r])))}</p> : null}
        </details>
      ) : null}
    </div>
  );
}
