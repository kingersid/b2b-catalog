import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import test from 'node:test';
import worker, { verifySignature, payloadsFor, basicDecision, kimiFailure, decide, qualifiesB2B, mergeB2B, sanitizeReply, downloadCustomerMedia, interpretInboundMedia, wantsAvailableAssortment, availableCatalogMessage } from './index.js';

globalThis.crypto ||= webcrypto;

const env = { META_VERIFY_TOKEN: 'verify-for-test', META_APP_SECRET: 'secret-for-test', META_ACCESS_TOKEN: 'unused', WABA_ID: '2150197029173188', PHONE_NUMBER_ID: '13290884615686' };

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

test('B2B qualification requires an explicit buyer-side signal', () => {
  assert.equal(qualifiesB2B('I run a saree shop in Rajkot', 'unknown'), 'yes');
  assert.equal(qualifiesB2B('wholesale rate batao', 'unknown'), 'yes');
  assert.equal(qualifiesB2B('मैं दुकान चलाता हूँ', 'unknown'), 'yes');
  assert.equal(qualifiesB2B('હું હોલસેલ કરું છું', 'unknown'), 'yes');
  assert.equal(qualifiesB2B('Mujhe Krishna poshak banwani hai bulk me', 'unknown'), 'yes');
  assert.equal(qualifiesB2B('send designs', 'unknown'), 'unknown');
  assert.equal(qualifiesB2B('I need one saree for my wife', 'unknown'), 'unknown');
  assert.equal(qualifiesB2B('any message at all', 'yes'), 'yes', 'qualification never downgrades');
  assert.equal(qualifiesB2B('i want to buy 2 meters for home', 'no'), 'no');
});

test('B2B flag: only buyer words qualify, model claims never do', () => {
  assert.equal(mergeB2B('unknown', 'yes'), 'unknown', 'a model-claimed yes never enables prices');
  assert.equal(mergeB2B('no', 'yes'), 'no');
  assert.equal(mergeB2B('yes', 'no'), 'yes', 'qualification never downgrades');
  assert.equal(mergeB2B('unknown', 'no'), 'no');
  assert.equal(mergeB2B('unknown', 'unknown'), 'unknown');
  assert.equal(mergeB2B(qualifiesB2B('wholesale chahiye', 'unknown'), 'unknown'), 'yes', 'buyer words are the only path to yes');
});

test('reply sanitizer blocks prices, stock promises, and links', () => {
  assert.equal(sanitizeReply('This design is very popular for poshak work! 😊 Which city are you in?'), 'This design is very popular for poshak work! 😊 Which city are you in?');
  assert.equal(sanitizeReply('The rate is 850 per metre'), null);
  assert.equal(sanitizeReply('We can do 750/-'), null);
  assert.equal(sanitizeReply('It costs ₹950'), null);
  assert.equal(sanitizeReply('Discount 20% off for you'), null);
  assert.equal(sanitizeReply('2000 metres ready stock me hai'), null);
  assert.equal(sanitizeReply('Visit https://example.com'), null);
  assert.equal(sanitizeReply(''), null);
  assert.equal(sanitizeReply(null), null);
});

test('design captions carry rates only when price-allowed', () => {
  const designs = [{ id: 'live', name: 'Live.jpg', rate: 950 }];
  const d = { reply: null, design_ids: ['live', 'hidden'], handoff: false, optout: false, community: false };
  const gated = payloadsFor(d, designs, '919999999999', 'https://chandni-catalog.pages.dev', false, '');
  assert.equal(gated.length, 1);
  assert.doesNotMatch(gated[0].image.caption, /₹|950/);
  assert.match(gated[0].image.caption, /View:/);
  const allowed = payloadsFor(d, designs, '919999999999', 'https://chandni-catalog.pages.dev', true, '');
  assert.match(allowed[0].image.caption, /₹950/);
  assert.equal(payloadsFor({ optout: true }, designs, 'x', 'https://x', true, '').length, 0);
});

