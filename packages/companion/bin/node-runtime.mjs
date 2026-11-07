// Shared by the entrypoints (before TypeScript/dependencies load) and doctor.
// Type stripping alone is insufficient: the sync runtime also needs current Node APIs.
export const MIN_NODE_VERSION = '26.10.0';
const [minimumMajor, minimumMinor] = MIN_NODE_VERSION.split('.').map(Number);

export function nodeSupported(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}
