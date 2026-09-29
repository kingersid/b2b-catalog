import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ADMIN_HTML, CHAT_HTML } from './admin.js';

test('operator inbox script parses before deployment', () => {
  const match = ADMIN_HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'inbox must have a script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});

test('private operator chat script parses and exposes provider controls', () => {
  const match = CHAT_HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'chat must have a script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
  assert.match(CHAT_HTML, /Connect Tavily/);
  assert.match(CHAT_HTML, /Connect OpenRouter/);
  assert.match(CHAT_HTML, /Free only/);
  assert.match(CHAT_HTML, /Search tool-capable models/);
  assert.match(CHAT_HTML, /WhatsApp customer replies remain on the separate sales path/);
});
