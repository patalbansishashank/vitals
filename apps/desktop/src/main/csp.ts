/**
 * The Content-Security-Policy every `app://vitals` response carries: read from netlify.toml by scripts/build.mjs and
 * compiled into the main bundle, so the desktop app and the website cannot drift apart. No imports: Node runs this
 * file as-is (type stripping) from the build script.
 */

/** The `Content-Security-Policy = "..."` value of netlify.toml's `/*` header block. Throws when it is missing. */
export function cspFromNetlifyToml(toml: string): string {
  const match = /^\s*Content-Security-Policy\s*=\s*"([^"]*)"/m.exec(toml);
  if (!match?.[1]) throw new Error('netlify.toml has no Content-Security-Policy');
  return match[1];
}
