import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { onRequestPost } from './product-metadata.js';

globalThis.crypto ||= webcrypto;

const valid = {
  designId: 'design-1', title: 'Blue poshak fabric', fabric_type: 'silk blend',
  pattern: 'mirror work', colors: 'blue', use_cases: 'Krishna poshak',
  composition: 'silk blend', width_cm: 112, moq_meters: 20,
  availability: 'available', keywords: 'shisha work',
};

test('sales metadata requires the admin key and a real design', async () => {
  const env = { UPLOAD_KEY: 'secret', CATALOG_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const request = (key) => new Request('https://catalog.example/api/product-metadata', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-upload-key': key },
    body: JSON.stringify(valid),
  });
  assert.equal((await onRequestPost({ request: request('wrong'), env })).status, 401);
  assert.equal((await onRequestPost({ request: request('secret'), env })).status, 404);
});

test('sales metadata validates stock status and never writes a price', async () => {
  const statements = [];
  const env = { UPLOAD_KEY: 'secret', CATALOG_DB: { prepare(sql) {
    const record = { sql, values: [] };
    statements.push(record);
    return { bind(...values) {
      record.values = values;
      return { first: async () => ({ design_id: 'design-1' }), run: async () => ({ meta: { changes: 1 } }) };
    } };
  } } };
  const request = (body) => new Request('https://catalog.example/api/product-metadata', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-upload-key': 'secret' },
    body: JSON.stringify(body),
  });
  assert.equal((await onRequestPost({ request: request({ ...valid, availability: 'maybe' }), env })).status, 400);
  assert.equal((await onRequestPost({ request: request(valid), env })).status, 200);
  assert.equal(statements.length, 2);
  assert.match(statements[1].sql, /INSERT INTO design_metadata/);
  assert.doesNotMatch(statements[1].sql, /price/i);
  assert.equal(statements[1].values[0], 'design-1');
});
