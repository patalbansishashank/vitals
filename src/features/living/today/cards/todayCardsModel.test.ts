import { resolveTodayCards, storeTodayCards, type CardDefinition } from './todayCardsModel';
import { todayCardRegistry } from './registry';
import { TODAY_CARD_GROUPS } from './groups';

const defs: CardDefinition[] = [
  { id: 'eaten', sizes: ['tile', 'card', 'wide'], defaultSize: 'card' },
  { id: 'energy', sizes: ['tile', 'card', 'wide'], defaultSize: 'card' },
  { id: 'steps', sizes: ['tile', 'card', 'wide'], defaultSize: 'tile' },
];

describe('Today card layouts', () => {
  it('reads a saved "Energy burned" card as the Energy card, in its place and at its size', () => {
    expect(resolveTodayCards(['steps', 'energy-burned:wide', 'eaten'], defs)).toEqual([
      { id: 'steps', size: 'tile' },
      { id: 'energy', size: 'wide' },
      { id: 'eaten', size: 'card' },
    ]);
  });

  it('keeps one Energy card when a layout saved both, at the first one’s place', () => {
    expect(resolveTodayCards(['energy-burned:tile', 'steps', 'energy:wide'], defs)).toEqual([
      { id: 'energy', size: 'tile' },
      { id: 'steps', size: 'tile' },
    ]);
    expect(resolveTodayCards(['energy', 'energy-burned:wide'], defs)).toEqual([{ id: 'energy', size: 'card' }]);
  });

  it('writes the new id back on the next change, and leaves a layout without the old card as it was', () => {
    expect(storeTodayCards(resolveTodayCards(['energy-burned:wide'], defs), defs)).toEqual(['energy:wide']);
    expect(resolveTodayCards(['eaten:tile', 'steps:card'], defs)).toEqual([
      { id: 'eaten', size: 'tile' },
      { id: 'steps', size: 'card' },
    ]);
    expect(resolveTodayCards([], defs)).toEqual([]);
  });

  it('the registry has one Energy card and every card in one of the library’s fixed groups', () => {
    expect(todayCardRegistry.map((d) => d.id)).not.toContain('energy-burned');
    expect(todayCardRegistry.filter((d) => d.title === 'Energy')).toHaveLength(1);
    for (const d of todayCardRegistry) expect(TODAY_CARD_GROUPS, d.id).toContain(d.group);
    const group = (id: string) => todayCardRegistry.find((d) => d.id === id)?.group;
    expect(group('heart-points')).toBe('Move');
    expect(['steps', 'steps-day', 'activities', 'week', 'session'].map(group)).toEqual(['Move', 'Move', 'Move', 'Move', 'Move']);
    expect(['hrv', 'stress', 'skin-temp', 'day-score'].map(group)).toEqual(['Recovery', 'Recovery', 'Recovery', 'Recovery']);
    expect(group('videos')).toBe('Short videos');
  });

  it('one name per card: Signals, HRV, Skin temperature and Energy balance', () => {
    const title = (id: string) => todayCardRegistry.find((d) => d.id === id)?.title;
    expect(title('ring')).toBe('Signals');
    expect(title('hrv')).toBe('HRV');
    expect(title('skin-temp')).toBe('Skin temperature');
    expect(title('energy-balance')).toBe('Energy balance');
    expect(title('sleep-4w')).toBe('Sleep · last four weeks');
  });
});
