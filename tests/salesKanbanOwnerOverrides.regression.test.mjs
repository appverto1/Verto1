import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync('supabase/migrations/20261028115000_sales_kanban_owner_edit_delete_safety.sql','utf8');
const routes = readFileSync('services/salesProspectingRoutes.ts','utf8');
const kanban = readFileSync('src/components/CommercialKanban.tsx','utf8');

test('owner edits preserve canonical customers, offers and billings using a private overlay', () => {
  assert.match(migration,/sales_kanban_opportunity_overrides \(/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.sales_kanban_opportunity_overrides from public, anon, authenticated/);
  assert.match(migration,/grant select,insert,update,delete on public\.sales_kanban_opportunity_overrides to service_role/);
  assert.match(migration,/v_isolated := v_lead\.status='converted'/);
  assert.match(migration,/from public\.sales_offers where lead_id=p_lead_id/);
  assert.match(migration,/normalized_phone=v_phone/);
  assert.match(migration,/exception when unique_violation then/);
  assert.doesNotMatch(migration,/raise exception 'LEAD_LOCKED'/);
});

test('deletion is soft and linked leads are hidden from Kanban only', () => {
  assert.match(migration,/if v_isolated then[\s\S]*insert into public\.sales_kanban_opportunity_overrides\(lead_id,hidden_at,updated_at\)/);
  assert.match(migration,/else\s+update public\.sales_leads set deleted_at=clock_timestamp\(\)/);
  assert.match(migration,/kanban_hide/);
  assert.match(migration,/actor_user_id=p_actor_id/);
  assert.match(migration,/for update;/);
  assert.match(migration,/IDEMPOTENCY_CONFLICT/);
});

test('PATCH and DELETE remain restricted to authenticated platform owner and SQL RPC', () => {
  assert.match(routes,/const salesGuard = \[checkAuth, checkPlatformAdmin\]/);
  assert.match(routes,/app\.patch\('\/api\/owner\/sales\/kanban\/opportunities\/:leadId', \.\.\.salesGuard/);
  assert.match(routes,/app\.delete\('\/api\/owner\/sales\/kanban\/opportunities\/:leadId', \.\.\.salesGuard/);
  assert.match(routes,/update_sales_kanban_opportunity_v1/);
  assert.match(routes,/delete_sales_kanban_opportunity_v1/);
  assert.match(routes,/sales_kanban_opportunity_overrides'\)/);
  assert.match(migration,/grant execute on function public\.update_sales_kanban_opportunity_v1\(uuid,uuid,jsonb,text\) to service_role/);
});

test('read-after-write applies stored overrides, excludes hidden cards and keeps save authoritative', () => {
  assert.match(routes,/overrides:.*|overrides\}/);
  assert.match(routes,/extra\.data\?\.hidden_at/);
  assert.match(kanban,/setOverrides\(nextOverrides\)/);
  assert.match(kanban,/filter\(lead => !overrides\[lead\.id\]\?\.hidden\)/);
  assert.match(kanban,/onLeadPatch\(selected\.id,json\.lead\)/);
  assert.match(kanban,/onLeadDeleted\(lead\.id\)/);
  assert.match(kanban,/Salvar alterações/);
});
