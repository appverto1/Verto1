import assert from 'node:assert/strict';
import { ORGANIZATION_MODULE_KEYS } from '../src/constants/organizationModules';
import { normalizeModuleSet, isDemoSession, loadCanonicalDirectOffers } from '../services/modulePurchaseEligibilitySupport';

const purchasable = ORGANIZATION_MODULE_KEYS.find((key) => key !== 'clinical_core');
assert.ok(purchasable, 'at least one optional module must exist');
assert.deepEqual(normalizeModuleSet(['clinical_core', purchasable, purchasable, '', 'not-a-module', undefined]), ['clinical_core', purchasable].sort());
assert.deepEqual(normalizeModuleSet(new Set([purchasable, 'clinical_core'])), ['clinical_core', purchasable].sort());
assert.deepEqual(normalizeModuleSet([]), []);
assert.equal(isDemoSession(null), false);
assert.equal(isDemoSession({ billingModel: 'demo_sandbox' }), true);
assert.equal(isDemoSession({ is_demo_user: true }), true);
assert.equal(isDemoSession({ clinicId: 'clinic-1', workspaces: [{ clinicId: 'clinic-1', isDemo: true }] }), true);
assert.equal(isDemoSession({ clinicId: 'clinic-1', workspaces: [{ clinicId: 'clinic-2', isDemo: true }] }), false);
assert.equal(isDemoSession({ clinicId: 'clinic-1', workspaces: [{ clinicId: 'clinic-1', billing_model: 'DEMO_SANDBOX' }] }), true);

const makeQuery = (data: any) => {
  const query: any = {};
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in']) query[method] = () => query;
  query.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return query;
};
const visited: string[] = [];
const offerId = 'offer-1';
const supabase = {
  from(table: string) {
    visited.push(table);
    if (table === 'sales_leads') return makeQuery([{ id: 'lead-1' }]);
    if (table === 'sales_offers') return makeQuery([{ id: offerId, status: 'accepted', expires_at: '2100-01-01T00:00:00Z', modular_checkout_enabled: true }]);
    if (table === 'sales_offer_items') return makeQuery([{ offer_id: offerId, item_key: 'clinical_core' }, { offer_id: offerId, item_key: purchasable }]);
    throw new Error('unexpected table: ' + table);
  },
};
const direct = await loadCanonicalDirectOffers(supabase, 'clinic-1', []);
assert.equal(direct.get(purchasable!), offerId);
assert.deepEqual(visited, ['sales_leads', 'sales_offers', 'sales_offer_items']);
assert.equal(direct.size, 1);

const emptyVisited: string[] = [];
const empty = await loadCanonicalDirectOffers({
  from(table: string) { emptyVisited.push(table); return makeQuery([]); },
}, 'clinic-1', []);
assert.equal(empty.size, 0);
assert.deepEqual(emptyVisited, ['sales_leads']);
console.log('modulePurchaseEligibilitySupport: ok');
