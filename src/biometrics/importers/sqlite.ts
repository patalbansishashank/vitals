/**
 * SQLite access port for importers (tier H). The production CSP has no 'wasm-unsafe-eval' (SUITE_SPEC §9.1, decision
 * 3), so no SQLite engine ships by default: importers take an injected `SqlOpener` (sql.js or similar, wired by the
 * app only once the CSP is signed off) and otherwise accept a JSON dump of the tables (`fromJsonDump`).
 *
 * JSON dump format: `{ "tables": { "<table>": [ { "<column>": <value>, ... }, ... ] } }`. BLOB values are hex strings.
 * One-liner (Python 3 stdlib) to produce it from a database file:
 *   python3 -c "import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;t=[r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")];print(json.dumps({'tables':{x:[{k:(v.hex() if isinstance(v,bytes) else v) for k,v in dict(r).items()} for r in c.execute(f'select * from \"{x}\"')] for x in t}}))" in.db > dump.json
 */
import { listZip, readZipEntry } from './zipReader';

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, unknown>;

/** Minimal read-only database port. */
export interface SqlDatabase {
  tables(): Promise<string[]>;
  columns(table: string): Promise<string[]>;
  query(sql: string, params?: unknown[]): Promise<SqlRow[]>;
}

/** Opens SQLite file bytes (injected; sql.js-backed in the app once the CSP allows WebAssembly). */
export type SqlOpener = (bytes: Uint8Array) => Promise<SqlDatabase>;

export class SqliteUnavailableError extends Error {
  constructor(what: string) {
    super(
      `${what} is a SQLite database and this build has no SQLite engine (it needs WebAssembly, which the current ` +
        `security policy does not allow). Convert it to a JSON dump instead (see docs/biometrics/sqlite-layouts.md) and import that file.`,
    );
    this.name = 'SqliteUnavailableError';
  }
}

export class UnsupportedSqliteInputError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnsupportedSqliteInputError';
  }
}

/** Case-insensitive column reader for one row (greenDAO uses UPPER_CASE, AOSP lower_case). */
export function rowReader(row: SqlRow): (name: string) => unknown {
  const m = new Map<string, unknown>();
  for (const k of Object.keys(row)) m.set(k.toLowerCase(), row[k]);
  return (name) => m.get(name.toLowerCase());
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** BLOB or hex/text id as a stable string. */
export function idText(v: unknown): string | undefined {
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('');
  if (Array.isArray(v)) return v.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
  if (typeof v === 'number') return String(v);
  return str(v);
}

/** Whole table; unknown tables give []. */
export async function rows(db: SqlDatabase, table: string): Promise<SqlRow[]> {
  const names = await db.tables();
  const hit = names.find((n) => n.toLowerCase() === table.toLowerCase());
  if (!hit) return [];
  return db.query(`SELECT * FROM "${hit.replace(/"/g, '""')}"`);
}

const SELECT_ALL = /^\s*select\s+\*\s+from\s+(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z0-9_]+))\s*;?\s*$/i;

/** In-memory database over a JSON dump. `query` supports only `SELECT * FROM <table>` (the importers' sole query form). */
export function fromJsonDump(json: string | unknown): SqlDatabase {
  const parsed: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  const tablesRaw = (parsed as { tables?: unknown } | null)?.tables;
  if (!tablesRaw || typeof tablesRaw !== 'object' || Array.isArray(tablesRaw)) {
    throw new UnsupportedSqliteInputError('Not a table dump: expected {"tables": {"<table>": [rows]}}.');
  }
  const tables = new Map<string, SqlRow[]>();
  for (const [name, v] of Object.entries(tablesRaw as Record<string, unknown>)) {
    tables.set(name, Array.isArray(v) ? (v.filter((r) => r && typeof r === 'object') as SqlRow[]) : []);
  }
  const find = (t: string): string | undefined => [...tables.keys()].find((k) => k.toLowerCase() === t.toLowerCase());
  return {
    tables: () => Promise.resolve([...tables.keys()]),
    columns: (t) => {
      const k = find(t);
      const cols = new Set<string>();
      for (const r of k ? (tables.get(k) ?? []) : []) for (const c of Object.keys(r)) cols.add(c);
      return Promise.resolve([...cols]);
    },
    query: (sql) => {
      const m = SELECT_ALL.exec(sql);
      if (!m) return Promise.reject(new Error(`JSON dump supports only SELECT * FROM <table>; got: ${sql}`));
      const k = find((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').replace(/""/g, '"'));
      return Promise.resolve(k ? (tables.get(k) ?? []) : []);
    },
  };
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

export function isSqliteHead(head: Uint8Array): boolean {
  if (head.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (head[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}
export const isZipHead = (h: Uint8Array): boolean => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5);
export function isJsonHead(h: Uint8Array): boolean {
  for (const b of h) {
    if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0xef || b === 0xbb || b === 0xbf) continue;
    return b === 0x7b;
  }
  return false;
}

/** Sniffer shared by SQLite-family importers: SQLite file, ZIP, or JSON dump. */
export const sniffSqliteFamily = (h: Uint8Array): boolean => isSqliteHead(h) || isZipHead(h) || isJsonHead(h);

/**
 * Turns an import Blob (JSON dump, SQLite file, or ZIP containing either) into a database. JSON never needs an engine;
 * SQLite needs `opener`, otherwise throws SqliteUnavailableError.
 */
export async function openInput(input: Blob, opener: SqlOpener | undefined, label: string): Promise<SqlDatabase> {
  let blob = input;
  let head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (isZipHead(head)) {
    const entries = await listZip(blob);
    const pick =
      entries.find((e) => /\.(db|sqlite|sqlite3)$/i.test(e.name)) ?? entries.find((e) => /\.json$/i.test(e.name));
    if (!pick) throw new UnsupportedSqliteInputError(`${label}: the ZIP holds no .db or .json file.`);
    blob = new Blob([(await readZipEntry(blob, pick)) as BlobPart]);
    head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  }
  if (isJsonHead(head)) {
    const text = await blob.text();
    return fromJsonDump(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  }
  if (isSqliteHead(head)) {
    if (!opener) throw new SqliteUnavailableError(label);
    return opener(new Uint8Array(await blob.arrayBuffer()));
  }
  throw new UnsupportedSqliteInputError(`${label}: not a SQLite database, a ZIP of one, or a JSON table dump.`);
}
