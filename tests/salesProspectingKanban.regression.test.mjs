import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync('supabase/migrations/20261027143000_sales_prospecting_attempts_v1.sql', 'utf8');
const routes = readFileSync('services/salesProspectingRoutes.ts', 'utf8');
const kanban = readFileSync('src/components/CommercialKanban.tsx', 'utf8');
const dashboard = readFileSync('src/components/CommercialDashboard.tsx', 'utf8');
const superAdmin = readFileSync('src/components/SuperAdminDashboard.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

test('sales migration uses balanced PL/pgSQL bodies with a transactional wrapper', () => {
  assert.equal((sql.match(/\$\$/g) || []).length, 6);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /set local lock_timeout = '5s'/);
});

test('sales attempts stay private behind server authority and MFA middleware', () => {
  assert.match(routes, /checkAuth, checkPlatformAdmin/);
  assert.match(routes, /record_sales_prospecting_attempt_v1/);
  assert.match(routes, /mark_sales_prospecting_lead_lost_v1/);
  assert.match(sql, /revoke all on public\.sales_prospecting_attempts from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.record_sales_prospecting_attempt_v1\([^;]+to service_role;/s);
  assert.doesNotMatch(sql, /to authenticated;/i);
});

test('a database row lock serializes each attempt and a request key deduplicates it', () => {
  assert.match(sql, /where id = p_lead_id and deleted_at is null for update;/i);
  assert.match(sql, /idempotency_key text not null unique/);
  assert.match(sql, /where idempotency_key = p_action_key/);
  assert.match(sql, /IDEMPOTENCY_CONFLICT/);
});

test('no channel exceeds five, and the tenth failed attempt marks only untouched leads lost', () => {
  assert.match(sql, /v_phone >= 5/);
  assert.match(sql, /v_whatsapp >= 5/);
  assert.match(sql, /if v_total = 10 and not v_reached and v_lead.status = 'new' and v_lead.last_contact_at is null/);
  assert.match(sql, /set status='lost', lost_at=v_at/);
  assert.match(sql, /'ten_unsuccessful_attempts'/);
  assert.match(sql, /CONVERTED_LEAD_CANNOT_BE_LOST/);
  assert.match(sql, /DECISOR_ALREADY_CONTACTED/);
});

test('clicking a prospecting button persists before updating UI and supports manual lost', () => {
  assert.match(kanban, /\/prospecting-attempts/);
  assert.match(kanban, /\/mark-lost/);
  assert.match(kanban, /crypto\.randomUUID\(\)/);
  assert.match(kanban, /onLeadPatch\(lead\.id, \{ status: json\.data\.status/);
  assert.match(kanban, /overflow-x-auto/);
  assert.match(kanban, /draggable/);
  assert.match(superAdmin, /<CommercialKanban/);
  assert.match(superAdmin, /onLeadPatch=/);
});

test('dashboard separates decision-maker conversations from mere attempts', () => {
  assert.match(dashboard, /outcome === 'decisor_spoken'/);
  assert.match(dashboard, /America\/Sao_Paulo/);
  assert.match(dashboard, /Ligação WhatsApp/);
  assert.match(dashboard, /Taxa por lead abordado/);
});

// This must be green before the feature is released. A missing wiring call
// blocks merge rather than silently shipping unusable Kanban actions.
test('server mounts secure modular routes before startup', () => {
  assert.match(server, /registerSalesProspectingRoutes\(app\s*,/);
});
