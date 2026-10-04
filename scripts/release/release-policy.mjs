import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Candidates exercise the packaging pipeline before the real version bump. They can never publish.
export function releasePolicy(tag, packageVersion, event, publishRequested = 'false') {
  if (!/^v\d+\.\d+\.\d+(-rc\.[1-9]\d*)?$/.test(tag)) {
    throw new Error('Expected a vX.Y.Z or vX.Y.Z-rc.N tag');
  }
  const version = tag.slice(1);
  const candidate = version.includes('-');
  if (!candidate && version !== packageVersion) {
    throw new Error(`Tag version ${version} does not match package.json version ${packageVersion}`);
  }
  const publish = !candidate && (event === 'push' || (event === 'workflow_dispatch' && publishRequested === 'true'));
  return { version, publish };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const policy = releasePolicy(process.env.RELEASE_TAG, pkg.version, process.env.RELEASE_EVENT, process.env.PUBLISH_REQUEST);
  if (process.argv[2] === '--set-build-version') {
    if (!process.env.RELEASE_TAG.includes('-')) throw new Error('Only candidate checkouts may override the build version');
    writeFileSync('package.json', `${JSON.stringify({ ...pkg, version: policy.version }, null, 2)}\n`);
  } else {
    process.stdout.write(`version=${policy.version}\npublish=${policy.publish}\n`);
  }
}
