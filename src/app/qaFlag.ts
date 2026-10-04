/**
 * QA hook opt-in (plan 02 item 12, Q3). Imported first by main.tsx so it reads `?qa=1` before the router redirects
 * (e.g. `/` → `/welcome`) and drops the query; the flag is kept for the tab in sessionStorage.
 */
const QA_KEY = 'vitals.qa';

/** True when this tab asked for the hook (`?qa=1` now or earlier in the tab). */
export function qaRequested(search: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  const asked = new URLSearchParams(search).get('qa') === '1';
  try {
    if (asked) storage?.setItem(QA_KEY, '1');
    return asked || storage?.getItem(QA_KEY) === '1';
  } catch {
    return asked;
  }
}

function tabStorage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export const qaEnabled = typeof location !== 'undefined' && qaRequested(location.search, tabStorage());
