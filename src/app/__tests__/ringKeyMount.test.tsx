import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RingServiceProvider } from '@/features/ring/data';
import { createFakeRingService, scenarioPlatform } from '@/features/ring/fixtures';
import { MobileTopBar } from '../shell/Chrome';

describe('the ring key in the shell (ring-pages.md D2)', () => {
  it('sits in the phone top bar and opens Body signals', () => {
    const fake = createFakeRingService('connected');
    render(
      <MemoryRouter initialEntries={['/today']}>
        <RingServiceProvider service={fake} platform={scenarioPlatform('connected')}>
          <MobileTopBar header={null} />
        </RingServiceProvider>
      </MemoryRouter>,
    );
    const key = screen.getByRole('link', { name: /^Body signals/ });
    expect(key).toHaveAttribute('href', '/signals');
  });
});
