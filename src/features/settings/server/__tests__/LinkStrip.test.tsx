import { render, screen } from '@testing-library/react';
import { OFF_STATUS } from '@/sync/types';
import { LinkStrip } from '../LinkStrip';

it('bounds the queue marks while retaining the full waiting count', () => {
  const { container } = render(
    <LinkStrip
      host="vitals.example"
      connection={{ state: 'checking', lastContactAt: null }}
      sync={{ ...OFF_STATUS, state: 'syncing', pendingChanges: 13, pendingBlobs: 2 }}
      syncState="On"
    />,
  );
  expect(screen.getByRole('img', { name: '15 changes and uploads waiting' })).toBeInTheDocument();
  expect(container.querySelectorAll('.settings-link__queue i')).toHaveLength(12);
  expect(screen.getByText('+3')).toBeInTheDocument();
  expect(container.querySelector('.settings-link')).toHaveAttribute('data-checking');
  expect(container.querySelector('.settings-link')).not.toHaveAttribute('data-reached');
});

it('keeps an empty queue empty', () => {
  const { container } = render(
    <LinkStrip
      host="vitals.example"
      connection={{ state: 'checking', lastContactAt: null }}
      sync={OFF_STATUS}
      syncState="Off"
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(container.querySelector('.settings-link__queue')).toBeNull();
});
