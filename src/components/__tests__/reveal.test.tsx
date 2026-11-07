/**
 * The reveal and count-up hooks (r071 AUDIT §4): a picture is final from the first render wherever motion cannot run
 * and goes pending → revealed when it can; a count-up shows its target whenever it is off.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCountUp, useMotionEnabled, useReveal } from '../lib/reveal';
import { fakeMotion } from '../viz/__tests__/motionHelpers';

function Picture({ animate }: { animate?: boolean }) {
  const [ref, pending] = useReveal<HTMLDivElement>({ animate });
  return <div ref={ref} data-testid="pic" data-reveal={pending ? 'pending' : undefined} />;
}

function Count({ target, active = true, enabled }: { target: number; active?: boolean; enabled?: boolean }) {
  const on = useMotionEnabled(true);
  const v = useCountUp(target, { enabled: enabled ?? on, active });
  return <span data-testid="n">{Math.round(v)}</span>;
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-motion');
});

describe('useReveal', () => {
  it('is never pending in jsdom (no motion): the final frame from the first render', () => {
    render(<Picture />);
    expect(screen.getByTestId('pic')).not.toHaveAttribute('data-reveal');
  });

  it('is pending until first in view where motion can run, then clears for good', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      render(<Picture />);
      expect(screen.getByTestId('pic')).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restore();
    }
    const restoreSeen = await fakeMotion();
    try {
      render(<Picture />);
      await act(async () => {});
      expect(screen.getAllByTestId('pic').at(-1)).not.toHaveAttribute('data-reveal');
    } finally {
      restoreSeen();
    }
  });

  it('animate={false} and reduced motion render the final frame at once', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const { rerender } = render(<Picture animate={false} />);
      expect(screen.getByTestId('pic')).not.toHaveAttribute('data-reveal');
      document.documentElement.setAttribute('data-motion', 'reduce');
      rerender(<Picture />);
      expect(screen.getByTestId('pic')).not.toHaveAttribute('data-reveal');
    } finally {
      restore();
    }
  });
});

describe('useCountUp', () => {
  it('shows the target at once when it is off', () => {
    render(<Count target={1096} enabled={false} />);
    expect(screen.getByTestId('n')).toHaveTextContent('1096');
  });

  it('waits at 0 until seen, then reaches the target', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { rerender } = render(<Count target={1096} active={false} enabled />);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    rerender(<Count target={1096} active enabled />);
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByTestId('n')).toHaveTextContent('1096');
  });
});
