/** A stand-in for `<CataloguePicker>` in screen tests: lists the value and adds one known item per kind. */
import type { CataloguePickerProps } from '@/features/components/PickerTypes';

export const STUB_ADDS = { equipment: 'eq.tawa', cuisines: 'cu.x', staples: 'st.onion', pantry: 'pa.onion_red' } as const;

export function PickerStub(p: CataloguePickerProps) {
  return (
    <div role="group" aria-label={p.label}>
      <ul>
        {p.value.map((e) => (
          <li key={e.id}>{e.id}</li>
        ))}
      </ul>
      <button type="button" onClick={() => p.onChange([...p.value, { id: STUB_ADDS[p.kind], source: 'picker' }])}>
        {`Add to ${p.label}`}
      </button>
    </div>
  );
}
