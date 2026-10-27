import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync('supabase/migrations/20261027143000_sales_prospecting_attempts_v1.sql', 'utf8');
const routes = readFileSync('services/salesProspectingRoutes.ts', 'utf8');
const kanban = readFileSync('src/components/CommercialKanban.tsx', 'utf8');
const dashboard = readFileSync('src/components/CommercialDashboard.tsx', 'utf8');
const superAdmin = readFileSync('src/components/SuperAdminDashboard.tsx', 'utf8');
const bridge = readFileSync('services/helpCenterRoutes.ts', 'utf8');

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
  assert.match(kanban, /onLeadPatch\(lead\.id,\{status:json\.data\.status/);
  assert.match(kanban, /overflow-x-auto/);
  assert.match(kanban, /draggable/);
  assert.match(superAdmin, /<CommercialKanban/);
  assert.match(superAdmin, /onLeadPatch=/);
});

test('dashboard separates decision-maker conversations from mere attempts', () => {
  assert.match(dashboard, /sales\/prospecting\/analytics/);
  assert.match(dashboard, /Horários em Brasília/);
  assert.match(dashboard, /Ligação WhatsApp/);
  assert.match(dashboard, /Taxa de contato/);
});

test('modular routes are registered by the existing backend startup module', () => {
  assert.match(bridge, /registerSalesProspectingRoutes\(app, \{ supabase, checkAuth \}\)/);
  assert.match(bridge, /import \{ registerSalesProspectingRoutes \} from '.\/salesProspectingRoutes'/);
});

test('isolated bridge does not bypass Super Admin MFA and database authority', () => {
  assert.match(routes, /\.from\('platform_admins'\)/);
  assert.match(routes, /\.eq\('active', true\)/);
  assert.match(routes, /user\?\.mfaVerified !== true/);
  assert.match(routes, /mfaMethod, 20/);
  assert.match(routes, /PLATFORM_ADMIN_MFA_REQUIRED/);
});

const layoutSql = readFileSync('supabase/migrations/20261027185000_sales_kanban_custom_columns_analytics_v1.sql','utf8');

test('configurable columns and audited movements are durable, private and atomic',()=>{
  assert.equal((layoutSql.match(/\$\$/g)||[]).length, 6);
  assert.match(layoutSql,/sales_kanban_columns/);
  assert.match(layoutSql,/sales_kanban_placements/);
  assert.match(layoutSql,/sales_kanban_movements/);
  assert.match(layoutSql,/move_sales_kanban_lead_v1/);
  assert.match(layoutSql,/for update;/);
  assert.match(layoutSql,/PAYMENT_REQUIRED_FOR_CONVERSION/);
  assert.match(layoutSql,/revoke all on public\.sales_kanban_columns/);
  assert.match(layoutSql,/grant execute on function public\.move_sales_kanban_lead_v1[\s\S]*to service_role;/);
  assert.doesNotMatch(layoutSql,/to authenticated;/i);
});

test('full-width Kanban supports custom titles, colors, ordering, deletion, drawer and batch fetching',()=>{
  assert.match(kanban,/min-h-0 min-w-0 flex-1 flex flex-col/);
  assert.match(kanban,/Navegar horizontalmente no Kanban/);
  assert.match(kanban,/Editar colunas/);
  assert.match(kanban,/type="color"/);
  assert.match(kanban,/Adicionar coluna/);
  assert.match(kanban,/Excluir etapa personalizada/);
  assert.match(kanban,/onDragStart/);
  assert.match(kanban,/onDrop/);
  assert.match(kanban,/onOpenLead/);
  assert.match(kanban,/Carregar mais /);
  assert.match(kanban,/\/kanban\/leads\//);
  assert.match(routes,/salesGuard = \[checkAuth, checkPlatformAdmin\]/);
  assert.match(routes,/sales_kanban_columns/);
  assert.match(routes,/order_sales_kanban_columns_v1/);
});

test('DRE contains a separate, rich analytical dashboard with database aggregates',()=>{
  assert.match(superAdmin,/financialView === 'sales'/);
  assert.match(superAdmin,/<CommercialDashboard/);
  assert.match(superAdmin,/activeTab === 'leads' && commercialView === 'kanban'/);
  assert.match(dashboard,/Atividade comercial diária/);
  assert.match(dashboard,/Distribuição por hora do dia/);
  assert.match(dashboard,/Eficiência por faixa horária/);
  assert.match(dashboard,/Volume por dia da semana/);
  assert.match(dashboard,/Comparativo de canais/);
  assert.match(dashboard,/Em qual tentativa houve contato/);
  assert.match(dashboard,/Distribuição da base por etapa/);
  assert.match(layoutSql,/sales_prospecting_analytics_v1/);
  assert.match(layoutSql,/America\/Sao_Paulo/);
});
