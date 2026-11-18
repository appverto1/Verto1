import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('owner-only Kanban board reports partner referrals with one capped batch read',()=>{
  const routes=readFileSync('services/salesProspectingRoutes.ts','utf8');
  const start=routes.indexOf("app.get('/api/owner/sales/kanban/board'");
  const end=routes.indexOf("app.post('/api/owner/sales/kanban/columns'");
  assert.ok(start>=0 && end>start);
  const board=routes.slice(start,end);
  assert.match(board,/\.\.\.salesGuard/,'owner authentication and MFA remain required');
  assert.match(board,/from\('verto_partner_referrals'\)/);
  assert.match(board,/select\('sales_lead_id,entered_code,verto_partner_accounts\(display_name,referral_alias,referral_code\)'\)/);
  assert.match(board,/\.in\('sales_lead_id',visibleIds\)\.limit\(200\)/);
  assert.match(board,/new Set\(\[\.\.\.leadIds,\.\.\.priorityLeads\.map/,'deduplicates and includes priority leads');
  assert.match(board,/\.slice\(0,200\)/,'caps referral batch');
  assert.match(board,/partnerName:partner\?\.display_name/);
  assert.match(board,/couponCode:item\.entered_code\|\|null/,'the submitted code must not be fabricated');
  assert.match(board,/partnerCouponCode:partner\?\.referral_alias\|\|partner\?\.referral_code/,'shows current coupon separately');
  assert.match(board,/priorityLeads, referrals/,'returns the attribution labels to the frontend');
});

test('Kanban displays attributed partner in card and detail without changing lead persistence',()=>{
  const ui=readFileSync('src/components/CommercialKanban.tsx','utf8');
  assert.match(ui,/const \[referralsByLead,setReferralsByLead\]/);
  assert.match(ui,/for\(const item of page\.board\.referrals\|\|\[\]\)/);
  assert.match(ui,/setReferralsByLead\(referred\)/);
  assert.match(ui,/partnerReferral=referralsByLead\[lead\.id\]/);
  assert.match(ui,/Parceiro: \{partnerReferral\.partnerName\}/);
  assert.match(ui,/Cupom informado: \{partnerReferral\.couponCode\}/);
  assert.match(ui,/Cupom atual do parceiro: \{partnerReferral\.partnerCouponCode\}/);
  assert.match(ui,/aria-label="Indicação do parceiro"/);
  assert.match(ui,/\{referralsByLead\[selected\.id\]\.partnerName\}/);
  assert.match(ui,/onClick=\{\(\)=>void saveLeadDetails\(\)\}/,'existing Save authority unchanged');
});
