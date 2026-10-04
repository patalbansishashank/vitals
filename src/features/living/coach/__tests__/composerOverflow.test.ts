import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../../components/coachComposer.css'), 'utf8');
const rule = (selector: string): string => {
  const m = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? '';
};

describe('the Coach composer never widens the page', () => {
  it('its grid has one shrinkable column, so a long prompt chip cannot push the send key off screen at 390 px', () => {
    expect(rule('.lv-composer')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.lv-composer__chips')).toMatch(/min-width:\s*0/);
    expect(rule('.lv-composer__chip')).toMatch(/max-width:\s*100%/);
  });
});
