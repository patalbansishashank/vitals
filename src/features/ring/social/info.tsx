/**
 * (social-time) The (i) of the Social time card and page. No helper subtext lives on the card; the explanation is all
 * here: what is counted, the target band, where it comes from, and the per-app split for the day. Quiet, never shaming.
 * In quiet mode the panel carries no numbers (words only), like the rest of quiet mode.
 */
import type { ReactNode } from 'react';
import type { InfoSpec } from '@/components';
import { SOCIAL_APPS } from '@/net/gaugeSocial';
import type { SocialAppRow } from './socialModel';

const APP_NAMES = SOCIAL_APPS.map((a) => a.label);
/** "Instagram, YouTube, Facebook, Snapchat, X, Reddit and TikTok". */
const appList = `${APP_NAMES.slice(0, -1).join(', ')} and ${APP_NAMES.at(-1)}`;

export function socialInfo(o: { footer?: ReactNode; rows?: SocialAppRow[]; min?: number; max?: number; quiet?: boolean }): InfoSpec {
  const min = o.min ?? 30;
  const max = o.max ?? 45;
  const quiet = o.quiet === true;
  const rows = o.rows ?? [];
  const body: Array<{ heading?: string; body: ReactNode }> = [
    {
      body: quiet
        ? `Your phone adds up the time you spend in ${appList} today, from Android's Usage access. It is whole-app time, not time in reels or shorts. The words say where today sits against your daily target.`
        : `Your phone adds up the time you spend in ${appList} today, from Android's Usage access. It is whole-app time, not time in reels or shorts. Your daily target is ${min} to ${max} minutes: the words say where today sits against it.`,
    },
  ];
  if (rows.length) {
    body.push({
      heading: 'By app',
      body: (
        <ul className="lm-infopanel__small" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{r.label}</span>
              {quiet ? null : <span>{r.valueText}</span>}
            </li>
          ))}
        </ul>
      ),
    });
  }
  return {
    title: 'Social time',
    body,
    source: { kind: 'phone', words: 'Measured on your phone through Usage access; a day is sent once there is time to send.' },
    range: quiet ? undefined : `Daily target ${min}–${max} minutes.`,
    terms: [
      { term: 'Whole-app time', text: 'Usage access gives time in the whole app, so it is time in Instagram, not time in Reels. Per-reel precision is not available this way.' },
      { term: 'A day with no time', text: 'A missing day was not sent, which does not mean the apps were untouched.' },
    ],
    footer: o.footer,
  };
}
