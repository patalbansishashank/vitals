import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../../components/changeCard.css'), 'utf8');
const rule = (selector: string): string => {
  const m = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? '';
};

describe('change card never widens the page (Q10-03)', () => {
  it('the card root can shrink and wraps any unbroken text (ids, links, long values) inside its box', () => {
    const root = rule('.lv-card');
    expect(root).toMatch(/min-width:\s*0/);
    expect(root).toMatch(/overflow-wrap:\s*anywhere/);
    expect(root).toMatch(/max-width:\s*100%/);
  });
  it('the before and after values and the note lines can shrink', () => {
    expect(rule('.lv-card__before')).toMatch(/min-width:\s*0/);
    expect(rule('.lv-card__after')).toMatch(/min-width:\s*0/);
  });
});
