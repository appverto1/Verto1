import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261102110500_organization_loyalty_12m_drafts.sql');
const routes = read('services/ownerLoyaltyDraftRoutes.ts');
const bridge = read('services/salesProspectingRoutes.ts');
const dashboard = read('src/components/SuperAdminDashboard.tsx');
const panel = read('src/components/OwnerLoyaltyDraftPanel.tsx');

test('loyalty is a non-binding fixed 12-month draft, never automatic billing', () => {
  assert.match(migration, /duration_months smallint not null default 12 check \(duration_months = 12\)/);
  assert.match(migration, /penalty_policy = 'proportional_pending_legal_review'/);
  assert.match(migration, /status text not null default 'draft' check \(status = 'draft'\)/);
  assert.match(migration, /legal_review_status = 'pending_review'/);
  assert.doesNotMatch(routes, /stripe\.(subscriptions|invoices|paymentIntents)/i);
  assert.doesNotMatch(routes, /\.from\(['"](?:clinics|patients|organization_billing_access_state|organization_billing_contracts)['"]\)\.update/);
});

test('tenant and subscription chosen by database and draft writes are idempotent', () => {
  assert.match(migration, /unique \(organization_id\)/);
  assert.match(migration, /on conflict \(organization_id\) do nothing/);
  assert.match(migration, /state\.organization_id = p_organization_id/);
  assert.match(migration, /state\.stripe_status = 'active'/);
  assert.match(migration, /state\.first_paid_at is not null or state\.last_paid_at is not null/);
  assert.match(migration, /v_row\.stripe_subscription_id is distinct from v_subscription_id/);
  assert.match(migration, /p_actor_user_id and pa\.active is true/);
  assert.doesNotMatch(routes, /p_stripe_subscription_id/);
});

test('owner MFA and Supabase permissions fail closed', () => {
  assert.match(routes, /const guard = \[checkAuth, checkPlatformAdmin, stagingOnly\]/);
  assert.match(routes, /VERTO_LOYALTY_STAGING_ENABLED/);
  assert.match(routes, /RAILWAY_ENVIRONMENT_NAME/);
  assert.match(routes, /Object\.keys\(body\)\.length !== 1/);
  assert.match(bridge, /registerOwnerLoyaltyDraftRoutes\(app,\{supabase,checkAuth,checkPlatformAdmin,isUuid\}\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.organization_loyalty_drafts from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.create_organization_loyalty_draft_v1\(uuid, uuid\)\s+to service_role/);
});

test('new owner UI is isolated behind a staging build feature and updates without reload', () => {
  assert.match(dashboard, /VITE_FEATURE_LOYALTY_STAGING === 'true' && <OwnerLoyaltyDraftPanel \/>/);
  assert.match(panel, /setRows\(\(current\) => current\.map/);
  assert.match(panel, /Preparar minuta/);
  assert.match(panel, /Nenhum aceite, cobrança|nenhum aceite, cobrança/);
  assert.doesNotMatch(panel, /window\.location\.reload\(/);
});
