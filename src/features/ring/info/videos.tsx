/** The (i) of the Short videos card and page (r071, AUDIT cards 5 and 16, SPEC Q13): what is counted, said neutrally. */
import type { ReactNode } from 'react';
import type { InfoSpec } from '@/components';

export function shortVideosInfo(o: { footer?: ReactNode }): InfoSpec {
  return {
    title: 'Short videos',
    body: 'Your phone counts the short videos you watch on Instagram Reels and YouTube Shorts on your phone, and sets the day against the limit you chose. The words say where the count sits against it, nothing more. The count comes from your phone, not the ring.',
    source: { kind: 'phone', words: 'Counted on your phone; a day is sent once something was counted on it.' },
    terms: [{ term: 'A day with no count', text: 'The phone sends a day only once it has counted something on it, so a missing day was not sent. It does not mean nothing was watched.' }],
    footer: o.footer,
  };
}
