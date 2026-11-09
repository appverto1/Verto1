import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareSiteInterestProspecting } from '../src/utils/siteInterestPriority.mjs';

const read=(file)=>readFileSync(file,'utf8');
const migration=read('supabase/migrations/20261108195000_sales_website_existing_customer_guard.sql');
const route=read('services/publicSalesLeadRoutes.ts');
const builder=read('src/components/SalesModularProposalBuilder.tsx');
const originalPriority=read('supabase/migrations/20261103130000_sales_website_interest_priority_v1.sql');
const kanban=read('src/components/CommercialKanban.tsx');

// Public registration only opens a new prospect when WhatsApp/email do not
// already map to a paid or converted clinic. The canonical upsert and
// FOR UPDATE matching lock protect both the normal and uniqueness-retry paths.
assert.match(migration, /create or replace function public\.upsert_public_sales_lead/i);
assert.match(migration, /if not v_created and exists \(/);
assert.match(migration, /existing\.status = 'converted'/);
assert.match(migration, /existing\.converted_clinic_id is not null/);
assert.match(migration, /existing\.converted_user_id is not null/);
assert.match(migration, /paid\.payment_confirmed_at is not null/);
assert.match(migration, /raise exception 'SALES_LEAD_ALREADY_CUSTOMER'/);
assert.ok(
  migration.indexOf('SALES_LEAD_ALREADY_CUSTOMER') <
  migration.indexOf('if not v_created then\n    update public.sales_leads'),
  'paid customer identity checked before changing any name/phone/consent',
);
assert.match(migration, /for update;/);
assert.match(migration, /revoke all on function public\.upsert_public_sales_lead/);
assert.match(migration, /to postgres,service_role/);
assert.doesNotMatch(migration, /update public\.sales_leads set status='new'/i);
assert.match(route, /errorMessage\.includes\(\s*"SALES_LEAD_ALREADY_CUSTOMER"/);
assert.match(route, /identityConflict \|\| existingCustomer \? 409 : 500/);
assert.match(route, /Não foi possível concluir este cadastro pelo formulário/);
assert.doesNotMatch(route, /"Cliente encontrado"|"Você já é cliente"/);
assert.match(originalPriority, /l\.status='new'/);
assert.match(originalPriority, /c\.slug<>'prospecting'/);
assert.match(kanban, /if\(col\.slug==='prospecting'\)/);
assert.deepEqual([
  {id:'old',siteInterestAt:'2026-11-08T12:00:00Z'},
  {id:'siteNew',siteInterestAt:'2026-11-08T14:00:00Z'},
  {id:'manual',createdAt:'2026-11-08T15:00:00Z'},
].sort(compareSiteInterestProspecting).map(x=>x.id),['siteNew','old','manual']);

// The contract email can be typed even if an old proposal exists, but the
// first keystroke creates an unsaved draft and never mutates frozen billing.
assert.doesNotMatch(builder,/disabled=\{contractEmailLocked\}/);
assert.match(builder,/disabled=\{Boolean\(busy\)\}/);
assert.match(builder,/normalizeContractEmail\(nextEmail\) !== frozenOfferContractEmail/);
assert.match(builder,/buildSalesModularProposalDuplicateDraft\(selectedSimulation, catalog\)/);
assert.match(builder,/setSelectedSimulationId\(''\)/);
assert.match(builder,/setCheckoutLink\(null\)/);
assert.match(builder,/setOfferAccepted\(false\)/);
assert.match(builder,/Clique em Salvar cenário e selecione-a/);
assert.match(builder,/contractEmail: frozenContractEmail/);

console.log('salesWebsiteSignupCustomerGuard20261108: PASS');
