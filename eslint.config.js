import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Layering rules (docs/SUITE_SPEC.md §0.2, §1.1, §9.3; docs/COMMANDS.md).
 *
 *   tier P (pure)      src/engine, src/catalogues, src/living, src/biometrics/core, src/ai/briefing, src/commands/schema
 *   tier H (headless)  src/commands (except schema), src/store, src/sync, src/ai (except ui), src/biometrics/{importers,ble,ingest,store},
 *                      packages/companion: no React / UI layers, no window / document / localStorage (the BLE transport
 *                      src/biometrics/ble/webBluetooth.ts is the one module that reads `navigator`)
 *   network            fetch / WebSocket / EventSource / XMLHttpRequest only in src/net (and workers); everything else
 *                      calls netFetch / netWebSocket, which check the origin allowlist (the CSP allows any https/wss)
 *   strict store       user data changes only through commands: no `useXStore.setState(...)` and no `@/state/internal/*`
 *                      outside src/commands and src/state; transactions and write tokens only in commands, state, store, sync
 *   planRegimes        the v1 planner wrapper is deprecated (PLANNER_V2_SPEC §9.6, "no new code may call it"): importing it
 *                      is an error everywhere except src/workers and the two planner-feature files that hold the fallback.
 *                      The rule sees static imports, re-exports, `x.planRegimes` and `{ planRegimes } = …` (so a dynamic
 *                      `(await import(...)).planRegimes` is caught too); a computed name (`x['planRegimes']`) is not.
 *
 * Flat config: a rule set in a later block replaces the same rule from an earlier block for the files both match, so
 * the tier blocks below repeat the network bans in their own lists. The same goes for the strict-store imports and the
 * planRegimes ban: every block that sets `no-restricted-imports` (or `no-restricted-syntax`) lists them again, and the
 * exemption blocks at the end of the file restore everything but the one thing they lift.
 */

const TESTS = ['**/__tests__/**', '**/*.test.{ts,tsx}', 'tests/**', '**/*bench*'];

// Network calls go through src/net/net.ts only (allowlist; the CSP allows any https/wss origin).
const NET_MESSAGE = 'Use netFetch / netWebSocket from src/net/net.ts (allowlisted network access).';
const NET_GLOBALS = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest'].map((name) => ({ name, message: NET_MESSAGE }));
const NET_PROPERTIES = [
  ['window', 'fetch'],
  ['globalThis', 'fetch'],
  ['self', 'fetch'],
  ['window', 'WebSocket'],
  ['globalThis', 'WebSocket'],
  ['self', 'WebSocket'],
  ['window', 'EventSource'],
  ['globalThis', 'EventSource'],
].map(([object, property]) => ({ object, property, message: NET_MESSAGE }));

