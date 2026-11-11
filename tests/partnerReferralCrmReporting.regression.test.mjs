import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration=readFileSync('supabase/migrations/20261111203000_verto_partner_referral_crm_reporting_v1.sql','utf8');
const partnerRoutes=readFileSync('services/partnerships/partnershipRoutes.ts','utf8');
const boardRoutes=readFileSync('services/salesProspectingRoutes.ts','utf8');
const kanban=readFileSync('src/components/CommercialKanban.tsx','utf8');
const owner=readFileSync('src/components/SuperAdminDashboard.tsx','utf8');
const report=readFileSync('src/components/OwnerPartnerReferralsPanel.tsx','utf8');
const publicLead=readFileSync('services/publicSalesLeadRoutes.ts','utf8');

test('public lead remains authoritative and canonical referral claim is idempotent',()=>{
  assert.match(publicLead,/upsert_public_sales_lead[\s\S]*?verto_claim_partner_referral_v1/);
  assert.match(publicLead,/p_idempotency_key: idempotencyKey/);
  assert.match(migration,/for update;/,'lead row must be locked before claiming');
  assert.match(migration,/e\.idempotency_key = p_idempotency_key/,'only same public registration may claim');
  assert.match(migration,/l\.created_at >= now\(\) - interval '1 day'/);
  assert.match(migration,/p\.status = 'approved' and p\.compliance_approved is true/);
  assert.match(migration,/on conflict \(sales_lead_id\) do nothing/,'cannot steal an existing referral');
  assert.match(migration,/lower\(l\.normalized_email\) = lower\(coalesce\(p\.contact_email/,'block self-referral');
  assert.match(migration,/entered_code\)\s*values \(v_partner_id,p_lead_id,'public_code',p_referral_code\)/,
    'persist the coupon actually entered, not only the partner current alias');
});
test('acquisition channel inserts exactly once without destroying manual channels',()=>{
  assert.match(migration,/after insert on public\.verto_partner_referrals/);
  assert.match(migration,/on conflict \(lead_id,channel_id\) do nothing/);
  assert.match(migration,/from public\.verto_partner_referrals r[\s\S]*?on conflict \(lead_id,channel_id\) do nothing/);
  assert.doesNotMatch(migration,/delete from public\.sales_lead_acquisition_channels/);
  assert.doesNotMatch(migration,/update public\.sales_leads/);
});
test('purchase counts require real positive Stripe payments and remain server-only',()=>{
  assert.match(migration,/il\.status='paid'[\s\S]*?il\.amount_paid_cents>0 and il\.paid_at is not null/);
  assert.match(migration,/il\.currency='brl'/);
  assert.match(migration,/revoke all on function public\.verto_owner_partner_referral_summary_v1\(\) from public,anon,authenticated/);
  assert.match(migration,/grant execute on function public\.verto_owner_partner_referral_summary_v1\(\) to service_role/);
  assert.match(partnerRoutes,/app\.get\('\/api\/owner\/partnerships\/referral-report',\.\.\.adminGuard/);
  assert.match(partnerRoutes,/app\.get\('\/api\/owner\/partnerships\/referral-report\/:partnerId',\.\.\.adminGuard/);
  assert.match(partnerRoutes,/Number\.isSafeInteger\(offset\)/);
  assert.match(partnerRoutes,/verto_partner_referral_overview_v1/);
});
test('Kanban reuses its batched board endpoint, with optional referral read',()=>{
  assert.match(boardRoutes,/priorityLeads\.map\(\(lead:any\)=>lead\.id\)/);
  assert.match(boardRoutes,/from\('verto_partner_referrals'\)[\s\S]*?\.in\('sales_lead_id',visibleIds\)\.limit\(200\)/);
  assert.match(boardRoutes,/if\(!report\.error\)referrals=/);
  assert.match(boardRoutes,/return res\.json\(\{success: true, columns:[\s\S]*?priorityLeads, referrals\}/);
  assert.match(kanban,/setReferralsByLead\(referred\)/);
  assert.match(kanban,/Aquisição: Indicação/);
  assert.match(kanban,/Parceiro: \{partnerReferral\.partnerName\}/);
  assert.match(kanban,/Cupom: \{partnerReferral\.couponCode\}/);
});
test('Super Admin has a separate partner attribution menu with on-demand details',()=>{
  assert.match(owner,/label="Indicações" active=\{activeTab === 'partner-referrals'\}/);
  assert.match(owner,/activeTab === 'partner-referrals' && <OwnerPartnerReferralsPanel \/>/);
  assert.match(report,/referral-report\?offset=0/);
  assert.match(report,/referral-report\/'\+encodeURIComponent\(id\)/);
  assert.match(report,/status==='converted'/);
  assert.match(report,/if\(item\.has_paid\)return 'Compra confirmada'/);
});
