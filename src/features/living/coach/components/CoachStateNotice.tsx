/**
 * Provider states above the conversation (living-mode.md, Coach states): faceplate text with a drawn status mark,
 * colour on the mark only. "No provider" is not here — it is the conversation's own empty state.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { KeyLink, Notice } from '@/components';
import type { CoachStatus } from '../adapter';
import { COACH_COPY as T } from '../copy';

/** "The provider is busy — trying again in 20 s." counting down; the adapter retries on its own. */
function RetryCountdown({ from }: { from: number }) {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{left > 0 ? T.rateLimited(left) : T.rateLimitedNow}</>;
}

export function CoachStateNotice({ status }: { status: CoachStatus }) {
  const provider = status.provider ?? 'your provider';
  const settings = (
    <KeyLink size="sm" to={T.settingsTo}>
      {T.settingsLink}
    </KeyLink>
  );
  switch (status.kind) {
    case 'keyRefused':
      return <Notice severity="caution" title={T.keyRefused(provider)} actions={settings} />;
    case 'outOfCredit':
      return <Notice severity="caution" title={T.outOfCredit} actions={settings} />;
    case 'rateLimited':
      return <Notice severity="info" title={<RetryCountdown key={status.retryInS ?? 20} from={status.retryInS ?? 20} />} />;
    case 'cors':
      return (
        <Notice severity="caution" title={T.cors(provider)}>
          <Link className="lm-link" to={T.settingsTo}>
            {T.corsFix}
          </Link>{' '}
          {T.corsCompanion}
        </Notice>
      );
    case 'offline':
      return <Notice severity="info" title={T.offline} />;
    case 'noTools':
      return <Notice severity="info" title={T.noTools} />;
    case 'basic':
      return <Notice severity="info" title={T.basic} />;
    case 'safetyNoPlanning':
      return <Notice severity="info" title={T.safetyNoPlanning} />;
    default:
      return null;
  }
}

/** Statuses where sending can't work until the person fixes something in Settings. */
export function blockedReason(status: CoachStatus): string | undefined {
  const provider = status.provider ?? 'your provider';
  if (status.kind === 'keyRefused') return T.keyRefused(provider);
  if (status.kind === 'outOfCredit') return T.outOfCredit;
  if (status.kind === 'cors') return T.cors(provider);
  return undefined;
}
