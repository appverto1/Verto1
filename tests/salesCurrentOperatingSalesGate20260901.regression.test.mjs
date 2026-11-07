import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const builder = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const offerRoutes = readFileSync('services/ownerSalesOfferCreationRoutes.ts', 'utf8');
const currentOperating = readFileSync('src/utils/salesCurrentOperatingEconomics.ts', 'utf8');

assert.match(
  builder,
  /filterSalesCurrentOperatingTechnicalBlockers/
);
assert.match(builder, /proposalTechnicalBlockingCodes/);
assert.match(builder, /selectedSimulationTechnicalBlockingCodes/);
assert.doesNotMatch(
  builder,
  /selectedSimulation\.results_snapshot\?\.missingCosts\?\.length\s*>\s*0/
);
assert.match(
  builder,
  /Boolean\(proposalTechnicalBlockingCodes\.length\)/
);
assert.match(
  builder,
  /Boolean\(selectedSimulationTechnicalBlockingCodes\.length\)/
);
assert.match(builder, /Custos incompletos · aviso/);
assert.match(builder, /Avisos econômicos não bloqueantes/);

assert.match(
  server,
  /import \{ filterSalesCurrentOperatingTechnicalBlockers \} from '\.\/src\/utils\/salesCurrentOperatingEconomics';/
);

const saveRouteStart = server.indexOf('"/api/owner/sales/leads/:leadId/modular-simulations"', server.indexOf('app.post('));
const publicOfferStart = server.indexOf('registerOwnerSalesOfferCreationRoute({');
assert.ok(saveRouteStart >= 0 && publicOfferStart > saveRouteStart, 'save/public-offer route boundaries not found');
const saveRoute = server.slice(saveRouteStart, publicOfferStart);
assert.match(saveRoute, /const review = classifySalesProposalReview\(results\);/);
assert.match(saveRoute, /filterSalesCurrentOperatingTechnicalBlockers\([\s\S]*?review\.technicalBlockingCodes/);
assert.match(saveRoute, /commercialReview:\s*\{[\s\S]*?\.\.\.effectiveReview/);

const legacyOfferStart = offerRoutes.indexOf('const prepareSalesOfferFromSimulation = async');
assert.ok(legacyOfferStart > offerRoutes.indexOf('const prepareSalesModularOffer = async'), 'public-offer route end not found');
const publicOffer = offerRoutes.slice(offerRoutes.indexOf('const prepareSalesModularOffer = async'), legacyOfferStart);
assert.doesNotMatch(publicOffer, /if \(recalculated\.missingCosts\.length > 0\)/);
assert.doesNotMatch(publicOffer, /Complete os custos das funcionalidades antes de gerar a proposta/);
assert.match(publicOffer, /proposalTechnicalBlockingCodes = filterSalesCurrentOperatingTechnicalBlockers/);
assert.match(publicOffer, /blockingCodes: proposalTechnicalBlockingCodes/);

const checkoutStart = checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async');
const checkoutRouteStart = checkoutCoreSource.indexOf('return createOrReuseModularCheckout;', checkoutStart);
assert.ok(checkoutStart >= 0 && checkoutRouteStart > checkoutStart, 'checkout boundaries not found');
const checkout = checkoutCoreSource.slice(checkoutStart, checkoutRouteStart);
assert.match(checkout, /frozenTechnicalBlockingCodes = filterSalesCurrentOperatingTechnicalBlockers/);
assert.match(checkout, /blockingCodes: frozenTechnicalBlockingCodes/);

// The existing current-operating policy intentionally keeps only structural
// customer-price/reconciliation failures as blockers. Cost/driver completeness
// remains observable, but cannot be silently converted to zero or stop a sale.
assert.match(currentOperating, /COMMERCIAL_PRICE_PER_PATIENT_MISSING:/);
assert.match(currentOperating, /PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:/);
assert.match(currentOperating, /code === 'PRICING_TOTAL_MISMATCH'/);
assert.doesNotMatch(
  currentOperating.match(/const CURRENT_OPERATING_STRUCTURAL_BLOCKERS =[\s\S]*?as const;/)?.[0] || '',
  /PRICING_COST_MODEL_MISSING|REQUIRED_DRIVER_MISSING|ECONOMICS_INSUFFICIENT_DATA/
);

console.log('salesCurrentOperatingSalesGate20260901.regression.test.mjs: OK');
