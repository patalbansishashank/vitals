#!/usr/bin/env node
// Prints categories and safe, relative artifact paths only. Never prints matched bytes.
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(process.cwd())
const args = process.argv.slice(2)
const privateHostSourceIndex = args.indexOf('--private-host-source')
let privateHostSource
if (privateHostSourceIndex !== -1) {
  privateHostSource = args[privateHostSourceIndex + 1]
  if (!privateHostSource) throw new Error('Missing --private-host-source value')
  args.splice(privateHostSourceIndex, 2)
}
const targets = args.length ? args : ['dist', 'apps/android/android/app/build/outputs/apk/debug/app-debug.apk', 'apps/desktop/release']
const findings = new Map()
const coverage = []
const maxFile = 200 * 1024 * 1024
const overlap = 4096
let files = 0

const checks = [
  ['source-map-reference', /(?:sourceMappingURL\s*=|"sourcesContent"\s*:)/gi],
  ['private-source-path', /(?:\/(?:home|Users|media)\/[^\s"'<>]{1,180}|[A-Z]:\\(?:Users|Documents and Settings)\\[^\s"'<>]{1,180})/gi],
  ['private-network-address', /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1(?:[01]\d|2[0-7]))\.(?:\d{1,3}\.)\d{1,3})\b|\b[a-z0-9.-]+\.(?:ts\.net|local|internal)\b/gi],
  ['credential-shape', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16}|sk_(?:live|test)_[A-Za-z0-9]{20,})\b/gi],
  ['embedded-credential-assignment', /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password)\s*[=:]\s*["'][A-Za-z0-9+/_=-]{20,}["']/gi],
  ['possible-personal-email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['ble-frame-console-log', /console\.(?:log|debug|info|warn)\s*\([^)]{0,200}\b(?:ble|frame|packet|payload|characteristic|notification|authBytes)\b/gi],
]

if (privateHostSource) {
  // Read only a caller-selected, non-secret text file. Values stay in memory.
  const source = await readFile(privateHostSource, 'utf8')
  const hosts = new Set()
  for (const match of source.matchAll(/https?:\/\/([^\s/:)"']+)/g)) {
    const host = match[1].toLowerCase()
    if (host !== 'localhost' && host.includes('.')) hosts.add(host)
  }
  if (hosts.size) {
    const escaped = [...hosts].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    checks.push(['owner-host-identifier', new RegExp(escaped.join('|'), 'gi')])
  }
}

function safePath(path) {
  const raw = relative(root, path)
  if (raw.startsWith('..' + sep) || raw === '..' || isAbsolute(raw)) return '[outside-worktree]'
  // Avoid copying unexpected identifying archive member names into the report.
  return raw.split(sep).map(part => {
    const marker = /^\[(archive-member|asar-member)\](\.[A-Za-z0-9]+)?$/.exec(part)
    if (marker) return `${marker[1]}${marker[2] ?? ''}`
    return /^[A-Za-z0-9_.@+-]+$/.test(part) ? part : '[redacted-name]'
  }).join('/')
}

function add(path, category, count = 1) {
  const key = `${safePath(path)}\t${category}`
  findings.set(key, (findings.get(key) ?? 0) + count)
}

function scanText(path, text) {
  for (const [category, regex] of checks) {
    regex.lastIndex = 0
    let count = 0
    while (regex.exec(text)) {
      count++
      if (count >= 1000) break
    }
    if (count) add(path, category, count)
  }
}

async function scanFile(path) {
  const stat = await lstat(path)
  if (!stat.isFile()) return
  if (extname(path) === '.map') add(path, 'source-map-file')
  files++
  await scanStream(path, createReadStream(path, { highWaterMark: 1024 * 1024 }))
  if (extname(path) === '.asar') await scanAsar(path, path)
}

async function scanStream(reportPath, stream) {
  let tail = ''
  for await (const chunk of stream) {
    const text = tail + chunk.toString('latin1')
    scanText(reportPath, text)
    tail = text.slice(-overlap)
  }
}

async function scanAsar(actual, reportPath) {
  const handle = await open(actual, 'r')
  try {
    const prefix = Buffer.alloc(8)
    if ((await handle.read(prefix, 0, 8, 0)).bytesRead !== 8) throw new Error('Short ASAR header')
    const headerSize = prefix.readUInt32LE(4)
    if (headerSize > 32 * 1024 * 1024) throw new Error('ASAR header too large')
    const header = Buffer.alloc(headerSize)
    if ((await handle.read(header, 0, headerSize, 8)).bytesRead !== headerSize) throw new Error('Short ASAR header')
    const jsonLength = header.readUInt32LE(4)
    const tree = JSON.parse(header.subarray(8, 8 + jsonLength).toString('utf8'))
    const dataOffset = 8 + headerSize
    let count = 0
    async function visit(node, name = '') {
      if (node.files) {
        for (const [childName, child] of Object.entries(node.files)) await visit(child, childName)
      } else if (!node.unpacked && node.size > 0 && node.size <= maxFile && /^\d+$/.test(node.offset ?? '')) {
        const start = dataOffset + Number(node.offset)
        files++
        count++
        const member = join(reportPath, '[asar-member]' + extname(name))
        if (extname(name) === '.map') add(member, 'source-map-file')
        await scanStream(member, createReadStream(actual, {
          start, end: start + node.size - 1, highWaterMark: 1024 * 1024,
        }))
      }
    }
    await visit(tree)
    coverage.push(`${safePath(reportPath)}\tasar-members-scanned:${count}`)
  } catch {
    coverage.push(`${safePath(reportPath)}\tasar-parse-failed`)
  } finally { await handle.close() }
}

async function walk(path) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) {
    coverage.push(`${safePath(path)}\tsymlink-skipped`)
    return
  }
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) await walk(join(path, entry))
  } else if (stat.isFile()) {
    await scanFile(path)
  }
}

