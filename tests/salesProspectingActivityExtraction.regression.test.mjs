import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const backend=readFileSync('services/salesProspectingRoutes.ts','utf8');
const activity=readFileSync('services/salesProspectingActivityRoutes.ts','utf8');
const movement=readFileSync('services/salesKanbanMovementRoutes.ts','utf8');
const transport=readFileSync('src/services/salesKanbanActivity.ts','utf8');
const ui=readFileSync('src/components/CommercialKanban.tsx','utf8');
const boardSql=readFileSync('supabase/migrations/20261027185000_sales_kanban_custom_columns_analytics_v1.sql','utf8');
const fnv=(text)=>{let h=0x811c9dc5;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};
const extract=(source,needle)=>{
  const start=source.indexOf(needle);
  const end=source.lastIndexOf('\n}\n');
  assert.ok(start>=0&&end>start,'extracted route boundary changed');
  return source.slice(start,end+1);
};

test('original activity and movement handlers were extracted without changing a single source character',()=>{
  assert.equal(fnv(extract(activity,"  app.get('/api/owner/sales/prospecting/attempts'")),'e09a3722');
  assert.equal(fnv(extract(movement,"  app.post('/api/owner/sales/kanban/leads/:leadId/move'")),'03261a81');
  assert.doesNotMatch(backend,/app\.get\('\/api\/owner\/sales\/prospecting\/attempts'/);
  assert.doesNotMatch(backend,/app\.post\('\/api\/owner\/sales\/kanban\/leads\/:leadId\/move'/);
  assert.match(backend,/registerSalesProspectingActivityRoutes\(app,\{supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString\}\)/);
  assert.match(backend,/registerSalesKanbanMovementRoutes\(app,\{supabase,salesGuard,isUuid,sanitizeString,boardError\}\)/);
  assert.equal((backend.match(/registerSalesProspectingActivityRoutes\(app,/g)||[]).length,1);
  assert.equal((backend.match(/registerSalesKanbanMovementRoutes\(app,/g)||[]).length,1);
});

test('session MFA and database remain authoritative; no write on history load or preview',()=>{
  assert.match(backend,/const salesGuard = \[checkAuth, checkPlatformAdmin\]/);
  assert.match(activity,/app\.get\('\/api\/owner\/sales\/prospecting\/attempts', checkAuth, checkPlatformAdmin/);
  assert.match(movement,/app\.post\('\/api\/owner\/sales\/kanban\/leads\/:leadId\/move', \.\.\.salesGuard/);
  assert.match(movement,/p_lead_id:leadId,p_column_id:columnId,p_actor_id:actorId,p_action_key:key/);
  assert.match(movement,/\.from\('sales_kanban_columns'\)\.select\('kind'\)/);
  assert.doesNotMatch(movement,/\.select\('\*'\)/);
  assert.match(activity,/\.select\('id,lead_id,channel,outcome,occurred_at,script_version_id,contact_result'\)/);
  assert.match(activity,/\.limit\(1000\)/);
  assert.match(activity,/\.in\('lead_id',leadIds\)/);
  assert.match(activity,/save_sales_prospecting_attempt_time_v2/);
  assert.match(activity,/save_sales_decisor_contact_v2/);
  assert.match(activity,/save_sales_contact_followup_v1/);
  assert.match(activity,/mark_sales_lead_lost_with_reason_v1/);
  assert.match(boardSql,/sales_kanban_movements/);
  assert.match(boardSql,/for update;/);
  assert.match(boardSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(boardSql,/PAYMENT_REQUIRED_FOR_CONVERSION/);
  assert.match(boardSql,/grant execute on function public\.move_sales_kanban_lead_v1[\s\S]*to service_role;/);
});

test('all saves remain explicit, update local state after success, and retain existing channels',()=>{
  assert.match(ui,/const json=await moveSalesKanbanLead\(request,lead.id,column.id,key\)/);
  assert.match(ui,/onLeadPatch\(lead.id,\{status:json\.data\.status,lostAt:json\.data\.lostAt,updatedAt:json\.data\.updatedAt\}\)/);
  assert.match(ui,/if\(column\.kind==='lost'\)\{[\s\S]*?setLossDialog\(/);
  assert.match(ui,/onClick=\{\(\)=>void saveLoss\(\)\}/);
  assert.match(ui,/const json=await persistSalesLoss\(request,id,key,lossReasonDraft\)/);
  assert.match(ui,/const json=await persistSalesAttemptTime\(request,draft\.leadId,key,/);
  assert.match(ui,/const json=await persistSalesDecisorContact\(request,lead\.id,key,/);
  assert.match(ui,/const json=await persistSalesFollowup\(request,lead\.id,key,contactDueAt\)/);
  assert.match(ui,/chunk\.length \? loadSalesProspectingHistory\(request,q\) : Promise\.resolve\(\{data:\[\],leads:\[\]\}\)/);
  assert.match(ui,/setAcquisitionByLead/);
  assert.match(ui,/saveAcquisition/);
  assert.match(ui,/onLeadPatch\(id,\{status:json\.data\.status,lostAt:json\.data\.lostAt,updatedAt:json\.data\.updatedAt,lossReasonId:json\.data\.lossReasonId\}\)/);
  assert.match(transport,/X-Idempotency-Key/);
  assert.doesNotMatch(transport,/getSupabase|setInterval|setTimeout|localStorage/);
});
