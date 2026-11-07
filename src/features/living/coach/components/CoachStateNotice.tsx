/**
 * Where the provider's state shows (SPEC §4 "Notices", living-mode.md, Coach states). Nothing is injected into the page:
 *   - sending can't work until the person fixes Settings (key refused, out of credit, no answer) → the shell's one banner
 *     under the header, with one key to the AI provider settings, while the Coach is on screen;
 *   - the connection is down or busy (offline, rate limited) → a status icon in the header (its words in its name);
 *   - the model can't do everything (no tools, basic, safety mode) → one fact line at the start of the conversation.
 * "No provider" is none of these: it is the page's own empty state.
 */
import { useEffect, useMemo, useState } from 'react';
import { Hourglass, WifiOff } from 'lucide-react';
import { KeyLink, StatusCapsule } from '@/components';
import { GlobalNotice } from '@/app/shell';
import type { CoachStatus } from '../adapter';
import { COACH_COPY as T } from '../copy';

/** Statuses where sending can't work until the person fixes something in Settings: what failed, in plain words. */
export function blockedReason(status: CoachStatus): string | undefined {
  // the Coach on the paired server can't answer: its reason is the conversation's one fact line, not a Settings banner
  if (status.kind === 'serverUnavailable') return status.problem;
  const provider = status.provider ?? 'your provider';
  if (status.kind === 'keyRefused') return T.keyRefused(provider);
  if (status.kind === 'outOfCredit') return T.outOfCredit;
  if (status.kind === 'cors') return T.cors(provider);
  return undefined;
}

/** The banner (the shell's slot under the header) for a status that blocks sending; nothing otherwise. */
export function CoachProviderBanner({ status }: { status: CoachStatus }) {
  const reason = status.kind === 'serverUnavailable' ? undefined : blockedReason(status);
  const settings = useMemo(
    () => (
      <KeyLink size="sm" variant="action" to={T.settingsTo}>
        {T.settingsLink}
      </KeyLink>
    ),
    [],
  );
  return reason ? <GlobalNotice id="coach-provider" severity="caution" title={reason} actions={settings} /> : null;
}

/** "Retrying in 20 s" counting down (the icon's name and tooltip); the adapter retries on its own. */
function RetryCapsule({ from }: { from: number }) {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <StatusCapsule icon={Hourglass} label={left > 0 ? T.capsule.retrying(left) : T.capsule.retryingNow} pulse />;
}

/** The header status icon for the connection (offline, rate limited), or null. A press shows what it means. */
export function connectionCapsule(status: CoachStatus) {
  if (status.kind === 'offline') return <StatusCapsule icon={WifiOff} label={T.capsule.offline} />;
  if (status.kind === 'rateLimited') return <RetryCapsule key={status.retryInS ?? 20} from={status.retryInS ?? 20} />;
  return null;
}

/** What this model can't do, as one line at the start of the conversation, or null. */
export function capabilityLine(status: CoachStatus): string | null {
  if (status.kind === 'noTools') return T.noTools;
  if (status.kind === 'basic') return T.basic;
  if (status.kind === 'safetyNoPlanning') return T.safetyNoPlanningLine;
  if (status.kind === 'serverUnavailable') return status.problem ?? null;
  return null;
}
