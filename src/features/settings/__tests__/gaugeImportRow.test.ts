/** Settings › Sync › Ring: the help line of "Ring data from Gauge". */
import { describe, expect, it } from 'vitest';
import { gaugeImportHelp, lastImportText } from '../GaugeImportRow';

describe('Ring data from Gauge', () => {
  const now = new Date(2026, 9, 20, 15, 0);
  it('says on with the last import time, nothing yet, or off', () => {
    expect(gaugeImportHelp(true, new Date(2026, 9, 20, 12, 4).toISOString(), now)).toBe('On · last import 12:04');
    expect(gaugeImportHelp(true, null, now)).toBe('On · nothing imported yet');
    expect(gaugeImportHelp(false, new Date(2026, 9, 20, 12, 4).toISOString(), now)).toBe('Off · ring steps and sleep stay out of your plan');
  });
  it('dates an import from another day', () => {
    expect(lastImportText(new Date(2026, 9, 18, 7, 30).toISOString(), now)).toBe('18 Oct 07:30');
    expect(lastImportText('nonsense', now)).toBeNull();
  });
});
