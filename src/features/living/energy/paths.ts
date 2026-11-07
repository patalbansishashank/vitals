/**
 * (r069 D4) The Energy page: `/energy` (today), `/energy?date=` (an earlier day) and a week, month, year or range in the
 * shared date control's address form (`periodSearch`).
 */
export const ENERGY_PATH = '/energy';

export const energyPaths = {
  day: (date?: string) => (date ? `${ENERGY_PATH}?date=${date}` : ENERGY_PATH),
} as const;
