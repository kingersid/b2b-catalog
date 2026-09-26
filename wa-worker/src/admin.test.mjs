import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ADMIN_HTML } from './admin.js';

test('operator inbox script parses before deployment', () => {
  const match = ADMIN_HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'inbox must have a script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
