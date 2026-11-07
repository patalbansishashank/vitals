/**
 * <EquivalenceMeter> (COMPONENTS §13.13): how close a swap or a logged session comes to the prescribed stimulus. The
 * shared tick strip in its `meter` variant (DATAVIZ P2, energy SPEC A.3.3): a 0–100 strip with numerals at 0, 60, 90 and
 * 100 (the partial and full-credit thresholds of the catalogue's equivalence), the full-credit tick, an ivory tick at the
 * score, the percentage and the verdict in words. The `role="meter"` text pattern is the strip's. The detail
 * disclosure lists the per-term ratios with their intent weights and "also trained". Used by Train (swaps, logs) and
 * the Coach.
 *
 * The meter renders `EquivalenceResult` as computed by the catalogue (`sessionEquivalence` / `swapOptions`); the only
 * logic here is choosing words for the score bands the catalogue defines.
 *
 * Quiet mode (SPEC A.3.2, DATAVIZ §0.6): words only. No percentage, no numerals on the scale, no digits in the verdict
 * and the detail lists each term as a word. The meter reads quiet mode from settings; a screen that lets the person
 * reveal numbers for a while (Train's "Show numbers") wraps it in `<EquivalenceQuietProvider quiet={false}>`.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { REGION_LABEL, catalogueParam, type EquivalenceResult, type StimulusTermId } from '@/catalogues';
import { DottedTrack, HeroNumber, InfoKey, InfoPanel, MonoMeta, RangeScale, cx } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { quietWord } from '../format';
import { infoSpec } from './info';
import './equivalenceMeter.css';

/** User-facing words of the meter (plain, second person, no internal references). */
export const EQUIVALENCE_COPY = {
  label: 'same stimulus',
  fullCredit: 'Full credit',
  counts: (target: string) => `counts as ${target}`,
  partly: (fix: string) => `partly — ${fix}`,
  addSet: 'add 1 set',
  different: (credited: string) => `different work — credited to ${credited}`,
  otherWork: 'other work',
  detail: 'how it compares',
  term: (label: string, pct: number, weight: number) => `${label} ${pct} % · weighs ${weight} %`,
  quietTerm: (label: string, word: string) => `${label}: ${word}`,
  also: (regions: string) => `also trained: ${regions}`,
  valueText: (pct: number, verdict: string) => `${pct} %, ${verdict}`,
  terms: { hyp: 'muscle', str: 'strength', card: 'cardio', kcal: 'energy', mob: 'mobility' } as Readonly<
    Record<StimulusTermId, string>
  >,
} as const;

/** Full credit at or above (0.90) and the partial band's floor (0.60), from the catalogue's parameters. */
export const FULL_CREDIT_AT = catalogueParam('creditFull');
export const PARTIAL_CREDIT_AT = catalogueParam('creditPartial');

/** Words for the partial-credit fix without a digit: "add 1 set" reads "add a set". */
const QUIET_ADD_SET = 'add a set';

/** What a screen says about quiet mode for the meters below it; null (no provider) means settings decide. */
const QuietContext = createContext<boolean | null>(null);

/** A screen that has its own quiet state (quiet mode with a temporary "show numbers") passes the effective value down. */
export function EquivalenceQuietProvider({ quiet, children }: { quiet: boolean; children: ReactNode }) {
  return <QuietContext.Provider value={quiet}>{children}</QuietContext.Provider>;
}

export type VerdictBand = 'full' | 'partial' | 'different';

