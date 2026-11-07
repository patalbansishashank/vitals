import { DottedTrack, InlineWarning, MonoMeta, Notice, formatNumber } from '@/components';
import type { UsageSummary } from '@/commands/ai';
import { SettingInfo } from '../SettingRow';
import { AI_COPY, usd } from './copy';
import './spend.css';

/** Estimated money spent this calendar month, against a limit rather than a target to reach. */
export function SpendTrack({
  usage,
  cap,
  stopAtCap,
}: {
  usage: UsageSummary;
  cap: number | null;
  stopAtCap: boolean;
}) {
  const month = usage.periods.thisMonth.costUsd;
  const limit = cap !== null && cap > 0 ? cap : null;
  const fraction = limit === null ? null : month / limit;
  const periods = [
    ['Today', usage.periods.today.costUsd],
    ['7 days', usage.periods.last7Days.costUsd],
    ['30 days', usage.periods.last30Days.costUsd],
  ] as const;
  return (
    <div className="settings-spend">
      <div className="settings-spend__head">
        <p className="settings-text">Spend</p>
        <SettingInfo title="How spend is counted" info={{ body: AI_COPY.spendInfo }} />
      </div>
      <MonoMeta tone="ink">
        About {usd(month)}
        {limit === null ? ' · no cap' : ` / ${usd(limit)}`} this month
      </MonoMeta>
      {limit === null ? null : (
        <DottedTrack
          label="This month's estimated spend"
          value={Math.min(month, limit)}
          valueText={`about ${usd(month)}${fraction !== null && fraction >= 1 ? ', cap reached' : ''}`}
          goal={limit}
          goalKind="limit"
          goalText={usd(limit)}
          marks={[{ at: limit * 0.8, label: '80 % warning' }]}
        />
      )}
      <dl className="settings-spend__periods" aria-label="Estimated spend by period">
        {periods.map(([label, amount]) => (
          <div key={label}>
            <dt>
              <MonoMeta>{label}</MonoMeta>
            </dt>
            <dd>
              <MonoMeta tone="ink">About {usd(amount)}</MonoMeta>
            </dd>
          </div>
        ))}
      </dl>
      <MonoMeta>
        {formatNumber(usage.periods.last30Days.inputTokens + usage.periods.last30Days.outputTokens)}{' '}
        tokens in 30 days · {AI_COPY.usageNote}
      </MonoMeta>
      {limit !== null && fraction !== null && fraction >= 1 ? (
        <Notice severity="caution" layout="ruled" title={AI_COPY.capReached(usd(limit))}>
          {stopAtCap ? AI_COPY.capPaused : AI_COPY.capWarnOnly}
        </Notice>
      ) : limit !== null && fraction !== null && fraction >= 0.8 ? (
        <InlineWarning severity="caution">
          {AI_COPY.capWarn(Math.floor(fraction * 100), usd(limit))}
        </InlineWarning>
      ) : null}
    </div>
  );
}
