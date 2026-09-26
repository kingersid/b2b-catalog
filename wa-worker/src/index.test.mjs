import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import test from 'node:test';
import worker, { verifySignature, payloadsFor, basicDecision } from './index.js';

globalThis.crypto ||= webcrypto;

const env = { META_VERIFY_TOKEN: 'verify-for-test', META_APP_SECRET: 'secret-for-test', META_ACCESS_TOKEN: 'unused', WABA_ID: '2150197029173188', PHONE_NUMBER_ID: '1329088423615686' };

test('Meta signature validation uses the raw request body', async () => {
  const body = new TextEncoder().encode('{"hello":"world"}');
  const signature = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}`;
  assert.equal(await verifySignature(body, signature, env.META_APP_SECRET), true);
  assert.equal(await verifySignature(new TextEncoder().encode('{"hello":"other"}'), signature, env.META_APP_SECRET), false);
});

test('webhook verification and signature gate', async () => {
  const check = await worker.fetch(new Request('https://agent.example/webhook?hub.mode=subscribe&hub.verify_token=verify-for-test&hub.challenge=123'), env, {});
  assert.equal(check.status, 200);
  assert.equal(await check.text(), '123');
  const bad = await worker.fetch(new Request('https://agent.example/webhook', { method: 'POST', body: '{}' }), env, {});
  assert.equal(bad.status, 401);
});

test('only supplied active priced designs can appear with rates', () => {
  const designs = [{ id: 'live', name: 'Live.jpg', rate: 950 }];
  const payloads = payloadsFor({ action: 'show_designs', design_ids: ['hidden', 'live'], question: 'general' }, designs, '919999999999', 'https://chandni-catalog.pages.dev');
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].image.caption, /₹950/);
  assert.doesNotMatch(payloads[0].image.caption, /hidden/);
  assert.equal(payloadsFor({ action: 'optout' }, designs, '919999999999', 'https://chandni-catalog.pages.dev').length, 0);
});

test('simple messages avoid a model call and unsupported media reaches a person', () => {
  assert.equal(basicDecision('hi').action, 'show_designs');
  assert.equal(basicDecision('Please check stock').action, 'handoff');
  assert.equal(basicDecision('[Customer sent a image message]').action, 'handoff');
  assert.equal(basicDecision('STOP').action, 'optout');
});
