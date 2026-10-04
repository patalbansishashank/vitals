import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releasePolicy } from './release-policy.mjs';

test('candidate builds never publish, even when explicitly requested', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    for (const requested of ['true', 'false', undefined]) {
      assert.deepEqual(releasePolicy('v0.5.0-rc.1', '0.4.0', event, requested), { version: '0.5.0-rc.1', publish: false });
    }
  }
});

test('stable tags require the real version bump for both publishing and dry runs', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    assert.throws(() => releasePolicy('v0.5.0', '0.4.0', event, 'false'), /does not match/);
  }
  assert.equal(releasePolicy('v0.5.0', '0.5.0', 'push').publish, true);
  assert.equal(releasePolicy('v0.5.0', '0.5.0', 'workflow_dispatch', 'true').publish, true);
  assert.equal(releasePolicy('v0.5.0', '0.5.0', 'workflow_dispatch').publish, false);
  assert.equal(releasePolicy('v0.5.0', '0.5.0', 'other', 'true').publish, false);
});

test('branches, malformed tags and other prerelease formats are rejected', () => {
  for (const tag of ['main', 'v0.5', 'v0.5.0-rc.0', 'v0.5.0-beta.1', 'v0.5.0-rc.1\n', 'v0.5.0+build', undefined]) {
    assert.throws(() => releasePolicy(tag, '0.5.0', 'push'));
  }
});
