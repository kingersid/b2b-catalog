import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicPage } from './web.js';

test('operator direct web tool follows public redirects and reads bounded text', async () => {
  const calls = [];
  const result = JSON.parse(await fetchPublicPage('https://example.com/start', async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: '/final' } });
    return new Response('<html><style>secret</style><h1>Useful page</h1><p>Source &amp; facts</p></html>', { headers: { 'content-type': 'text/html' } });
  }));
  assert.deepEqual(calls, ['https://example.com/start', 'https://example.com/final']);
  assert.equal(result.url, 'https://example.com/final');
  assert.match(result.content, /Useful page/);
  assert.doesNotMatch(result.content, /secret/);
});

test('operator direct web tool blocks local and credential-bearing URLs', async () => {
  const noFetch = () => { throw new Error('Network must not be reached'); };
  for (const url of ['http://127.0.0.1/x', 'https://localhost/x', 'https://intranet.local/x',
    'https://user:pass@example.com/x', 'https://example.com:8080/x', 'file:///etc/passwd']) {
    await assert.rejects(() => fetchPublicPage(url, noFetch));
  }
  await assert.rejects(() => fetchPublicPage('https://example.com/x', async () =>
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })), /Local or IP-address/);
});

test('operator direct web tool returns a title and bounded excerpt for large pages', async () => {
  const html = `<html><head><title>Official Docs</title></head><body>${'Useful text '.repeat(20000)}</body></html>`;
  const result = JSON.parse(await fetchPublicPage('https://example.com/docs', async () =>
    new Response(html, { headers: { 'content-type': 'text/html' } })));
  assert.equal(result.title, 'Official Docs');
  assert.equal(result.truncated, true);
  assert.match(result.content, /Useful text/);
  assert.ok(result.content.length <= 16000);
});
