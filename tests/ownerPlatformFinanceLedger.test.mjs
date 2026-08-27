import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260827153000_platform_financial_ledger_and_subscription_state.sql', import.meta.url), 'utf8');

assert.match(server, /platform_billing_invoice_ledger/, 'owner DRE must use the real platform invoice ledger');
assert.match(server, /platform_subscription_financial_state/, 'subscription trial/payment state must be persisted');
assert.match(server, /allocationMethod:\s*'contribution_share_pre_fixed'/, 'fixed pool must be allocated by pre-fixed contribution');
assert.match(server, /trialRevenueExcluded:\s*true/, 'trial revenue must be excluded from realized DRE');
assert.match(server, /first_paid_at/, 'paying-client scope must require a confirmed payment');
assert.doesNotMatch(server.slice(server.indexOf("app.get('/api/owner/clients'"), server.indexOf("app.get('/api/owner/financial-feature-surveys'")), /\.from\('users'\)\s*\.select\('id, name, email, plan_name, plan_price/, 'owner client base must not be a raw user list');

assert.match(adminUi, /Clientes Pagantes/, 'dashboard must distinguish paying clients from trials');
assert.match(adminUi, /Trials em andamento/, 'dashboard must expose trial pipeline separately');
assert.match(adminUi, /previsto após o trial/, 'trial amount must be labeled as projected, not realized');

assert.match(migration, /enable row level security/i, 'platform finance tables must use RLS');
assert.match(migration, /revoke all on table public\.platform_billing_invoice_ledger from public, anon, authenticated/i, 'ledger must not be client-readable');

console.log('ownerPlatformFinanceLedger.test: PASS');
