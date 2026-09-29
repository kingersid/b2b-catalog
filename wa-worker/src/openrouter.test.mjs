import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { isFreeOpenRouterModel, listOpenRouterModels, saveOpenRouterKey, validateOpenRouterSelection } from './openrouter.js';

globalThis.crypto ||= webcrypto;

test('free-only selection accepts only explicit free variants', () => {
  assert.equal(isFreeOpenRouterModel('vendor/model:free'), true);
  assert.equal(isFreeOpenRouterModel('openrouter/free'), true);
  assert.equal(isFreeOpenRouterModel('vendor/paid'), false);
  assert.equal(validateOpenRouterSelection('vendor/model:free', true), 'vendor/model:free');
  assert.throws(() => validateOpenRouterSelection('vendor/paid', true), /Free-only/);
  assert.throws(() => validateOpenRouterSelection('https://bad.example/', false), /picker/);
});

test('OpenRouter key is verified before encrypted D1 storage', async () => {
  const db = { saved: null, prepare() { return { bind: (...args) => ({ run: async () => { db.saved = args; } }) }; } };
  const key = 'sk-or-v1-test-key-long-enough';
  const result = await saveOpenRouterKey({ CATALOG_DB: db, AGENT_ADMIN_KEY: 'test-admin' }, key, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/key');
    assert.equal(options.headers.authorization, `Bearer ${key}`);
    return Response.json({ data: { label: 'test' } });
  });
  assert.equal(result.connected, true);
  assert.notEqual(db.saved[0], key);
});

test('OpenRouter model catalog includes only tool-capable models with prices', async () => {
  const db = { prepare() { return { first: async () => null }; } };
  const models = await listOpenRouterModels({ CATALOG_DB: db, OPENROUTER_API_KEY: 'test-key' }, async (url, options) => {
    assert.match(url, /supported_parameters=tools/);
    assert.equal(options.headers.authorization, 'Bearer test-key');
    return Response.json({ data: [
      { id: 'vendor/agent:free', name: 'Free Agent', supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' }, context_length: 32000 },
      { id: 'vendor/agent', name: 'Paid Agent', supported_parameters: ['tools'], pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'vendor/plain', name: 'Plain', supported_parameters: ['temperature'], pricing: { prompt: '0', completion: '0' } },
    ] });
  });
  assert.equal(models.length, 2);
  assert.deepEqual(models.map(model => model.free), [true, false]);
  assert.equal(models[1].promptPrice, 1);
  assert.equal(models[1].completionPrice, 2);
});
