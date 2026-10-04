/** Set a data-* attribute only when it changes (redundant writes still invalidate style). */
export function setData(el: HTMLElement, key: string, value: string): void {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}
