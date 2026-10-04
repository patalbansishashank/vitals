import fs from 'node:fs';
import path from 'node:path';
import { scanCrossRouteAnchors, scanEvidenceLinks } from './visible-copy.mjs';

const directory = path.resolve(import.meta.dirname, '../../../.e6-tmp/C-WEBQA');
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const optional = (name) => fs.existsSync(path.join(directory, name)) ? read(name) : [];
const key = (row) => [row.profile, row.width, row.theme, row.route].join('|');
const merge = (initial, corrections) => {
  const rows = new Map(initial.map((row) => [key(row), row]));
  for (const row of corrections) rows.set(key(row), row);
  return [...rows.values()];
};
const pages = merge([...read('sweep-fresh.json'), ...read('sweep-seeded.json')], [
  ...optional('sweep-fresh-figure.json'), ...optional('sweep-fresh-gallery.json'), ...optional('sweep-seeded-gallery.json'),
]);
const accessibility = merge([...read('accessibility-fresh.json'), ...read('accessibility-seeded.json')], [
  ...optional('accessibility-fresh-hitcheck.json'), ...optional('accessibility-seeded-hitcheck.json'),
  ...optional('accessibility-fresh-integrated.json'), ...optional('accessibility-seeded-integrated.json'),
]);
const anchors = scanCrossRouteAnchors(pages.filter((row) => row.layout).map((row) => ({ route: row.layout.path, links: row.layout.links, ids: row.ids })));
const summary = {
  routes: {
    states: pages.length,
    byProfile: Object.fromEntries(['fresh', 'seeded'].map((profile) => [profile, pages.filter((row) => row.profile === profile).length])),
    failures: pages.filter((row) => row.failure).map(({ profile, width, theme, route, failure }) => ({ profile, width, theme, route, failure })),
    consoleStates: pages.filter((row) => row.errors?.length && !row.expectedError).length,
    failedRequests: pages.reduce((count, row) => count + (row.failedRequests?.length ?? 0), 0),
    overflowStates: pages.filter((row) => row.layout?.horizontalOverflow > 1).length,
    coveredLastControlStates: pages.filter((row) => row.layout?.finalControl?.covered).length,
    brokenImages: pages.flatMap((row) => row.layout?.brokenImages ?? []).length,
    forbiddenCopyStates: pages.filter((row) => row.copy?.forbiddenTextRules || row.copy?.forbiddenUrlRules).map(({ profile, width, theme, route }) => ({ profile, width, theme, route })),
    unknownLinks: pages.reduce((count, row) => count + (row.links?.unknownRouteIndexes.length ?? 0), 0),
    missingSamePageAnchors: pages.reduce((count, row) => count + (row.links?.missingAnchorIndexes.length ?? 0), 0),
    crossPageAnchors: anchors,
    evidenceLinks: scanEvidenceLinks(pages.flatMap((row) => row.layout?.links ?? [])),
  },
  accessibility: {
    states: accessibility.length,
    measuredTextSamples: accessibility.reduce((count, row) => count + row.contrast.measured, 0),
    skippedGradientOrOpacitySamples: accessibility.reduce((count, row) => count + row.contrast.skippedImages, 0),
    contrastCandidates: accessibility.flatMap((row) => row.contrast.candidates).length,
    focusChecks: accessibility.reduce((count, row) => count + row.focus.length, 0),
    focusCandidates: accessibility.flatMap((row) => row.focus.filter((focus) => focus.covered || !focus.visible || focus.focusVisible && !focus.outline && !focus.shadow)).length,
    hitChecks: accessibility.reduce((count, row) => count + (row.hitTargets?.checked ?? 0), 0),
    hitCandidates: accessibility.flatMap((row) => row.hitTargets?.candidates ?? []).length,
  },
  additionalAnchors: {
    checked: optional('anchor-targets.json').length,
    failed: optional('anchor-targets.json').filter((row) => !row.passed).length,
  },
  copyProvenance: {
    routes: optional('copy-provenance.json').length,
    unexplained: optional('copy-provenance.json').filter((row) => row.withoutFixtureLabel.forbiddenTextRules || row.withoutFixtureLabel.forbiddenUrlRules).length,
  },
};
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
