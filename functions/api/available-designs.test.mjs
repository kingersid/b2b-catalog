import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from './available-designs.js';

test('public available assortment omits private prices and unpriced designs', async () => {
  const env = { CATALOG_DB: { prepare(sql) {
    if (sql.includes('FROM designs')) {
      assert.match(sql, /d\.active = 1/);
      assert.match(sql, /m\.availability = 'available'/);
      return { all: async () => ({ results: [
        { design_id: 'priced', name: 'priced.jpg', title: 'Moss Satin', fabric_type: 'moss satin' },
        { design_id: 'unpriced', name: 'unpriced.jpg', title: 'Unpriced' },
      ] }) };
    }
    return { all: async () => ({ results: [{ item_id: 'priced.jpg', price: 987 }] }) };
  } } };
  const result = await onRequestGet({ env });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(body.designs.map(design => design.design_id), ['priced']);
  assert.equal(body.total, 1);
  assert.equal('price' in body.designs[0], false);
  assert.doesNotMatch(JSON.stringify(body), /987/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
