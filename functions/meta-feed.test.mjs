import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from './meta-feed.js';

test('Meta feed keeps saved rates private and excludes sold-out metadata', async () => {
  let query = '';
  const env = { CATALOG_DB: { prepare(sql) {
    query = sql;
    return { all: async () => ({ results: [
      { design_id: 'a1', name: 'Blue.jpg', price: 975, sort_order: 1 },
    ] }) };
  } } };
  const result = await onRequestGet({ env });
  assert.equal(result.status, 200);
  const csv = await result.text();
  assert.match(csv, /1 INR/);
  assert.match(csv, /Price on request/);
  assert.doesNotMatch(csv, /975/);
  assert.match(query, /m\.availability.*sold_out/s);
  assert.match(query, /COALESCE\(p_name\.price, p_id\.price\) > 0/);
});