export function verdictBand(score: number): VerdictBand {
  return score >= FULL_CREDIT_AT - 1e-9
    ? 'full'
    : score >= PARTIAL_CREDIT_AT - 1e-9
      ? 'partial'
      : 'different';
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

/** The shortfall fix with no digit in it (quiet mode): "1 set" becomes "a set"; any other number falls back to "add a set". */
export function quietFix(r: Pick<EquivalenceResult, 'shortfall'>): string {
  const fix = shortfallFix(r).replace(/\b1 sets?\b/gi, 'a set');
  return /\d/.test(fix) ? QUIET_ADD_SET : fix;
}

/** What different work was credited to: the regions it trained beyond the prescription, else its strongest term. */
export function creditedTo(r: Pick<EquivalenceResult, 'alsoTrained' | 'perTerm'>): string {
  if (r.alsoTrained.length > 0) return listWords(r.alsoTrained.map((x) => REGION_LABEL[x]));
  const best = [...r.perTerm]
    .filter((t) => t.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio || b.weight - a.weight)[0];
  return best ? EQUIVALENCE_COPY.terms[best.term] : EQUIVALENCE_COPY.otherWork;
}

/** The verdict words for a result against a target ("today’s swing"). */
export function equivalenceVerdict(r: EquivalenceResult, target: string, quiet = false): string {
  const band = verdictBand(r.score);
  if (band === 'full') return EQUIVALENCE_COPY.counts(target);
  if (band === 'partial') return EQUIVALENCE_COPY.partly(quiet ? quietFix(r) : shortfallFix(r));
  return EQUIVALENCE_COPY.different(creditedTo(r));
}

export interface EquivalenceMeterProps {
  result: EquivalenceResult;
  /** What it is compared with, e.g. "today’s swing" or "Wednesday’s lift". */
  target: string;
  /**
   * `sm` 120 px scale · `md` 180 px (default) · `line`: one thin full-width bar with the full-credit mark and the share in
   * words beside it, for a list of options whose threshold is said once above it (r068 T9).
   */
  size?: 'sm' | 'md' | 'line';
  /** Show the per-term disclosure. */
  detail?: boolean;
  className?: string;
}

const MATCH_INFO = infoSpec({
  title: 'Same stimulus',
  body: 'Swapping an exercise keeps your plan honest. Vitals compares the work you did with the work prescribed: muscle, strength, cardio, energy and mobility. At 90 % or more it counts in full; 60 to 89 % counts partly and says what is short; below that it counts as different work and is credited to what it trained.',
  evidence: 'training-catalogue',
});

/** One scale for every swap and session: the catalogue thresholds are named, never implied by a colour. */
export function StimulusMatch({
  score,
  verdict,
  quiet = false,
  size = 'md',
}: {
  score: number;
  verdict: string;
  quiet?: boolean;
  size?: 'sm' | 'md' | 'line';
}) {
  const pct = pctOf(score);
  const partial = Math.round(PARTIAL_CREDIT_AT * 100);
  const full = Math.round(FULL_CREDIT_AT * 100);
  return (
    <div
      className="lv-match"
      data-size={size}
      role="meter"
      aria-label={EQUIVALENCE_COPY.label}
      aria-valuemin={quiet ? undefined : 0}
      aria-valuemax={quiet ? undefined : 100}
      aria-valuenow={quiet ? undefined : pct}
      aria-valuetext={quiet ? verdict : EQUIVALENCE_COPY.valueText(pct, verdict)}
    >
      <div aria-hidden="true">
        <RangeScale
          label={EQUIVALENCE_COPY.label}
          value={pct}
          min={0}
          max={100}
          hue="steps"
          quiet={quiet}
          usual={[full, 100]}
          size={size === 'sm' ? 'inline' : 'full'}
          ticks="bands"
          bands={[
            { from: 0, word: 'Different work', severity: 'info' },
            { from: partial, word: 'Partly', severity: 'info' },
            { from: full, word: 'Full credit', severity: 'ok' },
          ]}
        />
      </div>
      {size === 'md' && !quiet ? (
        <div className="lv-match__knots">
          <MonoMeta>Partly {partial} %</MonoMeta>
          <MonoMeta>Full {full} %</MonoMeta>
        </div>
      ) : null}
    </div>
  );
}

export function EquivalenceMeter({
  result,
  target,
  size = 'md',
  detail = false,
  className,
}: EquivalenceMeterProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const fromScreen = useContext(QuietContext);
  const settingsQuiet = useQuietMode().on;
  const quiet = fromScreen ?? settingsQuiet;
  const pct = pctOf(result.score);
  const band = verdictBand(result.score);
  const verdict = equivalenceVerdict(result, target, quiet);
  const weightSum = result.perTerm.reduce((a, t) => a + t.weight, 0) || 1;
  return (
    <div
      className={cx('lv-eqm lv-eqm--scale', className)}
      data-band={band}
      data-size={size}
      data-quiet={quiet || undefined}
    >
      {size === 'md' ? (
        <div className="lv-eqm__heading">
          <MonoMeta>{EQUIVALENCE_COPY.label}</MonoMeta>
          <InfoKey label="About Same stimulus" onClick={() => setInfoOpen(true)} />
        </div>
      ) : null}
      <div className="lv-eqm__reading">
        {!quiet ? (
          size === 'md' ? (
            <HeroNumber value={pct} unit="%" size="num" label={`${pct} %`} />
          ) : (
            <MonoMeta>{pct} %</MonoMeta>
          )
        ) : null}
        <StimulusMatch score={result.score} verdict={verdict} quiet={quiet} size={size} />
      </div>
      <p className="lv-eqm__verdict">{verdict}</p>
      {detail ? (
        <details className="text-sm" style={{ color: 'var(--lm-ink-2)' }}>
          <summary
            className="lm-meta"
            style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}
          >
            {EQUIVALENCE_COPY.detail}
          </summary>
          <ul className="grid gap-1" style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {result.perTerm.map((t) => {
              const label = EQUIVALENCE_COPY.terms[t.term];
              const r = pctOf(t.ratio);
              const w = Math.round((t.weight / weightSum) * 100);
              return (
                <li key={t.term} className="lv-eqm__term">
                  <MonoMeta>
                    {quiet
                      ? EQUIVALENCE_COPY.quietTerm(label, quietWord(r))
                      : EQUIVALENCE_COPY.term(label, r, w)}
                  </MonoMeta>
                  <DottedTrack
                    label={label}
                    value={r}
                    goal={100}
                    valueText={`${r} %`}
                    quiet={quiet}
                    quietWord={quietWord(r)}
                    hue="steps"
                  />
                </li>
              );
            })}
          </ul>
          {result.alsoTrained.length > 0 ? (
            <p style={{ marginTop: 4 }}>
              {EQUIVALENCE_COPY.also(listWords(result.alsoTrained.map((r) => REGION_LABEL[r])))}
            </p>
          ) : null}
        </details>
      ) : null}
      {infoOpen ? (
        <InfoPanel
          {...MATCH_INFO}
          body={
            quiet
              ? 'Vitals compares the work you did with the work prescribed: muscle, strength, cardio, energy and mobility. A close match counts in full; a partial match says what is short. Different work is credited to what it trained.'
              : MATCH_INFO.body
          }
          open
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </div>
  );
}
