import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// Checked-in fixtures, benchmark snapshots and desktop packaging assets are source, even when generated originally.
// Only transient output trees are excluded; all other nonignored new files are included as well as tracked files.
const OUTPUT = /(^|\/)(?:node_modules|\.git|\.gradle|\.kotlin|\.vitest|coverage|\.netlify|\.e6-tmp|\.tmp-bundle|bench-results)(\/|$)|^apps\/[^/]+\/(?:dist|release)\/|^apps\/android\/android\/[^/]+\/build\/|^dist\/|^qa\/results\/\.timing\/|\.tsbuildinfo$/;
const DEFAULT_LIMITS = { files: 50_000, fileBytes: 64 * 1024 * 1024, totalBytes: 512 * 1024 * 1024 };
function sourceStatus(raw) {
  const entries = raw.split('\0');
  const kept = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const path = entry.slice(3);
    const old = /[RC]/.test(entry.slice(0, 2)) ? entries[++i] : null;
    if (!OUTPUT.test(path) || (old && !OUTPUT.test(old))) kept.push([entry, old]);
  }
  return JSON.stringify(kept);
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
const outside = (root, path) => { const rel = relative(root, path); return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel); };

export function sourceFingerprint(directory = process.cwd(), limits = {}) {
  const root = realpathSync(directory);
  const cap = { ...DEFAULT_LIMITS, ...limits };
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) throw new Error('Source fingerprint must start at the repository root');
  const commit = git('rev-parse', 'HEAD').trim();
  const status = sourceStatus(git('status', '--porcelain=v1', '-z', '--untracked-files=all'));
  const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))]
    .filter((path) => !OUTPUT.test(path)).sort();
  if (paths.length > cap.files) throw new Error(`Source fingerprint exceeds ${cap.files} files`);
  const hash = createHash('sha256');
  const mutations = createHash('sha256');
  let bytes = 0;
  let symlinks = 0;
  // Frame each value so paths and contents cannot create ambiguous concatenations.
  const field = (value) => { const data = Buffer.from(String(value)); hash.update(`${data.length}:`).update(data); };
  field('vitals-source-v1');
  const chunk = Buffer.alloc(64 * 1024);
  for (const path of paths) {
    const full = resolve(root, path);
    if (outside(root, full)) throw new Error(`Source path escapes repository: ${path}`);
    field(path);
    mutations.update(JSON.stringify(path));
    // A tracked directory replaced by a link must never make us read another tree's contents.
    for (let parent = dirname(full); parent !== root; parent = dirname(parent)) {
      try {
        if (lstatSync(parent).isSymbolicLink()) throw new Error(`Source has a symlink parent: ${path}`);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    let stat;
    try { stat = lstatSync(full, { bigint: true }); }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      field('missing');
      mutations.update('missing');
      continue;
    }
    mutations.update(`${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs};`);
    if (stat.isSymbolicLink()) {
      field('symlink');
      field(readlinkSync(full)); // Record the link itself; never traverse its target, inside or outside the repository.
      symlinks++;
      continue;
    }
    if (!stat.isFile()) throw new Error(`Source is not a regular file or symlink: ${path}`);
    if (stat.size > BigInt(cap.fileBytes)) throw new Error(`Source file exceeds fingerprint size limit: ${path}`);
    bytes += Number(stat.size);
    if (bytes > cap.totalBytes) throw new Error(`Source fingerprint exceeds ${cap.totalBytes} bytes`);
    const canonical = realpathSync(full);
    if (outside(root, canonical)) throw new Error(`Source path escapes repository: ${path}`);
    const fd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd, { bigint: true });
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error(`Source changed while fingerprinting: ${path}`);
      const contents = createHash('sha256');
      let read = 0;
      for (;;) {
        const size = readSync(fd, chunk, 0, chunk.length, null);
        if (!size) break;
        read += size;
        if (read > cap.fileBytes || read > Number(stat.size)) throw new Error(`Source changed while fingerprinting: ${path}`);
        contents.update(chunk.subarray(0, size));
      }
      const after = fstatSync(fd, { bigint: true });
      if (read !== Number(stat.size) || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) throw new Error(`Source changed while fingerprinting: ${path}`);
      field('file');
      field(Number(stat.mode & 0o111n));
      field(contents.digest('hex'));
    } finally { closeSync(fd); }
  }
  if (git('rev-parse', 'HEAD').trim() !== commit || sourceStatus(git('status', '--porcelain=v1', '-z', '--untracked-files=all')) !== status) {
    throw new Error('Git source state changed while fingerprinting');
  }
  return { algorithm: 'sha256', version: 1, commit, dirty: status !== '[]', statusDigest: digest(status), digest: hash.digest('hex'), mutationDigest: mutations.digest('hex'), files: paths.length, bytes, symlinks };
}

export function sourceChanges(start, end) {
  if (start.commit === end.commit && start.digest === end.digest && start.statusDigest === end.statusDigest && start.mutationDigest === end.mutationDigest) return [];
  return ['Working source or Git state changed during validation. Run the complete gate again on the final source.'];
}
