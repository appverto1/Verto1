import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261102110500_organization_loyalty_12m_drafts.sql');
const owner = read('services/ownerLoyaltyDraftRoutes.ts');
const clinic = read('services/clinicLoyaltyReviewRoutes.ts');
const ownerBridge = read('services/salesProspectingRoutes.ts');
const clinicBridge = read('services/clinicAppointmentPolicyRoutes.ts');
const dashboard = read('src/components/SuperAdminDashboard.tsx');
const settings = read('src/components/SettingsMenu.tsx');
const adminUi = read('src/components/OwnerLoyaltyDraftPanel.tsx');
const clinicUi = read('src/components/ClinicLoyaltyTermsPreview.tsx');
const terms = read('src/constants/loyaltyTermsDraft.ts');

test('12-month contractual period and proportional ceiling are fixed in immutable template', () => {
  assert.match(migration, /duration_months smallint not null default 12 check \(duration_months = 12\)/);
  assert.match(migration, /status in \('draft', 'offered', 'accepted'\)/);
  assert.match(terms, /6\.3\. A multa terá como teto inicial o equivalente a 2 \(duas\) mensalidades/);
  assert.match(terms, /dias restantes de fidelidade ÷ dias totais do período de fidelidade/);
  assert.match(terms, /3\.2\. O prazo não será contado retroativamente/);
  assert.match(terms, /4\.3\. Na ausência de contrapartida válida e demonstrável/);
  assert.match(terms, /9\.1\. A CONTRATANTE poderá aderir a este termo/);
  assert.match(terms, /DECLARAÇÃO DE ACEITE/);
});

test('paid subscription and clinic are always server owned, with idempotent transitions', () => {
  assert.match(migration, /unique \(organization_id\)/);
  assert.match(migration, /on conflict \(organization_id\) do nothing/);
  assert.match(migration, /state\.organization_id = p_organization_id/);
  assert.match(migration, /state\.stripe_status = 'active'/);
  assert.match(migration, /v_row\.stripe_subscription_id is distinct from v_subscription_id/);
  assert.match(migration, /for update/);
  assert.match(migration, /p_terms_sha256/);
  assert.match(migration, /accepted_by = p_actor_user_id/);
  assert.match(migration, /effective_end_date = \(p_effective_start_date \+ interval '12 months'/);
  assert.doesNotMatch(owner, /p_stripe_subscription_id/);
  assert.match(owner, /renderLoyaltyTermsV1/);
});

test('owner-only publish and director-only explicit consent are independent', () => {
  assert.match(owner, /const guard = \[checkAuth, checkPlatformAdmin, stagingOnly\]/);
  assert.match(owner, /Object\.keys\(body\)\.length !== fields\.length/);
  assert.match(ownerBridge, /registerOwnerLoyaltyDraftRoutes\(app,\{supabase,checkAuth,checkPlatformAdmin,isUuid\}\)/);
  assert.match(clinic, /requireClinicCapability\('clinic\.settings\.edit'\)/);
  assert.match(clinic, /role !== 'director'/);
  assert.match(clinic, /body\.acceptTerms !== true/);
  assert.match(migration, /cm\.clinic_id = p_organization_id and cm\.user_id = p_actor_user_id/);
  assert.match(migration, /cm\.role = 'director' and cm\.status = 'active'/);
  assert.match(clinicBridge, /registerClinicLoyaltyReviewRoutes\(app, deps\)/);
});

test('both endpoints and UI fail closed outside staging project', () => {
  for (const source of [owner,clinic]) {
    assert.match(source, /VERTO_LOYALTY_STAGING_ENABLED/);
    assert.match(source, /VERTO_DEPLOYMENT_ENV !== 'staging'/);
    assert.match(source, /SUPABASE_EXPECTED_PROJECT_REF !== 'irspungjhapqdbgqroyc'/);
    assert.doesNotMatch(source, /stripe\.(subscriptions|invoices|paymentIntents)/i);
  }
  assert.match(dashboard, /VITE_FEATURE_LOYALTY_STAGING === 'true' && <OwnerLoyaltyDraftPanel \/>/);
  assert.match(settings, /VITE_FEATURE_LOYALTY_STAGING === 'true'/);
});

test('RLS, service role RPC grants, and no mutation of clinical or billing state', () => {
  assert.match(migration, /alter table public\.organization_loyalty_drafts enable row level security/);
  assert.match(migration, /revoke all on table public\.organization_loyalty_drafts from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.accept_organization_loyalty_offer_v1\(uuid,uuid,text,boolean\)/);
  assert.doesNotMatch(owner + clinic, /\.from\(['"](?:patients|organization_billing_access_state|organization_billing_contracts)['"]\)\.update/);
});

test('Save is the owner of persistence, checkbox is unchecked and requires click to accept', () => {
  assert.match(adminUi, /Salvar e disponibilizar ao diretor/);
  assert.match(adminUi, /setRows\(\(current\) => current\.map/);
  assert.match(clinicUi, /useState\(false\)/);
  assert.match(clinicUi, /checked=\{checked\}/);
  assert.match(clinicUi, /disabled=\{!review\.canAccept \|\| !checked \|\| saving\}/);
  assert.match(clinicUi, /Confirmar aceite/);
  assert.match(clinicUi, /acceptTerms:true, termsSha256:review\.termsSha256/);
  assert.match(clinicUi, /Salvar cópia/);
  assert.doesNotMatch(clinicUi + adminUi, /window\.location\.reload\(/);
});
