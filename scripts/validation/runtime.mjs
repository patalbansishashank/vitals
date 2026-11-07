/** The server and test platform use native disposal stacks and Web Locks supplied by the supported Node baseline. */
export function assertSupportedRuntime(version = process.versions.node, capabilities = {
  asyncDisposableStack: typeof globalThis.AsyncDisposableStack === 'function',
  webLocks: typeof globalThis.navigator?.locks?.request === 'function',
}) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 26 || (major === 26 && minor < 10)) throw new Error(`Validation needs Node 26.10.0 or newer; found ${version}. Use the version in .nvmrc.`);
  if (!capabilities.asyncDisposableStack || !capabilities.webLocks) throw new Error('Validation runtime lacks AsyncDisposableStack or Web Locks; use the supported Node runtime.');
}
