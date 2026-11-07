/**
 * Copy for the shared living components (r071): the (i) texts that belong to no one page. A page's own (i) lives in its
 * feature's `copy.ts` (`INFO`); these are what a source chip and the shared sheets say wherever they appear.
 */
import type { InfoEntry } from './info';

export const SHARED_INFO = {
  /** The source chip on a logged value: what each source means (it replaces a hover-only tooltip a phone could not read). */
  source: {
    title: 'Where this number comes from',
    body: 'Typed: exactly what you entered. As planned: the plan’s own numbers. From the food table: exact for the portion. Coach text or photo: an estimate, shown with a likely range. Ring or phone: measured by the device. Assumed: filled in as planned because nothing was logged.',
  },
} satisfies Record<string, InfoEntry>;
