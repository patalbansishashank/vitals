/**
 * Start with the computer (SUITE_SPEC §15.6). Off by default. Windows and macOS use the login item; Linux writes an
 * XDG autostart entry that carries a marker line, so a file that is not ours is never read as ours or deleted.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FLAGS } from '../shared/bridge';

export interface Autostart {
  get(): Promise<boolean>;
  set(on: boolean): Promise<void>;
}

export interface AutostartOptions {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** The command a login start runs (the AppImage path when running from an AppImage). */
  command: { path: string; args: string[] };
  app: {
    getLoginItemSettings(o?: object): { openAtLogin: boolean };
    setLoginItemSettings(s: object): void;
  };
}

const MARKER = '# Managed by Vitals. Delete this file or turn off "Start with my computer" to stop it.';
const RESERVED = /[\s"'\\<>~|&;$*?#()`]/;

/** One argument of an `Exec=` line, quoted per the Desktop Entry spec (quotes, then the file-level backslash rule). */
export function execQuote(arg: string): string {
  const arg2 = arg.replace(/%/g, '%%');
  if (arg2 !== '' && !RESERVED.test(arg2)) return arg2;
  return `"${arg2.replace(/["`$\\]/g, '\\$&').replace(/\\/g, '\\\\')}"`;
}

/** The text of vitals.desktop. */
export function desktopEntry(command: { path: string; args: string[] }): string {
  const args = command.args.includes(FLAGS.hidden) ? command.args : [...command.args, FLAGS.hidden];
  return [
    '[Desktop Entry]',
    MARKER,
    'Type=Application',
    'Name=Vitals',
    'Comment=Starts Vitals in the tray when you sign in',
    `Exec=${[command.path, ...args].map(execQuote).join(' ')}`,
    'Icon=vitals',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function createAutostart(o: AutostartOptions): Autostart {
  const args = o.command.args.includes(FLAGS.hidden) ? o.command.args : [...o.command.args, FLAGS.hidden];

  if (o.platform === 'win32') {
    const q = { path: o.command.path, args };
    return {
      async get() {
        return o.app.getLoginItemSettings(q).openAtLogin;
      },
      async set(on) {
        o.app.setLoginItemSettings({ openAtLogin: on, ...q });
      },
    };
  }
  if (o.platform === 'darwin') {
    return {
      async get() {
        return o.app.getLoginItemSettings().openAtLogin;
      },
      async set(on) {
        o.app.setLoginItemSettings({ openAtLogin: on, args });
      },
    };
  }

  const xdg = o.env.XDG_CONFIG_HOME;
  const dir = path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(o.home, '.config'), 'autostart');
  const file = path.join(dir, 'vitals.desktop');
  const ours = async (): Promise<boolean> => {
    try {
      return (await readFile(file, 'utf8')).includes(MARKER);
    } catch {
      return false;
    }
  };
  return {
    get: ours,
    async set(on) {
      if (on) {
        await mkdir(dir, { recursive: true });
        await writeFile(file, desktopEntry(o.command), 'utf8');
      } else if (await ours()) {
        await rm(file, { force: true });
      }
    },
  };
}
