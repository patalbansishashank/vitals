/** Copy for the supplement row (design/COMPONENTS.md §14.4). Plain words; no internal references. */
import type { SupplementState, TimeOfDay } from '@/catalogues/supplements';

export const SUPPLEMENT_ROW_COPY = {
  states: { taking: 'taking', onHand: 'have it, don’t take', notForMe: 'not for me' } satisfies Record<Exclude<SupplementState, 'unknown'>, string>,
  stateLabel: (name: string) => `${name}: taking or not`,
  stateNow: (name: string, state: string) => `${name}: ${state}`,
  chooseState: 'choose',
  times: { morning: 'morning', midday: 'midday', evening: 'evening', night: 'night' } satisfies Record<TimeOfDay, string>,
  timeName: (name: string, t: TimeOfDay) => `${name} ${{ morning: 'in the morning', midday: 'at midday', evening: 'in the evening', night: 'at night' }[t]}`,
  timesLabel: (name: string) => `When you take ${name}`,
  doseName: (name: string, unitWord: string) => `${name} dose, ${unitWord}`,
  unitLabel: (name: string) => `${name} unit`,
  each: 'each time',
  perDay: (amount: string, unit: string) => `${amount} ${unit} a day`,
  onHand: 'at home · the Coach may suggest using it before buying anything',
  notForMe: 'not for me · never suggested',
  unknown: 'not said yet',
  yourOwn: 'added by you',
  edit: 'Edit',
  done: 'Done',
  remove: 'Remove',
  removeName: (name: string) => `Remove ${name}`,
  taken: 'Taken',
  takenName: (name: string) => `Mark ${name} as taken today`,
  undoTakenName: (name: string) => `${name} taken today; press to undo`,
  unitWords: { g: 'grams', mg: 'milligrams', µg: 'micrograms', IU: 'international units', ml: 'millilitres', mmol: 'millimoles', scoop: 'scoops', tablet: 'tablets', capsule: 'capsules' } as Record<string, string>,
} as const;
