/** The BodyParts3D atlas is CC BY 4.0: its credit is kept in Settings › About (not on the figure card) and the notice it links to ships. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { AboutSection } from '../sections';

beforeEach(() => {
  freshState();
});

describe('Settings › About › licences: 3D anatomy credit', () => {
  it('credits BodyParts3D under CC BY 4.0 and links to the packaged notice', () => {
    render(
      <MemoryRouter>
        <AboutSection />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/3D anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4\.0\./),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Model sources and changes' });
    expect(link.getAttribute('href')).toMatch(/figure\/NOTICE\.html$/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('still ships public/figure/NOTICE.html with the attribution wording', () => {
    const file = resolve(__dirname, '../../../../public/figure/NOTICE.html');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/BodyParts3D, © The Database Center for Life Science licensed under/);
  });
});