test('community link is attached only by code and only when requested', () => {
  const designs = [{ id: 'live', name: 'Live.jpg', rate: 950 }];
  const d = { reply: 'Roz naye designs ke liye community join kar lijiye', design_ids: [], handoff: false, optout: false, community: true };
  const withUrl = payloadsFor(d, designs, 'x', 'https://chandni-catalog.pages.dev', false, 'https://chat.whatsapp.com/demo');
  assert.deepEqual(withUrl.map(p => p.text?.body), ['Roz naye designs ke liye community join kar lijiye', 'Join our free WhatsApp community for daily new designs: https://chat.whatsapp.com/demo']);
  const noUrl = payloadsFor(d, designs, 'x', 'https://chandni-catalog.pages.dev', false, '');
  assert.equal(noUrl.length, 1);
});

test('non-price fallback never mentions rates', () => {
  const d = { reply: null, design_ids: [], handoff: false, optout: false, community: false };
  const payloads = payloadsFor(d, [], 'x', 'https://chandni-catalog.pages.dev', false, '');
  assert.equal(payloads.length, 1);
  assert.doesNotMatch(payloads[0].text.body, /₹|\d+\s*\/-/);
});

test('simple messages avoid a model call', () => {
  assert.deepEqual(basicDecision('STOP'), { kind: 'optout' });
  assert.deepEqual(basicDecision('[Customer sent a image message]'), { kind: 'media' });
  assert.deepEqual(basicDecision('Please talk to a human'), { kind: 'human' });
  assert.equal(basicDecision('hi'), null, 'greetings now go to the persona agent');
});

test('full available assortment requests get the whole live catalog link', () => {
  assert.equal(wantsAvailableAssortment('send me ready available designs'), true);
  assert.equal(wantsAvailableAssortment('Please show me all available designs'), true);
  assert.equal(wantsAvailableAssortment('Show me your ready stock'), true);
  assert.equal(wantsAvailableAssortment('show me blue designs'), false);
  assert.equal(wantsAvailableAssortment('is this design available?'), false);
  const reply = availableCatalogMessage('https://chandni-catalog.pages.dev');
  assert.match(reply, /full assortment/);
  assert.match(reply, /https:\/\/chandni-catalog\.pages\.dev\/available-catalog/);
  assert.doesNotMatch(reply, /₹|\bunknown\b|\blow.stock\b/);
});

test('Kimi persona request carries profile, designs, and history', async () => {
  const designs = [{ id: 'live', name: 'Blue Silk', fabric_type: 'silk blend', colors: 'blue', use_cases: 'saree', availability: 'available', rate: 950 }];
  const history = [{ buyer: 'hi', assistant: 'Welcome!' }];
  const profile = { customer_name: 'Ramesh', city: 'Rajkot', b2b: 'yes' };
  const decision = await decide({ KIMI_API_KEY: 'test-key', KIMI_MODEL: 'kimi-k2.6' }, 'silk dikhao', designs, history, profile, async (url, options) => {
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'kimi-k2.6');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(body.max_tokens <= 400);
    const user = JSON.parse(body.messages[1].content);
    assert.equal(user.profile.known_name, 'Ramesh');
    assert.equal(user.profile.known_city, 'Rajkot');
    assert.equal(user.profile.price_eligible, true);
    assert.equal(user.designs[0].fabric_type, 'silk blend');
    assert.equal(user.designs[0].colors, 'blue');
    assert.equal(user.designs[0].use_cases, 'saree');
    assert.equal(user.designs[0].rate, undefined, 'real rate must stay out of the model request');
    assert.deepEqual(user.history, history);
    assert.match(body.messages[0].content, /NEVER state.*price|wholesale rates are shared with shop owners/);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      reply: 'नमस्ते Ramesh जी! 😊 ये designs देखिए।', design_ids: ['live'], handoff: false, optout: false, community: false,
      profile: { name: null, city: null, business: null, use_case: null, b2b: 'unknown' }
    }) } }] }));
  });
  assert.equal(decision.reply, 'नमस्ते Ramesh जी! 😊 ये designs देखिए।');
  assert.deepEqual(decision.design_ids, ['live']);
  assert.equal(decision.profile.b2b, 'yes');
});

