import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// TypeScript resolves .ts and .tsx as the same module stem. Linux can hide a collision that breaks Windows/macOS.
test('source module names remain distinct on case-insensitive filesystems', () => {
  const stems = new Map();
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (/\.tsx?$/.test(name)) {
        const stem = name.replace(/\.tsx?$/, '').toLowerCase();
        assert.ok(!stems.has(stem), `Module name collision: ${stems.get(stem)} and ${name}`);
        stems.set(stem, name);
      }
    }
  }
  visit('src');
  visit('apps/desktop/src');
});
