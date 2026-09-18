import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'https://catalog.test';
const designs = ['IMG_8327', 'MixedCase_2'].map(design_id => ({
  design_id, name: design_id + '.jpg', url: origin + '/image.jpg',
}));
const source = await readFile(new URL('../functions/share.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const env = { CATALOG_DB: { prepare: () => ({ all: async () => ({ results: designs }) }) } };

test('price catalog WhatsApp links resolve to matching share images, including first design', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/price-catalog.html') return route.fulfill({ contentType: 'text/html', body: await readFile(new URL('../price-catalog.html', import.meta.url), 'utf8') });
      if (url.pathname === '/api/designs') return route.fulfill({ json: { designs, total: designs.length } });
      if (url.pathname === '/prices') return route.fulfill({ json: { prices: { img_8327: 1200 } } });
      return route.fulfill({ status: 204 });
    });
    await page.goto(origin + '/price-catalog.html');
    for (const [i, design] of designs.entries()) {
      if (i) await page.locator('#btn-down').click();
      await page.waitForFunction(id => {
        const href = document.querySelector('#wa-cta').href;
        return href.includes('wa.me') && new URL(href).searchParams.get('text').includes('/share?id=' + id);
      }, design.design_id);
      const href = await page.locator('#wa-cta').getAttribute('href');
      const message = new URL(href).searchParams.get('text');
      assert.equal((message.match(/https:\/\//g) || []).length, 1);
      if (!i) assert.match(message, /₹1,200/);
      const link = message.match(/https:\/\/\S+/)[0];
      const response = await onRequest({ request: new Request(link), env });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(!html.includes('Design not found'));
      assert.ok(html.includes('content="' + origin + '/api/designs?img=' + encodeURIComponent('designs/original/' + design.design_id + '.jpg') + '"'));
      assert.ok(html.includes('content="' + link + '"'));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('previously sent item links still resolve with original filename case', async () => {
  const response = await onRequest({ request: new Request(origin + '/share?item=img_8327'), env });
  const html = await response.text();
  assert.ok(!html.includes('Design not found'));
  assert.ok(html.includes(encodeURIComponent('designs/original/IMG_8327.jpg')));
  assert.ok(html.includes('content="' + origin + '/share?id=IMG_8327"'));
});