test('photo input reaches Kimi as vision content without opening the price gate', async () => {
  await decide({ KIMI_API_KEY: 'test-key' }, 'Find a similar pattern', [], [], { b2b: 'unknown' }, async (_url, options) => {
    const parts = JSON.parse(options.body).messages[1].content;
    assert.equal(parts[0].type, 'text');
    assert.equal(JSON.parse(parts[0].text).profile.price_eligible, false);
    assert.equal(parts[1].type, 'image_url');
    assert.equal(parts[1].image_url.url, 'data:image/jpeg;base64,AQID');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      reply: 'What colour would you prefer?', design_ids: [], handoff: false, optout: false, community: false
    }) } }] }));
  }, { mime: 'image/jpeg', base64: 'AQID' }, '');
});

test('Meta media retrieval checks type, size, and download host', async () => {
  const mediaEnv = { META_ACCESS_TOKEN: 'test-token', PHONE_NUMBER_ID: '123' };
  const calls = [];
  const result = await downloadCustomerMedia(mediaEnv, '123456789', 'image', async (url) => {
    calls.push(url);
    if (calls.length === 1) return new Response(JSON.stringify({
      mime_type: 'image/jpeg', file_size: 3, url: 'https://lookaside.fbsbx.com/media/example'
    }));
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.equal(result.mime, 'image/jpeg');
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(calls.length, 2);
  await assert.rejects(() => downloadCustomerMedia(mediaEnv, '123456789', 'image', async () =>
    new Response(JSON.stringify({ mime_type: 'image/jpeg', url: 'https://evil.example/steal' }))), /Unexpected Meta media URL/);
  await assert.rejects(() => downloadCustomerMedia(mediaEnv, '123456789', 'image', async () =>
    new Response(JSON.stringify({ mime_type: 'image/jpeg', file_size: 6000000, url: 'https://lookaside.fbsbx.com/x' }))), /too large/);
});

test('voice note is transcribed without itself qualifying the buyer for prices', async () => {
  const aiCalls = [];
  const mediaEnv = {
    META_ACCESS_TOKEN: 'test-token', PHONE_NUMBER_ID: '123',
    AI: { async run(model, input) {
      aiCalls.push({ model, input });
      return { text: 'Wholesale rate batao' };
    } },
  };
  let count = 0;
  const { customerText, image } = await interpretInboundMedia(mediaEnv, {
    media_kind: 'audio', media_id: '123456789', body: '[Customer sent a audio message]',
  }, async () => {
    count++;
    return count === 1
      ? new Response(JSON.stringify({ mime_type: 'audio/ogg', file_size: 3, url: 'https://lookaside.fbsbx.com/audio' }))
      : new Response(new Uint8Array([1, 2, 3]));
  });
  assert.equal(customerText, 'Wholesale rate batao');
  assert.equal(image, null);
  assert.equal(aiCalls[0].model, '@cf/openai/whisper-large-v3-turbo');
  assert.equal(aiCalls[0].input.audio, 'AQID');
  assert.equal(qualifiesB2B('', 'unknown'), 'unknown', 'a transcription alone does not unlock rates');
});

test('model cannot enable prices by claiming b2b while code disagrees', async () => {
  const designs = [{ id: 'live', name: 'Live.jpg', rate: 950 }];
  const decision = await decide({ KIMI_API_KEY: 'test-key' }, 'rate batao', designs, [], { b2b: 'no' }, async (url, options) => {
    const user = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(user.profile.price_eligible, false, 'code gate keeps the model blind to eligibility');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      reply: 'Rate 850 hai', design_ids: [], handoff: false, optout: false, community: false,
      profile: { name: null, city: null, business: null, use_case: null, b2b: 'yes' }
    }) } }] }));
  });
  assert.equal(decision.reply, null, 'price-bearing model text is dropped');
  assert.equal(decision.profile.b2b, 'no', 'model cannot revoke the code-side no');
});

test('Kimi 429 diagnosis separates exhausted balance from temporary throttling', () => {
  assert.match(kimiFailure(429, JSON.stringify({ error: { type: 'exceeded_current_quota_error' } })), /balance or quota/i);
  assert.match(kimiFailure(429, JSON.stringify({ error: { type: 'rate_limit_reached_error' } })), /rate limit/i);
  assert.match(kimiFailure(429, JSON.stringify({ error: { type: 'engine_overloaded_error' } })), /temporarily overloaded/i);
  assert.equal(kimiFailure(429, '{bad json'), 'Kimi HTTP 429');
});
