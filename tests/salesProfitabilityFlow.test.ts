import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyEngine = fs.readFileSync('src/utils/salesProfitability.ts', 'utf8');
const modularEngine = fs.readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.doesNotMatch(legacyEngine, /customBasePackageLimit/);
assert.doesNotMatch(legacyEngine, /basePackageSelectionMode/);
assert.match(modularEngine, /customBasePackageLimit/);
assert.match(server, /offer_type, 30\) === "modular"/);
assert.doesNotMatch(server, /PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED/);
assert.match(server, /create_sales_modular_offer_v2/);

console.log('salesProfitabilityFlow.test.ts: OK');
