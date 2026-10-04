import { buildKitchenIndex, createKitchenCatalogue } from '@/catalogues/kitchen';
import { KITCHEN_SEED } from '@/content/catalogues/kitchen';
import { equipmentLine } from '../pantryEquipment';

const index = buildKitchenIndex(createKitchenCatalogue(KITCHEN_SEED));

describe('equipmentLine', () => {
  it('lists what the recipe needs and nothing as missing without a kitchen list', () => {
    expect(equipmentLine(['pressure cooker', 'tawa', 'tawa'], [], index)).toEqual({ needs: ['pressure cooker', 'tawa'], missing: [] });
  });

  it('matches kitchen labels case-insensitively, by words and through the catalogue', () => {
    const kitchen = ['Pressure cooker, medium (5 L)', 'Kadhai (wok-like pan)'];
    expect(equipmentLine(['Pressure Cooker', 'kadai', 'tawa'], kitchen, index)).toEqual({ needs: ['Pressure Cooker', 'kadai', 'tawa'], missing: ['tawa'] });
    expect(equipmentLine(['kadai'], kitchen, null).missing).toEqual(['kadai']);
    expect(equipmentLine(['tawa'], ['TAWA'], null).missing).toEqual([]);
  });
});
