import assert from 'node:assert/strict';
import test from 'node:test';
import { bookedCallForMessage, bookingCode, bookingReply } from './booking.js';

const code = 'BK-12345678-1234-1234-1234-123456789abc';

test('booking code is parsed from the customer initiated WhatsApp message', () => {
  assert.equal(bookingCode(`नमस्ते, मेरा बुकिंग कोड ${code}`), code);
  assert.equal(bookingCode('मुझे वीडियो कॉल चाहिए'), null);
});

test('booking context is available only to the number entered in the form', async () => {
  const env = { CATALOG_DB: { prepare: () => ({ bind: () => ({ first: async () => ({
    customer_name: 'Priya Sharma', start_time: '2026-10-01T13:00:00+05:30', wa_id: '919876543210',
  }) }) }) } };
  assert.equal((await bookedCallForMessage(env, code, '919876543210')).customer_name, 'Priya Sharma');
  assert.equal(await bookedCallForMessage(env, code, '919000000000'), null);
  assert.match(bookingReply({ customer_name: 'Priya Sharma', start_time: '2026-10-01T13:00:00+05:30' }), /व्यवसाय|निजी उपयोग/);
});
