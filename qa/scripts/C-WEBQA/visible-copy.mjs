// Browser sweep helpers. Results contain rule counts and link indexes, never matched text.
import { FORBIDDEN, FORBIDDEN_URL, scanForbidden, scanUrl } from '../Q3/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'dist');

const literal = new Set([
  '/', '/welcome', '/body', '/ring', '/signals', '/simulate', '/plan', '/plan/goals', '/plan/run', '/plan/results',
  '/onboarding', '/today', '/food', '/food/pantry', '/train', '/plan/active', '/progress', '/coach',
  '/safety', '/evidence', '/evidence/validation', '/evidence/topics', '/settings',
  '/profile', '/simulator', '/planner', '/library',
  '/dev/components', '/dev/picker', '/dev/safety', '/dev/avatar', '/dev/figure', '/dev/error', '/dev/charts',
]);
const patterns = [
  /^\/simulate\/[^/]+(?:\/schedule|\/results)?$/,
  /^\/onboarding\/(?:activity|training|diet|kitchen|supplements|markers|devices|summary)$/,
  /^\/(?:today|food|train)\/\d{4}-\d\d-\d\d$/,
  /^\/plan\/active\/versions\/\d+$/,
  /^\/progress\/[^/]+$/,
  /^\/coach\/[^/]+$/,
  /^\/evidence\/topics\/[^/]+$/,
  /^\/evidence\/[^/]+$/,
  /^\/settings\/[^/]+$/,
];

const pathname = (href) => {
  const part = href.split(/[?#]/, 1)[0];
  if (!part || !part.startsWith('/')) return null;
  try { return decodeURI(part).replace(/\/$/, '') || '/'; } catch { return null; }
};
const bundledFile = (target) => {
  const file = path.resolve(dist, `.${target}`);
  return file.startsWith(`${dist}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile();
};

export function scanVisibleCopy(text, route) {
  const copy = String(text ?? '');
  const path = String(route ?? '');
  return {
    forbiddenTextRules: scanForbidden(copy).length,
    forbiddenUrlRules: scanUrl(path).length,
    textRuleIds: FORBIDDEN.flatMap((rule, index) => rule.test(copy) ? [index + 1] : []),
    urlRuleIds: FORBIDDEN_URL.flatMap((rule, index) => rule.test(path) ? [index + 1] : []),
  };
}

/** `links` are DOM href attributes; `ids` are current-page element IDs. Only internal links are checked. */
export function scanInternalLinks(links, route, ids = []) {
  const current = pathname(route) ?? '/';
  const present = new Set(ids);
  const unknownRouteIndexes = [];
  const missingAnchorIndexes = [];
  links.forEach((link, index) => {
    const href = typeof link === 'string' ? link : link?.href;
    if (typeof href !== 'string' || !href || /^(?:https?:|mailto:|tel:|blob:|data:)/i.test(href)) return;
    const target = href.startsWith('#') || href.startsWith('?') ? current : pathname(href);
    if (!target) return;
    if (!literal.has(target) && !patterns.some((re) => re.test(target)) && !bundledFile(target)) unknownRouteIndexes.push(index);
    const hash = href.indexOf('#');
    if (hash >= 0 && target === current && href.length > hash + 1) {
      let id;
      try { id = decodeURIComponent(href.slice(hash + 1)); } catch { id = null; }
      if (!id || !present.has(id)) missingAnchorIndexes.push(index);
    }
  });
  return { unknownRouteIndexes, missingAnchorIndexes };
}

/** After the sweep, check anchors that point to another visited route. */
export function scanCrossRouteAnchors(pages) {
  const idsByPath = new Map();
  for (const page of pages) {
    const route = pathname(page.route);
    if (!route) continue;
    const ids = idsByPath.get(route) ?? new Set();
    for (const id of page.ids ?? []) ids.add(id);
    idsByPath.set(route, ids);
  }
  const missing = [];
  let unchecked = 0;
  pages.forEach((page, row) => {
    const current = pathname(page.route);
    (page.links ?? []).forEach((link, index) => {
      const href = typeof link === 'string' ? link : link?.href;
      if (typeof href !== 'string' || !href.startsWith('/')) return;
      const hash = href.indexOf('#');
      if (hash < 0 || hash === href.length - 1) return;
      const target = pathname(href);
      if (!target || target === current) return;
      const ids = idsByPath.get(target);
      if (!ids) { unchecked += 1; return; }
      let id;
      try { id = decodeURIComponent(href.slice(hash + 1)); } catch { id = null; }
      if (!id || !ids.has(id)) missing.push({ row, index });
    });
  });
  return { missing, unchecked };
}

let evidenceIds;
function evidenceContentIds() {
  if (evidenceIds) return evidenceIds;
  const mechanisms = new Set();
  const topics = new Set();
  const topicDir = path.join(root, 'src/content/evidence/topics');
  const files = fs.readdirSync(topicDir).filter((name) => name.endsWith('.ts'));
  for (const name of files) {
    const file = path.join(topicDir, name);
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'mechanisms' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const item of node.initializer.elements) {
          if (!ts.isObjectLiteralExpression(item)) continue;
          const id = item.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'id');
          if (id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) mechanisms.add(id.initializer.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const indexFile = path.join(root, 'src/content/evidence/index.ts');
  const source = ts.createSourceFile(indexFile, fs.readFileSync(indexFile, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'slug' && ts.isStringLiteral(node.initializer)) topics.add(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  evidenceIds = { mechanisms, topics };
  return evidenceIds;
}

/** Check evidence links against actual bundled content, beyond route-template matching. */
export function scanEvidenceLinks(links) {
  const { mechanisms, topics } = evidenceContentIds();
  const unknownMechanismIndexes = [];
  const unknownTopicIndexes = [];
  links.forEach((link, index) => {
    const href = typeof link === 'string' ? link : link?.href;
    if (typeof href !== 'string') return;
    const target = pathname(href);
    if (!target || !target.startsWith('/evidence/')) return;
    if (target.startsWith('/evidence/topics/')) {
      if (!topics.has(target.slice('/evidence/topics/'.length))) unknownTopicIndexes.push(index);
    } else if (target !== '/evidence/validation' && target !== '/evidence/topics' && !mechanisms.has(target.slice('/evidence/'.length))) {
      unknownMechanismIndexes.push(index);
    }
  });
  return { unknownMechanismIndexes, unknownTopicIndexes };
}
