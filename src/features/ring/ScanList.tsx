/**
 * The pairing scan list (design/screens/ring-pages.md §5.5 step 2): one 56 px row per ring a driver recognises:
 * ring mark, driver label + "· ending 4F2A", a signal word with a 3-step meter (or "yours" for a ring the person
 * already has), chevron. The whole row is the button. Never an advertised name, never unrelated devices.
 */
import { ChevronRight } from 'lucide-react';
import { Icon } from '@/components/icons/Icon';
import type { RingCandidate } from './data';
import { RING_PAGE_COPY } from './copy';
import { RingGlyph } from './RingKey';

const P = RING_PAGE_COPY.pairing;

export type SignalWord = 'near' | 'close' | 'far';

/** near ≥ −65 dBm, close −65…−80, far below −80; null when the scan gave no strength. */
export function signalOf(rssi: number | undefined): SignalWord | null {
  if (rssi === undefined || !Number.isFinite(rssi)) return null;
  if (rssi >= -65) return 'near';
  if (rssi >= -80) return 'close';
  return 'far';
}

const BARS: Record<SignalWord, number> = { near: 3, close: 2, far: 1 };

/** Known rings first, then the strongest signal (a missing strength sorts last). */
export function sortCandidates(rows: readonly RingCandidate[]): RingCandidate[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.known) - Number(a.r.known) || (b.r.rssi ?? -999) - (a.r.rssi ?? -999) || a.i - b.i)
    .map((x) => x.r);
}

export interface ScanListProps {
  rows: readonly RingCandidate[];
  onPick: (c: RingCandidate) => void;
}

export function ScanList({ rows, onPick }: ScanListProps) {
  if (!rows.length) return null;
  return (
    <ul className="rg-scan" aria-label={P.listLabel}>
      {rows.map((c) => {
        const sig = signalOf(c.rssi);
        return (
          <li key={c.candidateId}>
            <button type="button" className="rg-scan__row" onClick={() => onPick(c)}>
              <Icon icon={RingGlyph} size={20} className="rg-scan__glyph" />
              <span className="rg-scan__label">{P.candidate(c.label, c.idTail)}</span>
              {c.known ? (
                <span className="rg-scan__signal">{P.yours}</span>
              ) : sig ? (
                <span className="rg-scan__signal">
                  <span className="rg-scan__word">{P.signal[sig]}</span>
                  <span className="rg-meter" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="rg-meter__bar" data-on={i < BARS[sig] || undefined} />
                    ))}
                  </span>
                </span>
              ) : null}
              <Icon icon={ChevronRight} size={16} className="rg-scan__chev" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
