/** LocalDate arithmetic for ingest (no clock). */
export function addDaysIso(localDate: string, n: number): string {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
