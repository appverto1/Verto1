import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const builder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const draftInput = fs.readFileSync('src/utils/salesModularProposalBuilderInput.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const calculator = fs.readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const stripePlan = fs.readFileSync('src/utils/salesCommercialEvolution.ts', 'utf8');

// New proposals must be explicitly versioned, and patient changes must
// update the commercial band in both directions without changing seat prices.
assert.match(builder, /exactPerPatientBilling: true/);
assert.match(builder, /input\.exactPerPatientBilling === true\s*\? automaticCapacity/);
assert.match(builder, /Faixa comercial automática, sem seleção de blocos de cobrança/);
assert.doesNotMatch(builder, /Para alterar, escolha 10, 20, 30, 40, 50/);
assert.match(builder, /hasVersionedCustomCapacityPolicy && input\.exactPerPatientBilling !== true/);
assert.match(builder, /disabled=\{input\.exactPerPatientBilling === true\}/);
assert.match(builder, /input\.exactPerPatientBilling !== true && nextStandardCommercialCapacity/);

// Only newly versioned exact-seat proposals use 50-patient Essencial capacity.
// Legacy snapshots retain their original ten-patient block-selection semantics.
assert.match(draftInput, /export const commercialCapacityForExactDemand =/);
assert.match(builder, /const initialCapacity = commercialCapacityForExactDemand\(patientQuantity\);/);
assert.match(builder, /input\.exactPerPatientBilling === true\s*\? commercialCapacityForExactDemand\(safeQuantity\)/);
assert.match(builder, /snapshotInput\.exactPerPatientBilling === true\s*\? commercialCapacityForExactDemand\(snapshotDemand\)/);
assert.match(builder, /Plano Essencial · 1 a 50 pacientes/);

// An immutable historical offer must not silently become exact-seat billing.
assert.match(builder, /selectedSimulation\.modular_input_snapshot\?\.exactPerPatientBilling !== true/);
assert.match(builder, /Proposta anterior — cobrança por capacidade/);
assert.match(builder, /disabled=\{Boolean\(busy\) \|\| selectedLegacyBilling\}/);
assert.match(builder, /Não use o link antigo como se fosse por paciente ativo/);

// Seller sees the exact quantity, each recurring module's price, and
// the frozen post-promotion amount before creating a Checkout link.
assert.match(builder, /Cobrança exata por paciente ativo/);
assert.match(builder, /Pacientes faturados:/);
assert.match(builder, /summaryInput\.patientQuantity/);
assert.match(builder, /line\.commercialPricing\.proposedPricePerPatientCents/);
assert.match(builder, /summaryPreview\.postPromotionRecurringRevenueCents/);
assert.match(builder, /catalog\.items\.some\(\(item\) => item\.itemKey === line\.itemKey && item\.billingInterval === 'monthly'\)/);

// The backend must derive Stripe seat quantities from the frozen exact model;
// mere UI wording must never replace the server-side payment contract.
assert.match(server, /exactPerPatientBilling: source\.exactPerPatientBilling === true/);
assert.match(checkoutCoreSource, /quantity: Number\(line\.quantity \|\| 1\)/);
assert.match(calculator, /contractedCapacityPatients: exactPerPatientBilling \? input\.patientQuantity/);
assert.match(stripePlan, /exactPerPatientBilling === true/);
console.log('salesExactPatientCheckoutUiP0000.regression.test.mjs: PASS');
