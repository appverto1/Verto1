import assert from 'node:assert/strict';
import { lineIdentity, invoiceIdList } from '../services/moduleSubscriptionUpgradeInvoiceEvidence';

assert.equal(lineIdentity({ metadata: { revenue_line: ' clinic_core ' }, price: { metadata: { revenue_line: 'other' }, product: { metadata: { revenue_line: 'third' } } } }), 'clinic_core', 'item metadata takes precedence');
assert.equal(lineIdentity({ price: { metadata: { revenue_line: 'addon' }, product: { metadata: { revenue_line: 'third' } } } }), 'addon', 'price metadata fallback');
assert.equal(lineIdentity({ price: { product: { metadata: { revenue_line: 'platform_foundation' } } } }), 'platform_foundation', 'product metadata fallback');
assert.equal(lineIdentity({ price: { product: 'prod_123' } }), '', 'unknown identity rejects in caller');
assert.equal(lineIdentity(null), '', 'missing stripe item');
assert.equal(lineIdentity({ metadata: { revenue_line: ' '.repeat(3) }, price: { metadata: { revenue_line: 'addon' } } }), '', 'retain pre-trim identity selection');
assert.equal(lineIdentity({ metadata: { revenue_line: 'a'.repeat(140) } }).length, 100, 'identity max length');
assert.deepEqual(invoiceIdList({ metadata: { vertoUpgradeProrationInvoiceId: ' in_proration ', vertoUpgradeOneTimeInvoiceId: 'in_onetime' }, latest_invoice: { id: 'in_latest' } }), ['in_proration', 'in_onetime', 'in_latest']);
assert.deepEqual(invoiceIdList({ metadata: { vertoUpgradeProrationInvoiceId: 'in_1', vertoUpgradeOneTimeInvoiceId: 'in_1' }, latest_invoice: 'in_1' }), ['in_1'], 'deduplicate invoice evidence');
assert.deepEqual(invoiceIdList({ metadata: { vertoUpgradeProrationInvoiceId: 'in_1', vertoUpgradeOneTimeInvoiceId: 'in_2' }, latest_invoice: 'in_1' }), ['in_1', 'in_2'], 'preserve evidence order');
assert.deepEqual(invoiceIdList({ latest_invoice: { id: 'in_3' } }), ['in_3'], 'expanded latest invoice');
assert.deepEqual(invoiceIdList({ latest_invoice: 'in_3' }), ['in_3'], 'string latest invoice');
assert.deepEqual(invoiceIdList({}), [], 'no forged invoice evidence');
assert.deepEqual(invoiceIdList(null), [], 'null subscription');
assert.equal(invoiceIdList({ latest_invoice: 'a'.repeat(150) })[0].length, 120, 'invoice id max length');
console.log('moduleSubscriptionUpgradeInvoiceEvidence: PASS');
