import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, parseMarkdown } from '../lib/miniMarkdown';

const DOC = `# Validation report

Model **2026.09** checked against *published* studies. See [Hall 2011](https://doi.org/10.1016/x) and [the spec](../docs/MODEL_SPEC.md).

## Results

| study | observed | projected |
|---|---:|---:|
| Minnesota | −16.8 kg | −16.1 kg |
| CALERIE \\| arm 1 | −7.6 kg | −7.9 kg |

- first finding
  continued on the next line
- second \`code\`

1. one
2. two

> A quoted caveat.

---

\`\`\`
raw <b>not html</b>
\`\`\`
`;

describe('mini Markdown reader (validation report)', () => {
  it('parses headings, tables with alignment, lists, quotes, rules and code', () => {
    const blocks = parseMarkdown(DOC);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'heading', 'table', 'list', 'list', 'quote', 'rule', 'code']);
    const table = blocks[3]!;
    expect(table.kind === 'table' && table.align).toEqual([null, 'right', 'right']);
    expect(table.kind === 'table' && table.rows[1]![0]).toBe('CALERIE | arm 1');
    const list = blocks[4]!;
    expect(list.kind === 'list' && list.items[0]).toBe('first finding continued on the next line');
  });

  it('renders text only: external links open in a new tab, relative links and HTML stay plain text', () => {
    const { container } = render(<Markdown source={DOC} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Validation report' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Results' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Hall 2011' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'the spec' })).toBeNull();
    expect(container.querySelector('p')!.textContent).toContain('and the spec.');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toBe('raw <b>not html</b>');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['study', 'observed', 'projected']);
  });
});
