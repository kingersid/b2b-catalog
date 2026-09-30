import assert from 'node:assert/strict';
import test from 'node:test';
import { indianWhatsAppNumber, onRequestPost } from './book-call.js';

test('Indian WhatsApp numbers are normalized and validated', () => {
  assert.equal(indianWhatsAppNumber('+91 98765 43210'), '919876543210');
  assert.equal(indianWhatsAppNumber('9876543210'), '919876543210');
  assert.equal(indianWhatsAppNumber('12345'), null);
});

test('successful calendar booking stores the number and returns a WhatsApp code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, startTime: '2026-10-01T13:00:00+05:30' });
  const writes = [];
  const env = { CATALOG_DB: { prepare: sql => ({ run: async () => { writes.push([sql]); }, bind: (...args) => ({ run: async () => { writes.push([sql, ...args]); } }) }) } };
  try {
    const request = new Request('https://catalog.example/api/book-call', { method: 'POST', body: JSON.stringify({ name: 'Priya', phone: '9876543210' }) });
    const result = await onRequestPost({ request, env });
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.whatsappReady, true);
    assert.match(data.code, /^BK-/);
    assert.equal(writes[1][2], '919876543210');
  } finally { globalThis.fetch = originalFetch; }
});
