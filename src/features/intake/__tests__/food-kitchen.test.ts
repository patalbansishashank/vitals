import { commitKitchenAnswer, INTAKE_PARTS, INTAKE_WIDGETS, KITCHEN_QUESTIONS } from '../chapters/food-kitchen';

describe('food chapter: kitchen questions (v3)', () => {
  it('has self-contained questions of at least six words, without a leading "And", "Mostly" or "Which one"', () => {
    for (const q of KITCHEN_QUESTIONS) {
      expect(q.text.split(/\s+/).filter(Boolean).length, q.id).toBeGreaterThanOrEqual(6);
      expect(q.text, q.id).not.toMatch(/^(And|Mostly|Which one)\b/);
      expect(q.short.length).toBeGreaterThan(0);
      expect(q.skipText.length).toBeGreaterThan(0);
      expect(q.why ?? '').not.toMatch(/R\d+|§|seed|catalogue|command/i);
    }
  });

  it('has unique ids and orders in the food chapter, each answered with the picker of its kind', () => {
    expect(new Set(KITCHEN_QUESTIONS.map((q) => q.id)).size).toBe(4);
    expect(new Set(KITCHEN_QUESTIONS.map((q) => q.order)).size).toBe(4);
    expect(KITCHEN_QUESTIONS.map((q) => q.id)).toEqual(['food.cuisines', 'food.equipment', 'food.staples', 'food.pantry']);
    for (const q of KITCHEN_QUESTIONS) {
      expect(q.chapter).toBe('food');
      expect(q.askLater).toBe(true);
      expect(q.answer).toEqual({ kind: 'custom', widget: `cataloguePicker:${q.pickerKind}` });
    }
    const pantry = KITCHEN_QUESTIONS.find((q) => q.id === 'food.pantry')!;
    expect(pantry.pantryOptional).toBe(true);
    expect(pantry.skipText).toBe('skipped, by choice');
  });

  it('turns a picker answer into the command that saves it', () => {
    expect(commitKitchenAnswer('food.cuisines', [{ id: 'cu.a' }, { id: 'cu.b' }])).toEqual({ commandId: 'kitchen.set', input: { cuisines: [{ id: 'cu.a', rank: 1 }, { id: 'cu.b', rank: 2 }] } });
    expect(commitKitchenAnswer('food.equipment', [{ id: 'eq.tawa', note: 'big', ownNotUsed: true }])).toEqual({ commandId: 'kitchen.set', input: { equipment: [{ id: 'eq.tawa', note: 'big', use: 'ownNotUsed' }] } });
    expect(commitKitchenAnswer('food.staples', [{ id: 'st.onion' }])).toEqual({ commandId: 'kitchen.set', input: { staples: [{ id: 'st.onion' }] } });
    expect(commitKitchenAnswer('food.pantry', [{ id: 'custom:jaggery', label: 'jaggery', note: '1 kg' }])).toEqual({
      commandId: 'pantry.add',
      input: { items: [{ id: 'custom:jaggery', label: 'jaggery', qtyApprox: '1 kg' }], replace: true },
    });
    expect(commitKitchenAnswer('food.diet', [])).toBeNull();
  });
});

describe('chapter part for the v3 registry', () => {
  it('inserts the four pickers after "who cooks" and takes over the v0.2 kitchen turns', () => {
    expect(INTAKE_PARTS).toHaveLength(1);
    const [part] = INTAKE_PARTS;
    expect(part).toMatchObject({ chapter: 'food', after: 'cooks', replaces: ['kitchen', 'staples', 'pantry', 'cuisine'] });
    expect(part!.questions.map((q) => [q.id, q.kind, q.kind === 'custom' ? q.widget : null])).toEqual([
      ['food.cuisines', 'custom', 'cataloguePicker:cuisines'],
      ['food.equipment', 'custom', 'cataloguePicker:equipment'],
      ['food.staples', 'custom', 'cataloguePicker:staples'],
      ['food.pantry', 'custom', 'cataloguePicker:pantry'],
    ]);
    for (const q of part!.questions) {
      expect(q.prompt.split(' ').length).toBeGreaterThanOrEqual(6);
      expect(q.kind === 'custom' && INTAKE_WIDGETS[q.widget]).toBeDefined();
    }
  });
});

describe('picker answers in the answered list (Q3-J1)', () => {
  it('reads as names and a count, never as raw entries', async () => {
    const { pickerReceipt, INTAKE_PARTS } = await import('../chapters/food-kitchen');
    expect(pickerReceipt([{ id: 'cu.kerala', source: 'picker' }], 'set by your region')).toBe('kerala');
    expect(pickerReceipt([{ id: 'eq.tawa', label: 'Tawa (flat griddle)' }, { id: 'eq.pressure_cooker_medium' }, { id: 'eq.kadhai' }, { id: 'eq.milk_pan' }, { id: 'custom:abc', label: 'soda maker' }], 'x')).toBe(
      'Tawa (flat griddle), pressure cooker medium, kadhai and 2 more',
    );
    // catalogue items read by the name stored at Done (Q3-J1-08)
    expect(pickerReceipt([{ id: 'st.rice_matta', name: 'Matta rice' }, { id: 'st.rice_white_generic', name: 'White rice' }], 'x')).toBe('Matta rice, White rice');
    expect(pickerReceipt([], 'x')).toBe('none');
    expect(pickerReceipt('skipped', 'skipped, by choice')).toBe('skipped, by choice');
    const pantry = INTAKE_PARTS[0]!.questions.find((q) => q.id === 'food.pantry')!;
    expect(pantry.receipt?.([], { india: true, gentle: false, stepDevice: false })).toBe('skipped, by choice');
    for (const q of INTAKE_PARTS[0]!.questions) {
      const line = q.receipt?.([{ id: 'st.toor_dal' }], { india: true, gentle: false, stepDevice: false }) ?? '';
      expect(line).not.toMatch(/object Object/);
      expect(line).toBe('toor dal');
    }
  });
});
