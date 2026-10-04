import { leak, report, strings } from '@/content/evidence/__tests__/leakScan';
import { EQUIVALENCE_COPY } from '../components/EquivalenceMeter';
import { STRIP_COPY } from '../copy';

// Every copy module under src/features/living (shared and per screen) is scanned for internal references, plus the
// copy objects that live next to shared components.
const modules: Record<string, Record<string, unknown>> = {
  ...import.meta.glob<Record<string, unknown>>('../**/copy.ts', { eager: true }),
  '../components/EquivalenceMeter.tsx': { EQUIVALENCE_COPY },
};

function allStrings(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [file, mod] of Object.entries(modules)) strings(mod, file, found);
  return found;
}

describe('living copy', () => {
  it('has copy modules to scan (shared, today, food, train, coach, progress, plan)', () => {
    const files = Object.keys(modules).join(' ');
    for (const area of ['../copy.ts', 'food/copy.ts', 'train/copy.ts', 'coach/copy.ts', 'progress/copy.ts', 'plan/copy.ts']) expect(files).toContain(area);
  });

  it('contains no internal references', () => {
    const hits = allStrings()
      .map(([p, t]) => {
        const l = leak(t);
        return l ? `${p}: ${l}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(hits, report(hits)).toEqual([]);
  });

  it('never moralises, counts streaks or shouts', () => {
    const bad = allStrings()
      .filter(([, t]) => /\bstreaks?\b|\bfailed\b|\bcheat(ed|ing)?\b|\bguilt|\bbad food\b|!\s*$/i.test(t))
      .map(([p, t]) => `${p}: ${t}`);
    expect(bad).toEqual([]);
  });

  it('the plan strip says the plan is safe while planning tools are open', () => {
    expect(STRIP_COPY.running('Spring cut')).toBe('Spring cut is running');
    expect(STRIP_COPY.safe).toBe('Changes here don’t touch it until you replace it.');
  });
});