async function scanTarget(target) {
  const path = resolve(root, target)
  if (!(path === root || path.startsWith(root + sep))) throw new Error('Target must be inside worktree')
  let stat
  try { stat = await lstat(path) } catch { coverage.push(`${safePath(path)}\tmissing`); return }
  if (stat.isDirectory()) return walk(path)
  await scanFile(path)
  if (!['.apk', '.AppImage', '.zip'].includes(extname(path))) return
  await mkdir(join(root, '.e6-tmp'), { recursive: true })
  const scratch = await mkdtemp(join(root, '.e6-tmp', 'artifact-scan-'))
  try {
    const run = spawnSync('7z', ['x', '-y', '-bd', `-o${scratch}`, path], {
      encoding: 'utf8', stdio: 'ignore', timeout: 180000,
    })
    if (run.status !== 0) { coverage.push(`${safePath(path)}\tarchive-extraction-failed`); return }
    const base = basename(path)
    const before = files
    // Extraction paths are deliberately mapped back to the archive, never reported.
    async function walkArchive(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const member = join(dir, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) await walkArchive(member)
        else if (entry.isFile()) {
          const mapped = join(path, '[archive-member]' + extname(entry.name))
          await scanFileMapped(member, mapped)
        }
      }
    }
    async function scanFileMapped(actual, mapped) {
      if (extname(actual) === '.map') add(mapped, 'source-map-file')
      files++
      await scanStream(mapped, createReadStream(actual, { highWaterMark: 1024 * 1024 }))
      if (extname(actual) === '.asar') await scanAsar(actual, mapped)
    }
    await walkArchive(scratch)
    coverage.push(`${safePath(path)}\t${base.endsWith('.AppImage') ? 'appimage' : 'archive'}-members-scanned:${files - before}`)
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

try {
  for (const target of targets) await scanTarget(target)
  console.log(`Files scanned: ${files}`)
  for (const line of coverage.sort()) console.log(`Coverage\t${line}`)
  for (const [key, count] of [...findings].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`Finding\t${key}\t${count}`)
  }
} catch {
  // Error paths may contain identifying archive member names.
  console.error('Artifact scan failed; inspect permissions and available disk space.')
  process.exitCode = 2
}
