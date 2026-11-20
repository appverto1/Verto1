import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const server = readFileSync('server.ts', 'utf8');
const anchor = 'setHeaders: (res, filePath) => {';
const start = server.lastIndexOf(anchor);
assert.ok(start >= 0, 'express.static must keep the cache header hook');
const end = server.indexOf('\n    }));', start);
assert.ok(end > start, 'static route setHeaders must remain inside express.static');
// Exercise the actual callback without importing the whole server or opening DB connections.
const callbackSource = server.slice(start + 'setHeaders: '.length, end).trim();
const setHeaders = runInNewContext('(' + callbackSource + ')');
const headers = (filename) => {
  const values = new Map();
  setHeaders({setHeader(name, value) {values.set(name.toLowerCase(), value);}}, '/opt/verto/dist' + filename);
  return Object.fromEntries(values);
};
for (const ext of ['js', 'mjs', 'css', 'json', 'svg', 'txt', 'xml']) {
  const h = headers('/assets/index-abc123.' + ext);
  assert.equal(h['cache-control'], 'public, max-age=31536000, immutable',
    'compressed text may be transformed but remains immutable: ' + ext);
  assert.equal(h['x-content-type-options'], 'nosniff');
}
for (const ext of ['webp', 'avif', 'jpg', 'gif', 'woff2', 'pdf']) {
  assert.equal(headers('/assets/picture-abc123.' + ext)['cache-control'],
    'public, max-age=31536000, immutable, no-transform', 'binary asset unchanged: ' + ext);
}
assert.equal(headers('/branding/verto/favicon.png')['cache-control'],
  'public, max-age=86400, must-revalidate, no-transform');
for (const file of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
  assert.match(headers(file)['cache-control'], /no-store/);
  assert.match(headers(file)['cache-control'], /no-transform/);
}
assert.equal(headers('/public-contract')['cache-control'], undefined,
  'no global cache header is added to API or unknown paths');
console.log('staticTextCompressionHeaders: PASS: text may compress; other assets, HTML and SW unchanged');
