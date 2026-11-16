import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync('supabase/migrations/20261116164217_partner_tiered_commissions_v1.sql','utf8');
const routes=readFileSync('services/partnerships/partnershipRoutes.ts','utf8');
const panel=readFileSync('src/components/PartnershipPanel.tsx','utf8');

test('qualifying client receives six, nine or twelve months according to count including itself',()=>{
  assert.match(sql,/when p_count >= 6 then 12::smallint/);
  assert.match(sql,/when p_count >= 3 then 9::smallint/);
  assert.match(sql,/v_existing\+1/);
  assert.match(sql,/limit 2/);
  assert.match(sql,/select distinct on \(i\.period_start\)/);
  assert.match(sql,/i\.billing_reason in \('subscription_create','subscription_cycle'\)/);
  assert.match(sql,/i\.status='paid'/);
  assert.match(sql,/lower\(i\.currency\)='brl'/);
});

test('immutable per-referral term survives later cancellation or downgrade',()=>{
  assert.match(sql,/referral_id uuid primary key references public\.verto_partner_referrals/);
  assert.match(sql,/on conflict \(referral_id\) do nothing/);
  assert.match(sql,/v_first_paid\+make_interval\(months=>v_term\)/);
  assert.match(sql,/s\.canceled_at between p_as_of - interval '30 days' and p_as_of/);
  assert.match(sql,/s\.stripe_status='past_due'/);
  assert.match(sql,/t\.first_paid_at >= p_as_of - interval '12 months'/);
  assert.doesNotMatch(sql,/update public\.verto_partner_referral_terms/);
});

test('privilege boundaries and canonical paid ledger remain unchanged',()=>{
  assert.match(sql,/alter table public\.verto_partner_referral_terms enable row level security/);
  assert.match(sql,/revoke all on public\.verto_partner_referral_terms from public, anon, authenticated/);
  assert.match(sql,/revoke all on function public\.verto_partner_tier_dashboard_v1\(uuid\)/);
  assert.match(sql,/grant execute on function public\.verto_partner_tier_dashboard_v1\(uuid\)\s+to service_role/);
  assert.match(routes,/verto_partner_tier_dashboard_v1/);
  assert.match(routes,/found\.data\.status!=='approved'/);
  assert.match(routes,/\.eq\('user_id',userId\)/);
  assert.doesNotMatch(sql,/create or replace function public\.stripe_/);
  assert.doesNotMatch(sql,/insert into public\.platform_billing_invoice_ledger/);
  assert.match(panel,/Direito de \{item\.term_months\} meses/);
});
