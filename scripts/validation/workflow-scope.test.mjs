import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const jobs = [...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)]
  .filter(([, , body]) => /^    runs-on:/m.test(body));
const required = ['android-tests', 'core-1', 'core-2', 'core-3', 'core-4', 'serial', 'software'];

function enabled(event, scope, cancelled = false) {
  return jobs.filter(([, , body]) => {
    const expression = /^    if: (.+)$/m.exec(body)?.[1];
    return !expression || runInNewContext(expression, {
      github: { event_name: event }, inputs: { scope }, always: () => true, cancelled: () => cancelled,
    }, { timeout: 100 });
  }).map(([ , name]) => name).sort();
}

test('push, pull request and release calls always retain every validation job', () => {
  for (const event of ['push', 'pull_request', 'workflow_call']) {
    for (const scope of [undefined, 'all', 'serial']) assert.deepEqual(enabled(event, scope), required);
  }
  assert.deepEqual(enabled('workflow_dispatch', undefined), required);
  assert.deepEqual(enabled('workflow_dispatch', 'all'), required);
});

test('only an explicit manual serial diagnostic omits the full-validation receipt', () => {
  assert.deepEqual(enabled('workflow_dispatch', 'serial'), ['serial']);
  assert.equal(enabled('workflow_dispatch', 'all', true).includes('software'), false);
  assert.match(workflow, /default: all/);
  assert.match(workflow, /run-name:.*Serial performance diagnostic/);
});

test('all validation jobs use the reviewed runner image rather than a moving latest label', () => {
  assert.equal(jobs.length, required.length);
  for (const [, name, body] of jobs) {
    const runner = /^    runs-on: (.+)$/m.exec(body)?.[1];
    if (name !== 'serial') {
      assert.equal(runner, 'ubuntu-24.04', name);
      continue;
    }
    const expression = runner.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    for (const event of ['push', 'pull_request', 'workflow_call', 'workflow_dispatch']) {
      for (const scope of ['all', 'serial']) {
        for (const requested of [undefined, 'ubuntu-24.04-arm', 'ubuntu-24.04', 'unapproved-runner']) {
          const actual = runInNewContext(expression, {
            github: { event_name: event }, inputs: { scope, serial_runner: requested },
          }, { timeout: 100 });
          assert.equal(actual, event === 'workflow_dispatch' && scope === 'serial' && requested === 'ubuntu-24.04'
            ? 'ubuntu-24.04' : 'ubuntu-24.04-arm');
        }
      }
    }
  }
});
