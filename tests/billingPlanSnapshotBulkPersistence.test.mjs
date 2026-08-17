import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const start = server.indexOf('async function syncStripeBillingPlanSnapshots');
const end = server.indexOf('async function loadBillingPlansFromSnapshots', start);
assert.ok(start >= 0 && end > start, 'billing plan snapshot sync function must exist');
const fn = server.slice(start, end);

assert.match(fn, /const snapshotPayloads = plans\.map/);
assert.match(fn, /\.upsert\(snapshotPayloads, \{ onConflict: 'stripe_price_id' \}\)/);
assert.match(fn, /const priceIdsToDeactivate =/);
assert.match(fn, /\.in\('stripe_price_id', priceIdsToDeactivate\)/);
assert.doesNotMatch(fn, /for \(const plan of plans\)[\s\S]*?await supabase/);
assert.doesNotMatch(fn, /for \(const row of Array\.isArray\(existingRows\)[\s\S]*?await supabase/);

console.log('billingPlanSnapshotBulkPersistence.test.mjs: ok');
