import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { summarizeAiUsage, type UsageBucket } from '@/commands/ai';
import { SpendTrack } from '../SpendTrack';

function usage(cost: number, inputTokens = 100, outputTokens = 50) {
  const bucket: UsageBucket = {
    day: '2026-10-01',
    preset: 'anthropic',
    model: 'test',
    requests: 1,
    inputTokens,
    outputTokens,
    cachedInputTokens: 0,
    costUsd: cost,
    unpriced: 0,
    estimated: true,
  };
  return summarizeAiUsage({ today: '2026-10-01', buckets: [bucket], spendCapUsdMonthly: 10 });
}

describe('Coach spend strip', () => {
  it('shows this calendar month against the cap, with the warning threshold and period facts', () => {
    render(<SpendTrack usage={usage(8.5)} cap={10} stopAtCap={false} />);
    const meter = screen.getByRole('meter', { name: "This month's estimated spend" });
    expect(meter).toHaveAttribute('aria-valuenow', '8.5');
    expect(meter).toHaveAttribute('aria-valuemax', '10');
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining('$8.50'));
    expect(screen.getByText('80 % warning')).toBeInTheDocument();
    const periods = screen.getByLabelText('Estimated spend by period');
    expect(within(periods).getByText('Today')).toBeInTheDocument();
    expect(within(periods).getByText('7 days')).toBeInTheDocument();
    expect(within(periods).getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText(/You've used 85 %/)).toBeInTheDocument();
  });

  it('shows money without a goal picture when no cap is set', () => {
    render(<SpendTrack usage={usage(8.5)} cap={null} stopAtCap={false} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('About $8.50 · no cap this month')).toBeInTheDocument();
  });

  it('comma-groups large token totals and costs', () => {
    render(<SpendTrack usage={usage(1250.25, 2345, 678)} cap={null} stopAtCap={false} />);
    expect(screen.getByText('About $1,250 · no cap this month')).toBeInTheDocument();
    expect(screen.getByText(/3,023 tokens in 30 days/)).toBeInTheDocument();
  });

  it('keeps the actual cost above a cap and says whether the Coach pauses', () => {
    render(<SpendTrack usage={usage(12)} cap={10} stopAtCap />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', expect.stringContaining('$12'));
    expect(screen.getByText(/You've reached this month's cap/)).toBeInTheDocument();
    expect(screen.getByText('The Coach is paused.')).toBeInTheDocument();
  });

  it('explains the estimate and cap policy in the information panel', async () => {
    const user = userEvent.setup();
    render(<SpendTrack usage={usage(2.4)} cap={10} stopAtCap={false} />);
    await user.click(screen.getByRole('button', { name: 'About How spend is counted' }));
    expect(await screen.findByRole('dialog', { name: 'How spend is counted' })).toHaveTextContent(
      "your provider's invoice is the truth",
    );
  });
});
