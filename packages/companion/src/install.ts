/**
 * `vitals-companion install` (a wrapper on PATH) and `vitals-companion service` (a systemd user unit and the matching
 * `tailscale serve` command). Both print what they do; both are reversible by deleting one file.
 *
 * Why a wrapper and not `pnpm link --global`: the bin runs the TypeScript sources through Node's type stripping, which
 * refuses files under `node_modules`, and a wrapper pins both the Node binary and the checkout it runs from, so a GUI
 * app (the ChatGPT desktop app) whose PATH lacks the owner's shell setup still starts the same program.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFile, xdgConfigHome, xdgDataHome, type Sys } from './sys.ts';

export const WRAPPER_MARKER = '# vitals-companion wrapper';
export const UNIT_NAME = 'vitals-companion.service';
export const DEFAULT_HTTPS_PORT = 8443;

/** The package root this code runs from (…/packages/companion). */
export const packageRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function wrapperScript(nodePath: string, root: string): string {
  return [
    '#!/bin/sh',
    `${WRAPPER_MARKER} (written by \`vitals-companion install\`; delete this file to uninstall).`,
    '# Set VITALS_COMPANION_ROOT to run another checkout of packages/companion.',
    `VITALS_COMPANION_ROOT="\${VITALS_COMPANION_ROOT:-${root.replace(/(["$`\\])/g, '\\$1')}}"`,
    `exec ${shQuote(nodePath)} "$VITALS_COMPANION_ROOT/bin/vitals-companion.mjs" "$@"`,
    '',
  ].join('\n');
}

/** The root a wrapper points at, or null when the file is not our wrapper. */
export function wrapperRoot(text: string | null): string | null {
  if (!text || !text.includes(WRAPPER_MARKER)) return null;
  return /VITALS_COMPANION_ROOT:-(.*)}"$/m.exec(text)?.[1]?.replace(/\\(["$`\\])/g, '$1') ?? null;
}

export const defaultBinDir = (sys: Sys) => join(sys.home, '.local', 'bin');

export interface InstallResult {
  path: string;
  changed: boolean;
  lines: string[];
}

export async function installWrapper(sys: Sys, opts: { binDir?: string; root?: string; force?: boolean; dryRun?: boolean } = {}): Promise<InstallResult> {
  const path = join(opts.binDir ?? defaultBinDir(sys), 'vitals-companion');
  const root = opts.root ?? packageRoot();
  const script = wrapperScript(sys.execPath, root);
  const existing = await sys.readText(path);
  if (existing === script) return { path, changed: false, lines: [`${path} is already installed and points at ${root}.`] };
  if (existing !== null && wrapperRoot(existing) === null && !opts.force) {
    return { path, changed: false, lines: [`${path} exists and is not a Vitals wrapper; left alone. Use --force to replace it (a backup is kept).`] };
  }
  if (opts.dryRun) return { path, changed: false, lines: [`Would write ${path}:`, script] };
  const backup = existing !== null ? await backupFile(sys, path) : null;
  await sys.writeText(path, script, 0o755);
  const onPath = (sys.env.PATH ?? '').split(':').includes(dirname(path));
  return {
    path,
    changed: true,
    lines: [
      `Wrote ${path} (runs ${root} with ${sys.execPath}).`,
      ...(backup ? [`Backup of the previous file: ${backup}`] : []),
      onPath ? 'It is on your PATH: run vitals-companion doctor.' : `${dirname(path)} is not on PATH. fish: fish_add_path ${dirname(path)}`,
      `Uninstall: rm ${path}`,
    ],
  };
}

/* ---- systemd user unit ------------------------------------------------------------------------------------------ */

export type ServiceRole = 'sync' | 'proxy' | 'serve';

export interface UnitOptions {
  role: ServiceRole;
  /** Absolute path of node. */
  nodePath: string;
  /** packages/companion root. */
  root: string;
  port: number;
  /** Data directory (relay store, blobs). */
  dataDir: string;
  /** Config directory (proxy and serve only). */
  configDir?: string;
  /** serve only. */
  dist?: string;
}

/** systemd splits ExecStart= and ReadWritePaths= on spaces; double quotes keep a path with spaces whole. */
const unitQuote = (s: string) => (/[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s);
/** systemd expands `%` specifiers in every path setting and `$VAR` in ExecStart=; `%%` and `$$` keep them literal. */
const unitEscape = (s: string) => s.replace(/%/g, '%%');
const execArg = (s: string) => unitQuote(unitEscape(s).replace(/\$/g, '$$$$'));

export function unitFile(o: UnitOptions): string {
  const args = [o.role, '--host', '127.0.0.1', '--port', String(o.port), '--data', o.dataDir];
  if (o.role !== 'sync' && o.configDir) args.push('--config-dir', o.configDir);
  if (o.role === 'serve' && o.dist) args.push('--dist', o.dist);
  const rw = [o.dataDir, ...(o.role !== 'sync' && o.configDir ? [o.configDir] : [])];
  return [
    '# Vitals Companion as a systemd user unit (written by `vitals-companion service --write`).',
    '# Install: systemctl --user daemon-reload && systemctl --user enable --now vitals-companion',
    '# Undo:    systemctl --user disable --now vitals-companion && rm ~/.config/systemd/user/vitals-companion.service',
    '# Boot without login needs lingering: loginctl enable-linger $USER',
    '[Unit]',
    `Description=Vitals Companion (${o.role}; loopback only, reach it through tailscale serve)`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${unitEscape(o.root)}`,
    `ExecStart=${[o.nodePath, join(o.root, 'bin', 'vitals-companion.mjs'), ...args].map(execArg).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=5',
    'Environment=NODE_ENV=production',
    'NoNewPrivileges=yes',
    'PrivateTmp=yes',
    'ProtectSystem=strict',
    `ReadWritePaths=${rw.map((p) => unitQuote(unitEscape(p))).join(' ')}`,
    'UMask=0077',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export const unitPath = (sys: Sys) => join(xdgConfigHome(sys), 'systemd', 'user', UNIT_NAME);
export const defaultDataDir = (sys: Sys) => join(xdgDataHome(sys), 'vitals-companion');

/** `tailscale serve` on a port other than 443, so a web server already on the tailnet address keeps its sites. */
export function serveCommand(port: number, httpsPort = DEFAULT_HTTPS_PORT): string {
  return `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`;
}

export async function writeUnit(sys: Sys, unit: string, opts: { dryRun?: boolean; dataDir?: string; configDir?: string } = {}): Promise<InstallResult> {
  const path = unitPath(sys);
  const existing = await sys.readText(path);
  // The unit's ReadWritePaths= must exist before systemd starts it (ProtectSystem=strict fails at NAMESPACE otherwise).
  const created: string[] = [];
  if (!opts.dryRun) {
    for (const dir of [opts.dataDir, opts.configDir]) {
      if (dir && !(await sys.stat(dir))) {
        await sys.mkdir(dir, 0o700);
        created.push(`Created ${dir}.`);
      }
    }
  }
  if (existing === unit) return { path, changed: false, lines: [...created, `${path} is already up to date.`] };
  if (opts.dryRun) return { path, changed: false, lines: [`Would write ${path}.`] };
  const backup = existing !== null ? await backupFile(sys, path) : null;
  await sys.writeText(path, unit, 0o644);
  return { path, changed: true, lines: [...created, `Wrote ${path}.`, ...(backup ? [`Backup: ${backup}`] : [])] };
}
