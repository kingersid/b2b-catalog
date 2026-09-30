import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ADMIN_HTML, CHAT_HTML } from './admin.js';

test('connecting the chat enables controls and refreshes integrations', async () => {
  const elements = new Map([...CHAT_HTML.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], {
    value: '', disabled: true, checked: false, textContent: '', className: '',
    replaceChildren() {}, addEventListener() {},
  }]));
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: (id) => elements.get(id) || null },
    localStorage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => 'test-session' },
    window: { addEventListener() {} },
    fetch: async (path) => {
      requests.push(path);
      return { ok: true, json: async () => ({ messages: [], notion: [], tavily: [], drafts: [], status: 'APPROVED' }) };
    },
  });
  new vm.Script(CHAT_HTML.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(context);
  elements.get('key').value = 'test-key';
  await elements.get('connect').onclick();
  assert.equal(elements.get('status').textContent, 'Connected');
  assert.equal(elements.get('send').disabled, false);
  assert.equal(elements.get('sarvam-connect').disabled, false);
  assert.ok(requests.includes('/admin/operator/sarvam/rest/status'));
  assert.ok(requests.some((path) => path.startsWith('/admin/chat/pending?')));
});

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
