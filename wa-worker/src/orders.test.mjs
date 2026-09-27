import assert from 'node:assert/strict';
import test from 'node:test';
import { orderIntent, handleOwnerOrder, pendingText, sendNoonOrderReminder } from './orders.js';

test('order commands accept the shop wording and require an unambiguous completion target', () => {
  assert.equal(orderIntent('hi pls note this order .. xyz').kind, 'start');
  assert.equal(orderIntent('party: ABC\nlocation: Jaipur').kind, 'append');
  assert.equal(orderIntent('END ORDER').kind, 'end');
  assert.equal(orderIntent('pending orders').kind, 'list');
  assert.deepEqual(orderIntent('completed 12'), { kind: 'complete', id: 12, contextId: '' });
  assert.deepEqual(orderIntent('completed', 'wamid.reply'), { kind: 'complete', id: null, contextId: 'wamid.reply' });
});

test('noon reminder sends a template outside the reply window and only once per day', async () => {
  const reminderDays = new Set();
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() {
          if (sql.includes('FROM wa_orders o')) return { results: [{ id: 12, party: 'ABC', location: 'Jaipur', notes: '2 checked designs', image_count: 2 }] };
          throw Error(`Unexpected query: ${sql}`);
        },
        async first() {
          if (sql.includes('last_customer_at')) return { last_customer_at: 0 };
          throw Error(`Unexpected query: ${sql}`);
        },
        async run() {
          if (sql.startsWith('INSERT OR IGNORE INTO wa_order_reminders')) {
            if (reminderDays.has(args[0])) return { meta: { changes: 0 } };
            reminderDays.add(args[0]);
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  const env = { CATALOG_DB: db, ORDER_REMINDER_TEMPLATE: 'chandni_pending_orders' };
  const sent = [];
  const send = async (_env, payload) => { sent.push(payload); return 'wamid.sent'; };
  const date = new Date('2026-09-28T06:30:00.000Z'); // 12:00 India time
  assert.deepEqual(await sendNoonOrderReminder(env, send, date), { sent: true, count: 1, template: true });
  assert.equal(sent[0].type, 'template');
  assert.equal(sent[0].to, '919537097267');
  assert.match(sent[0].template.components[0].parameters[0].text, /#12.*ABC.*Jaipur/);
  assert.deepEqual(await sendNoonOrderReminder(env, send, date), { skipped: 'already attempted today' });
  assert.equal(sent.length, 1);
  assert.deepEqual(await sendNoonOrderReminder(env, send, new Date('2026-09-28T06:29:00.000Z')), { skipped: 'outside noon window' });
});

test('owner order collects marked images and completion removes it from pending list', async () => {
  const orders = [];
  const items = new Map();
  const savedImages = [];
  const db = { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.includes('FROM wa_order_context')) return null;
        if (sql.includes('WHERE start_message_id')) return orders.find(o => o.start_message_id === args[0]) || null;
        if (sql.includes('capture_until >= ?')) return [...orders].reverse().find(o => o.sender === args[0] && o.status === 'pending' && o.capture_until >= args[1]) || null;
        throw Error(`Unexpected first: ${sql}`);
      },
      async all() {
        if (sql.includes('FROM wa_orders o')) return { results: orders.filter(o => o.status === 'pending').map(o => ({ ...o, image_count: [...items.values()].filter(i => i.order_id === o.id && i.kind === 'image').length })) };
        if (sql.includes("SELECT id FROM wa_orders WHERE status = 'pending'")) return { results: orders.filter(o => o.status === 'pending').map(o => ({ id: o.id })) };
        throw Error(`Unexpected all: ${sql}`);
      },
      async run() {
        if (sql.startsWith('INSERT OR IGNORE INTO wa_orders')) {
          if (!orders.some(o => o.start_message_id === args[0])) orders.push({ id: orders.length + 1, start_message_id: args[0], sender: args[1], notes: args[2], party: args[3], location: args[4], status: 'pending', capture_until: args[7] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT OR IGNORE INTO wa_order_items')) {
          if (items.has(args[0])) return { meta: { changes: 0 } };
          items.set(args[0], { order_id: args[1], kind: args[2], r2_key: args[4] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE wa_orders SET notes')) { orders.find(o => o.id === args[6]).capture_until = args[5]; return { meta: { changes: 1 } }; }
        if (sql.includes("SET status = 'completed'")) { const o = orders.find(o => o.id === args[3] && o.status === 'pending'); if (o) o.status = 'completed'; return { meta: { changes: o ? 1 : 0 } }; }
        throw Error(`Unexpected run: ${sql}`);
      },
    };
  } };
  const env = { CATALOG_DB: db, ORDER_IMAGES: { async put(key, bytes) { savedImages.push({ key, bytes }); } } };
  const deps = { downloadMedia: async () => ({ mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }) };
  const sender = '919537097267';
  const start = await handleOwnerOrder(env, { wa_id: sender, message_id: 'wamid.start', body: 'Please note this order. Party: Test. Location: Surat', media_kind: null }, deps);
  assert.equal(start.orderId, 1);
  assert.equal(orders[0].party, 'Test');
  assert.equal(orders[0].location, 'Surat');
  assert.equal((await handleOwnerOrder(env, { wa_id: sender, message_id: 'wamid.photo', body: '[Customer sent a image message]', media_kind: 'image', media_id: '123456' }, deps)).text, null);
  assert.match(savedImages[0].key, /^wa-orders\/1\//);
  assert.match(await pendingText(env), /1 photo/);
  const completed = await handleOwnerOrder(env, { wa_id: sender, message_id: 'wamid.complete', body: 'COMPLETED 1', media_kind: null }, deps);
  assert.match(completed.text, /marked completed/);
  assert.equal(await pendingText(env), 'No pending orders.');
});
