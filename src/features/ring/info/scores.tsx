/**
 * The (i) texts of the score cards (r071, AUDIT cards 1 and 10): what the Day score is made of, how to read it, and, on
 * Scores, the weights of every part. In quiet mode the text carries no digit and the band table is left out.
 */
import type { ReactNode } from 'react';
import type { InfoSpec } from '@/components';
import { formatNumber } from '@/components';

/** The Day score's (i): three parts, equal thirds, two of three needed; Scores adds the part weights. */
export function dayScoreInfo(o: {
  quiet: boolean;
  weights: boolean;
  share: number | null;
  legacy: boolean;
  footer?: ReactNode;
}): InfoSpec {
  const sleep =
    !o.quiet && o.share !== null ? ` Sleep carries about ${formatNumber(o.share * 100, 0)} % of it.` : '';
  return {
    title: 'How the Day score works',
    body: `Your Day score averages three parts, recovery, activity and sleep, worked out from your ring and phone. A part with no data drops out and the others share its weight; two of the three are needed.${sleep} It is an experimental index, not a measurement.`,
    source: {
      kind: 'ring',
      words: o.legacy
        ? "On-device scores, until the server sends the nights Vitals needs."
        : 'Worked out in Vitals from your ring and phone, with a named method for each part.',
    },
    range: o.quiet ? undefined : 'Excellent 85 and up · Good 70 to 84 · Fair 55 to 69 · Needs work under 55',
    terms:
      o.weights && !o.quiet
        ? [
            {
              term: 'Recovery',
              text: "HRV 25, sleeping low heart rate 15, the sleep index 30, yesterday's load 10 (of 80, then shared out over the parts that exist).",
            },
            { term: 'Sleep', text: 'Time asleep 50, window continuity 25, midpoint against your usual 25.' },
            { term: 'Activity', text: 'Steps 40, Heart Points pace 35, planned sessions 25.' },
          ]
        : undefined,
    footer: o.footer,
  };
}

/** A named source and the method behind one score, shared by its day and period cards. */
export function scoreInfo(o: {
  id: 'recovery' | 'sleep' | 'activity';
  source: string;
  quiet: boolean;
  period: boolean;
}): InfoSpec {
  const method = {
    recovery: 'Recovery weighs HRV, sleeping heart rate, sleep and yesterday’s training load.',
    sleep: 'Sleep weighs time asleep, window continuity and the midpoint against your usual night.',
    activity: 'Activity weighs steps, Heart Points pace and planned sessions.',
  }[o.id];
  return {
    body: o.source.startsWith('On-device')
      ? 'The phone works out this score with its own method. Vitals uses it as a legacy fallback until the server can supply the inputs for Vitals’ indices. Compare it with its own history; the two methods can give different numbers.'
      : `${o.source} works out this index from your ring and phone. ${method} Missing inputs drop out and the remaining weights are shared out. ${o.period ? 'The number is the average for the dates shown; the contributor list describes the latest day.' : 'The line shows the recent history; a missing day stays a gap.'}`,
    source: {
      kind: o.source.startsWith('On-device') ? 'phone' : 'engine',
      words: `${o.source}. Compare this score with its own history.`,
    },
    range: o.quiet
      ? undefined
      : '0 to 100 · Excellent 85 and up · Good 70 to 84 · Fair 55 to 69 · Needs work under 55',
  };
}
