// Production artifact checks for the web route sweep. Run after `pnpm build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const routes = read('src/app/routes.tsx');
const living = read('src/features/living/routes.tsx');
const intake = read('src/features/intake/paths.ts');
const required = {
  core: ['body', 'ring', 'signals', 'simulate', 'simulate/:sid', 'simulate/:sid/schedule', 'simulate/:sid/results', 'plan', 'plan/goals', 'plan/run', 'plan/results', 'onboarding', 'onboarding/:section'],
  public: ['safety', 'evidence', 'evidence/validation', 'evidence/:mechanismId', 'evidence/topics', 'evidence/topics/:topicSlug', 'settings', 'settings/:section', 'profile', 'simulator', 'planner', 'library'],
  living: ['today', 'today/:date', 'food', 'food/pantry', 'food/:date', 'train', 'train/:date', 'plan/active', 'plan/active/versions/:n', 'progress', 'progress/:metric', 'coach', 'coach/:conversationId'],
  dev: ['dev/components', 'dev/picker', 'dev/safety', 'dev/avatar', 'dev/figure', 'dev/error', 'dev/charts'],
};
for (const [group, paths] of Object.entries(required)) {
  const source = group === 'living' ? living : routes;
  check(`${group} route entries (${paths.length})`, paths.every((route) => source.includes(`path: '${route}'`)));
}
check('welcome and catch-all routes', routes.includes("path: '/welcome'") && routes.includes("path: '*'"));
check('all intake chapters', ['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers', 'devices', 'summary'].every((s) => intake.includes(`'${s}'`)));

const html = read('dist/index.html');
const firstLink = html.search(/<link\s[^>]*(?:rel="stylesheet"|rel="modulepreload")/);
const order = html.match(/<style>@layer\s+([^<;]+);<\/style>/)?.[1]?.replace(/\s/g, '');
check('cascade order declared before built styles', order === 'properties,theme,base,components,utilities' && html.indexOf('<style>@layer') < firstLink);
const cssLinks = [...html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
check('all entry CSS links exist', cssLinks.length >= 2 && cssLinks.every((href) => fs.existsSync(path.join(root, 'dist', href.slice(1)))));
const chunks = fs.readdirSync(path.join(root, 'dist/assets')).filter((name) => name.endsWith('.css'));
const shellCss = chunks.find((name) => name.startsWith('shell-'));
const entryCss = chunks.find((name) => name.startsWith('index-'));
check('shell CSS stays in components layer', !!shellCss && read(`dist/assets/${shellCss}`).startsWith('@layer components'));
check('entry CSS defines Tailwind layers', !!entryCss && ['properties', 'theme', 'base', 'components', 'utilities'].every((layer) => read(`dist/assets/${entryCss}`).includes(`@layer ${layer}`)));

const localHrefs = [...html.matchAll(/<(?:link|script)\s[^>]*(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
check('all local document links exist', localHrefs.every((href) => fs.existsSync(path.join(root, 'dist', href.slice(1)))));
const manifest = JSON.parse(read('dist/manifest.webmanifest'));
check('PWA icons exist', manifest.icons.length >= 5 && manifest.icons.every(({ src }) => fs.existsSync(path.join(root, 'dist', src.slice(1)))));
check('launch mark and CSS are bundled', html.includes('class="vitals-launch"') && fs.existsSync(path.join(root, 'dist/brand/launch.css')) && fs.existsSync(path.join(root, 'dist/brand/mark.svg')));

const release = read('src/features/home/release.ts');
const workflow = read('.github/workflows/release.yml');
const signer = read('scripts/release/sign-apk.sh');
const desktopAssets = ['Vitals-linux-x86_64.AppImage', 'Vitals-linux-amd64.deb', 'Vitals-windows-x64-setup.exe', 'Vitals-macos-universal.dmg'];
check('desktop download names match release workflow', desktopAssets.every((name) => release.includes(name) && workflow.includes(name)));
check('signed Android download name matches release script', release.includes("android: ['Vitals-android.apk']") && signer.includes('Vitals-android.apk'));

console.log(`${failures.length} static check failures`);
process.exitCode = failures.length ? 1 : 0;