const STORES = 'Profile|Schedule|Simulation|Planner|Settings|Safety';
const STRICT_STORE_SYNTAX = [
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.property.name='setState'][callee.object.name=/^use(${STORES})Store$/]`,
    message: 'Change user data with a command (dispatch from @/commands); the stores are projections of the documents.',
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='transact']",
    message: 'Document transactions belong to commands, sync, the store runtime and its migration (SUITE_SPEC §2.4).',
  },
];
const STATE_INTERNAL = { group: ['@/state/internal', '@/state/internal/*'], message: 'Store actions are for commands only: dispatch a command instead.' };
const WRITE_TOKENS = { name: '@/store', importNames: ['mintWriteToken', 'revokeWriteToken'], message: 'Write tokens are minted by the dispatcher, sync, the migration and derive jobs.' };
const NO_CONFIRM_FOR_AGENTS = [
  { name: '@/commands', importNames: ['mintConfirmation'], message: 'Only confirm dialogs mint confirmation tokens: an agent never confirms for the person.' },
  { name: '@/commands/confirm', importNames: ['mintConfirmation'], message: 'Only confirm dialogs mint confirmation tokens: an agent never confirms for the person.' },
];

// Deprecated v1 planner wrapper (PLANNER_V2_SPEC §9.6). Names the import by its last path segment, so the alias
// (@/workers/plannerClient, @/features/planner/plannerClient) and relative paths (./plannerClient) are all caught.
const PLAN_REGIMES_MESSAGE = '`planRegimes` is the deprecated v1 planner wrapper (PLANNER_V2_SPEC §9.6): call `planLadder` instead.';
const PLAN_REGIMES_IMPORT = { group: ['**/plannerClient', '**/plannerClient.ts'], importNames: ['planRegimes'], message: PLAN_REGIMES_MESSAGE };
const PLAN_REGIMES_SYNTAX = [
  { selector: "MemberExpression[property.name='planRegimes']", message: PLAN_REGIMES_MESSAGE },
  { selector: "ObjectPattern > Property[key.name='planRegimes']", message: PLAN_REGIMES_MESSAGE },
];
// The only places that may name it: the worker client that defines it and the planner feature's fallback path.
const PLAN_REGIMES_ALLOWED = ['src/workers/**/*.{ts,tsx}', 'src/features/planner/run.ts', 'src/features/planner/plannerClient.ts'];

const HEADLESS_IMPORTS = [
  { group: ['react', 'react-dom', 'react-*', 'react/*', 'react-router', 'zustand', 'zustand/*'], message: 'Headless packages stay framework-free.' },
  { group: ['@/app/*', '@/components/*', '@/features/*'], message: 'Headless packages must not import the UI.' },
];
const HEADLESS_GLOBALS = ['window', 'document', 'localStorage'];
// The Web Bluetooth transport is the one headless module that may read `navigator` (for `navigator.bluetooth`).
const NO_NAVIGATOR = { name: 'navigator', message: 'Only src/biometrics/ble/webBluetooth.ts touches navigator.bluetooth; take a BleLink instead.' };

const PURE_GLOBALS = ['window', 'document', 'localStorage', 'navigator', 'indexedDB', ...NET_GLOBALS];
const PURE_PROPERTIES = [
  { object: 'Date', property: 'now', message: 'Pure code takes the time as input.' },
  { object: 'Math', property: 'random', message: 'Pure code is deterministic: take a seeded generator as input.' },
];
const PURE_SYNTAX = [{ selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Pure code takes the time as input (no `new Date()`).' }];
const PURE_IMPORTS = [
  { group: ['react', 'react-dom', 'react-router', 'zustand', 'zustand/*'], message: 'Pure packages stay framework-free.' },
  { group: ['@/app/*', '@/components/*', '@/features/*', '@/state/*', '@/workers/*', '@/store', '@/store/*'], message: 'Pure packages must not import the UI, state or storage layers.' },
  { group: ['@/net', '@/net/*', '@/sync', '@/sync/*'], message: 'Pure packages do no IO.' },
  { group: ['@/commands', '@/commands/*', '!@/commands/schema', '!@/commands/schema/*'], message: 'Pure packages may use the command schemas only.' },
];
const TIER_P = ['src/engine/**/*.ts', 'src/catalogues/**/*.ts', 'src/living/**/*.ts', 'src/biometrics/core/**/*.ts', 'src/ai/briefing/**/*.ts', 'src/commands/schema/**/*.ts'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'docs', 'research', 'design', 'coverage', '.tmp-bundle', '.e6-tmp/**', 'apps/*/dist/**', 'apps/*/release/**', 'apps/android/android/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.worker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Network: only src/net (and the workers) touch fetch / WebSocket directly.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    ignores: ['src/net/**', 'src/workers/**'],
    rules: {
      'no-restricted-globals': ['error', ...NET_GLOBALS],
      'no-restricted-properties': ['error', ...NET_PROPERTIES],
    },
  },
  {
    // The Companion is a Node program with its own network code.
    files: ['packages/companion/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // planRegimes (deprecated v1 planner wrapper): nobody imports it. Base rule for every file; the blocks below that set
    // these two rules again list the ban themselves, and the last block lifts it for the files allowed to hold it.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PLAN_REGIMES_IMPORT] }],
      'no-restricted-syntax': ['error', ...PLAN_REGIMES_SYNTAX],
    },
  },
  {
    // Strict store: everything outside the command and state layers writes through commands.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/commands/**', 'src/state/**', 'src/store/**', 'src/sync/**', ...TESTS],
    rules: {
      'no-restricted-imports': ['error', { paths: [WRITE_TOKENS], patterns: [STATE_INTERNAL, PLAN_REGIMES_IMPORT] }],
      'no-restricted-syntax': ['error', ...STRICT_STORE_SYNTAX, ...PLAN_REGIMES_SYNTAX],
    },
  },
  {
    // Tests may seed state, but never reach into store internals.
    files: TESTS.filter((g) => g !== 'tests/**').map((g) => (g.startsWith('**') ? `src/${g}` : g)),
    ignores: ['src/commands/**', 'src/state/**', 'src/store/**', 'src/sync/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [STATE_INTERNAL, PLAN_REGIMES_IMPORT] }] },
  },
  {
    // Tier P: pure, no IO, no app layers (engine tests included, as before; other packages' tests may use fixtures from elsewhere).
    files: TIER_P,
    ignores: TESTS.map((g) => (g.startsWith('**') ? `src/{catalogues,living,biometrics,ai,commands}/${g}` : g)),
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: [...PURE_IMPORTS, PLAN_REGIMES_IMPORT] }],
      'no-restricted-globals': ['error', ...PURE_GLOBALS],
    },
  },
  {
    // Tier P, deterministic: no clock, no randomness (engine run telemetry via performance.now stays allowed).
    files: TIER_P,
    ignores: TESTS,
    rules: {
      'no-restricted-properties': ['error', ...PURE_PROPERTIES, ...NET_PROPERTIES],
      'no-restricted-syntax': ['error', ...PURE_SYNTAX, ...STRICT_STORE_SYNTAX, ...PLAN_REGIMES_SYNTAX],
    },
  },
  {
    // Tier H: headless (browser main thread, workers, Node); IO only through injected ports.
    files: ['src/commands/**/*.ts', 'src/store/**/*.ts', 'src/sync/**/*.ts'],
    ignores: ['src/commands/schema/**', ...TESTS],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...HEADLESS_IMPORTS, PLAN_REGIMES_IMPORT] }],
      'no-restricted-globals': ['error', ...HEADLESS_GLOBALS, ...NET_GLOBALS],
    },
  },
  {
    // Tier H, biometrics (SUITE_SPEC §9.3): importers, BLE drivers, the ingest pipeline and the store have no React, no UI
    // layers, no DOM and no localStorage, and nothing but the Web Bluetooth transport (exempted below) reads `navigator`.
    // They are not in the commands/state/sync group above, so the strict-store imports are listed here again.
    files: ['src/biometrics/{importers,ble,ingest,store}/**/*.ts'],
    ignores: TESTS,
    rules: {
      'no-restricted-imports': ['error', { paths: [WRITE_TOKENS], patterns: [STATE_INTERNAL, ...HEADLESS_IMPORTS, PLAN_REGIMES_IMPORT] }],
      'no-restricted-globals': ['error', ...HEADLESS_GLOBALS, NO_NAVIGATOR, ...NET_GLOBALS],
    },
  },
  {
    // src/sync is the storage engine: it must not reach back into the app state layer either.
    files: ['src/sync/**/*.ts'],
    ignores: TESTS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-*', 'react/*', 'zustand', 'zustand/*'], message: 'src/sync must stay framework-free.' },
            { group: ['@/features/*', '@/app/*', '@/components/*', '@/state/*'], message: 'src/sync must not import from the UI layers.' },
            PLAN_REGIMES_IMPORT,
          ],
        },
      ],
    },
  },
  {
    // The AI layer is headless (tier H, SUITE_SPEC §0.2): no React, no DOM, no UI layers, no localStorage; agents never
    // confirm for the person (SUITE_SPEC §1.4).
    files: ['src/ai/**/*.ts'],
    ignores: ['src/ai/ui/**', 'src/ai/briefing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [WRITE_TOKENS, ...NO_CONFIRM_FOR_AGENTS],
          patterns: [
            { group: ['react', 'react-dom', 'react-router', 'zustand', 'zustand/*'], message: 'src/ai is headless.' },
            { group: ['@/app/*', '@/components/*', '@/features/*', '@/state/*'], message: 'src/ai must not import UI layers.' },
            PLAN_REGIMES_IMPORT,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        { name: 'localStorage', message: 'Keys and AI data never go to localStorage.' },
        { name: 'sessionStorage', message: 'Keys and AI data never go to sessionStorage.' },
        ...NET_GLOBALS,
      ],
      'no-console': 'error',
    },
  },
  {
    // Agents never confirm destructive commands for the person (SUITE_SPEC §1.4). These UI-side paths keep the strict-store
    // imports (this block replaces the rule for them).
    files: ['src/ai/ui/**/*.{ts,tsx}', 'src/agents/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: [WRITE_TOKENS, ...NO_CONFIRM_FOR_AGENTS], patterns: [STATE_INTERNAL, PLAN_REGIMES_IMPORT] }] },
  },
  {
    // Command adapters are tier H too (tool manifests for agents): headless imports plus the confirmation rule.
    files: ['src/commands/adapters/**/*.ts'],
    ignores: TESTS,
    rules: { 'no-restricted-imports': ['error', { paths: NO_CONFIRM_FOR_AGENTS, patterns: [...HEADLESS_IMPORTS, PLAN_REGIMES_IMPORT] }] },
  },
  {
    // The Companion (Node): headless, never confirms for the person. It makes its own outbound requests (proxy, relay,
    // sign-in), so the network globals are not banned here.
    files: ['packages/companion/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/companion/spike/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: NO_CONFIRM_FOR_AGENTS, patterns: HEADLESS_IMPORTS }],
      'no-restricted-globals': ['error', ...HEADLESS_GLOBALS],
    },
  },
  {
    // The one module that reads `navigator.bluetooth`: the tier H biometrics rules minus the `navigator` ban.
    files: ['src/biometrics/ble/webBluetooth.ts'],
    rules: { 'no-restricted-globals': ['error', ...HEADLESS_GLOBALS, ...NET_GLOBALS] },
  },
  {
    // planRegimes may be named here: the worker client that defines it and the planner feature's fallback path. Everything
    // else these files were restricted by (strict store) is restored.
    files: PLAN_REGIMES_ALLOWED,
    ignores: TESTS,
    rules: {
      'no-restricted-imports': ['error', { paths: [WRITE_TOKENS], patterns: [STATE_INTERNAL] }],
      'no-restricted-syntax': ['error', ...STRICT_STORE_SYNTAX],
    },
  },
  {
    // Tests of the worker client may call it too (they still may not reach into store internals).
    files: ['src/workers/**/__tests__/**', 'src/workers/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [STATE_INTERNAL] }], 'no-restricted-syntax': 'off' },
  },
);
