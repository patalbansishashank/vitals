/**
 * The model validation report (docs/VALIDATION_REPORT.md), bundled as text when the file exists at build time.
 * `import.meta.glob` matches nothing while the report is not written, so the app then shows a clear
 * "not published yet" page and hides the links to it — no build step or code change is needed when it lands.
 *
 * The file is shown to users as written, so it uses topic names and plain words only (no research-note numbers, ruling
 * ids or file names; `src/content/evidence/__tests__/noInternalRefs.test.ts` checks it). The maintainers' version with
 * those ids is `docs/VALIDATION_REPORT_INTERNAL.md`; it is not bundled. Keep the numbers of the two in step.
 */
const loaders = import.meta.glob<string>('/docs/VALIDATION_REPORT.md', { query: '?raw', import: 'default' });

/** Loads the report text (its own lazy chunk), or null when the report does not exist yet. */
export const loadValidationReport: (() => Promise<string>) | null = Object.values(loaders)[0] ?? null;

export const hasValidationReport = loadValidationReport !== null;
