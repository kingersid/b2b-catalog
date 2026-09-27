import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from './index.js';

globalThis.crypto ||= webcrypto;

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../orders.sql', import.meta.url), 'utf8'));
  return {
    db,
    binding: { prepare(sql) {
      const statement = db.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { const result = statement.run(...values); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }; },
      };
    } },
  };
}

function signedEvent(event, env) {
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex');
  return new Request('https://agent.example/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` } });
}

test('signed owner webhook saves the actual photo, handles rapid messages, and completes by reply', async () => {
  const { db, binding } = d1();
  const saved = new Map();
  const env = {
    CATALOG_DB: binding, ORDER_IMAGES: { async put(key, bytes) { saved.set(key, bytes); } },
    META_APP_SECRET: 'local-signature-secret', META_ACCESS_TOKEN: 'local-token',
    WABA_ID: '2150197029173188', PHONE_NUMBER_ID: '1329088423615686',
  };
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/123456?phone_number_id=')) return Response.json({ mime_type: 'image/jpeg', file_size: 3, url: 'https://lookaside.fbsbx.com/photo' });
    if (String(url) === 'https://lookaside.fbsbx.com/photo') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } });
    if (String(url).endsWith('/messages')) {
      sent.push(JSON.parse(options.body));
      return Response.json({ messages: [{ id: `wamid.sent.${sent.length}` }] });
    }
    throw Error(`Unexpected fetch: ${url}`);
  };
  const send = async messages => {
    const event = { entry: [{ id: env.WABA_ID, changes: [{ value: { metadata: { phone_number_id: env.PHONE_NUMBER_ID }, messages } }] }] };
    const tasks = [];
    const result = await worker.fetch(signedEvent(event, env), env, { waitUntil(promise) { tasks.push(promise); } });
    assert.equal(result.status, 200);
    await Promise.all(tasks);
  };
  try {
    await send([
      { id: 'wamid.start', from: '919537097267', type: 'text', text: { body: 'Please note this order. Party: Test. Location: Surat' } },
      { id: 'wamid.image', from: '919537097267', type: 'image', image: { id: '123456' } },
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_orders').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_order_items').get().n, 2);
    assert.equal(saved.size, 1);
    assert.deepEqual([...saved.values()][0], new Uint8Array([1, 2, 3]));
    assert.match(sent[0].text.body, /Order #1 saved/);
    await send([{ id: 'wamid.start', from: '919537097267', type: 'text', text: { body: 'Please note this order. Party: Test. Location: Surat' } }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_orders').get().n, 1, 'duplicate webhook does not create a second order');
    await send([{ id: 'wamid.complete', from: '919537097267', type: 'text', text: { body: 'COMPLETED' }, context: { id: 'wamid.sent.1' } }]);
    assert.equal(db.prepare('SELECT status FROM wa_orders WHERE id = 1').get().status, 'completed');
    assert.match(sent[1].text.body, /marked completed/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
