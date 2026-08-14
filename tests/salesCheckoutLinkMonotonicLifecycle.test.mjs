import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const lifecycle = server.match(/const linkStatus = event\.type === "invoice\.payment_failed"[\s\S]*?if \(linkLifecycleError\) throw linkLifecycleError;/)?.[0] || '';

assert.match(lifecycle, /linkStatus !== "completed"/);
assert.match(lifecycle, /\.neq\("status", "completed"\)/);
assert.match(lifecycle, /payment_completed_at/);
assert.match(lifecycle, /sales_checkout_links/);

console.log('salesCheckoutLinkMonotonicLifecycle.test.mjs: ok');
