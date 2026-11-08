import {readFileSync as readItem09Source} from 'node:fs';
import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const offerRoutes = fs.readFileSync('services/ownerSalesOfferCreationRoutes.ts', 'utf8');
const builder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260814100000_sales_offer_contract_identity.sql',
  'utf8'
);

const modularOfferPreparation = offerRoutes.match(
  /const prepareSalesModularOffer = async[\s\S]*?const prepareSalesOfferFromSimulation = async/
)?.[0] || '';
const modularCheckout = checkoutCoreSource.slice(checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async'));
const checkoutEmailRoute = server.match(
  /app\.post\(\s*"\/api\/owner\/sales\/offers\/:offerId\/modular-checkout\/email"[\s\S]*?app\.get\(/
)?.[0] || '';
const checkoutProcessor = stripePaidProcessorSource.match(/const processSalesAssistedCheckoutCompleted = async[\s\S]*?ITEM09_SOURCE_END/
)?.[0] || '';

assert.match(builder, /Identidade contratual/);
assert.match(builder, /E-mail do responsável/);
assert.match(builder, /contractEmail: frozenContractEmail/);
assert.match(builder, /useState\(''\)/, 'novo contrato não deve herdar silenciosamente o e-mail do lead');
assert.match(builder, /não é usado automaticamente/);
assert.match(builder, /!contractEmailValid/);
assert.doesNotMatch(builder, /disabled=\{contractEmailLocked\}/);
assert.match(builder, /disabled=\{Boolean\(busy\)\}/);
assert.match(builder, /normalizeContractEmail\(nextEmail\) !== frozenOfferContractEmail/);
assert.match(builder, /buildSalesModularProposalDuplicateDraft\(selectedSimulation, catalog\)/);
assert.match(builder, /setSelectedSimulationId\(''\)/);
assert.match(builder, /Clique em Salvar cenário e selecione-a/);
assert.match(builder, /historicalOfferMissingContractIdentity/);
assert.match(builder, /Duplicar cenário para nova proposta/);
assert.doesNotMatch(
  builder,
  /disabled=\{Boolean\(activeOfferId\)\}/,
  'offer histórico sem contract_email não pode tornar o campo impossível de editar'
);

assert.match(modularOfferPreparation, /PROPOSAL_CONTRACT_EMAIL_REQUIRED/);
assert.match(modularOfferPreparation, /create_sales_modular_offer_v3/);
assert.match(modularOfferPreparation, /p_contract_email: contractEmail/);
assert.match(modularOfferPreparation, /contractEmail,/);
assert.match(modularOfferPreparation, /persistedContractEmail !== contractEmail/);

assert.match(modularCheckout, /contract_email/);
assert.match(modularCheckout, /MODULAR_OFFER_CONTRACT_EMAIL_REQUIRED/);
assert.match(modularCheckout, /customer_email: contractEmail/);
assert.doesNotMatch(
  modularCheckout,
  /customer_email:\s*sanitizeEmail\(lead\./,
  'checkout modular não pode voltar a usar o e-mail mutável do lead'
);
assert.match(modularCheckout, /contractEmailHash/);
assert.match(checkoutEmailRoute, /select\("contract_email"\)/);
assert.doesNotMatch(checkoutEmailRoute, /normalized_email \|\| lead\?\.email/);

assert.match(checkoutProcessor, /contract_email/);
assert.match(checkoutProcessor, /metadata\.contractEmailHash/);
assert.match(checkoutProcessor, /confirm_sales_assisted_checkout_payment/);

assert.match(migration, /add column if not exists contract_email text/);
assert.match(migration, /create_sales_modular_offer_v3/);
assert.match(migration, /new\.contract_email is distinct from old\.contract_email/);
assert.match(migration, /v_offer\.offer_type = 'modular' and v_contract_email is not null/);
assert.match(migration, /v_current_email := v_contract_email/);
assert.doesNotMatch(
  migration.match(/create or replace function public\.create_sales_modular_offer_v3[\s\S]*?comment on function public\.create_sales_modular_offer_v3/)?.[0] || '',
  /update public\.sales_leads/,
  'criação da proposta não deve sobrescrever identidade histórica do lead'
);
console.log('salesContractIdentity.test.ts: OK');
