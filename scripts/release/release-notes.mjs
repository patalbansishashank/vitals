// Release notes for a version tag: the CHANGELOG.md section for that version plus a fixed downloads footer.
// Usage: node scripts/release/release-notes.mjs <version> [changelogPath]   (Markdown on stdout)
// A version without its own section falls back to "## Unreleased" with a GitHub warning on stderr.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FOOTER = `## Downloads

| System | File |
|---|---|
| Android | \`Vitals-android.apk\` |
| Linux | \`Vitals-linux-x86_64.AppImage\` or \`Vitals-linux-amd64.deb\` |
| Windows | \`Vitals-windows-x64-setup.exe\` |
| macOS | \`Vitals-macos-universal.dmg\` |

The Windows and macOS apps are not signed. Windows shows "Windows protected your PC": choose More info, then Run anyway.
macOS says it cannot check the app: open System Settings, Privacy & Security, then choose Open Anyway.
Android asks you to allow installing from this source.

To check a file, download \`SHA256SUMS.txt\` next to it and run \`sha256sum -c SHA256SUMS.txt --ignore-missing\`.
`;

/** Lines of the "## " section whose heading line satisfies `isHeading`, without the heading; null when absent. */
function section(lines, isHeading) {
  const start = lines.findIndex((line) => isHeading(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/**
 * The CHANGELOG body for `version`: the section headed `## [version]` (exact match), else `## Unreleased`.
 * Throws when neither exists or the chosen section is empty.
 * @returns {{ body: string, fromUnreleased: boolean }}
 */
export function releaseNotes(changelogText, version) {
  const lines = changelogText.replace(/\r\n?/g, '\n').split('\n');
  const own = section(lines, (line) => line.startsWith('## [') && line.slice(4).startsWith(`${version}]`));
  const fromUnreleased = own === null;
  const body = fromUnreleased ? section(lines, (line) => /^## Unreleased\s*$/i.test(line)) : own;
  if (body === null) throw new Error(`CHANGELOG has no "## [${version}]" section and no "## Unreleased" section.`);
  if (body === '') {
    throw new Error(`The CHANGELOG section for ${fromUnreleased ? 'Unreleased' : version} is empty.`);
  }
  return { body, fromUnreleased };
}

/** Full notes: the body, a blank line, then the footer. */
export function renderNotes(changelogText, version) {
  const { body, fromUnreleased } = releaseNotes(changelogText, version);
  return { markdown: `${body}\n\n${FOOTER}`, fromUnreleased };
}

function main(argv) {
  const [version, changelogPath] = argv;
  if (!version) {
    process.stderr.write('Usage: node scripts/release/release-notes.mjs <version> [changelogPath]\n');
    return 1;
  }
  const path = resolve(changelogPath ?? fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url)));
  try {
    const { markdown, fromUnreleased } = renderNotes(readFileSync(path, 'utf8'), version);
    if (fromUnreleased) {
      process.stderr.write(`::warning::CHANGELOG.md has no section for ${version}; the release notes use "Unreleased".\n`);
    }
    process.stdout.write(markdown);
    return 0;
  } catch (err) {
    process.stderr.write(`release-notes: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
