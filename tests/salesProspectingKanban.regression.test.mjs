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

test('each channel remains capped at five; manual loss stays protected', () => {
  assert.match(sql, /v_phone >= 5/);
  assert.match(sql, /v_whatsapp >= 5/);
  assert.match(sql, /CONVERTED_LEAD_CANNOT_BE_LOST/);
  assert.match(sql, /DECISOR_ALREADY_CONTACTED/);
});


test('clicking a prospecting button persists before updating UI and supports manual lost', () => {
  assert.match(kanban, /\/prospecting-attempt-time/);
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

const crudSql = readFileSync('supabase/migrations/20261027193000_sales_kanban_opportunity_crud_v1.sql','utf8');
const layoutSql = readFileSync('supabase/migrations/20261027185000_sales_kanban_custom_columns_analytics_v1.sql','utf8');
const guardSql=readFileSync('supabase/migrations/20261027194500_sales_prospecting_business_day_guard_v1.sql','utf8');


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
  assert.match(kanban,/className="min-w-0 flex-1 flex flex-col gap-3"/);
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

test('owner-only opportunity batch/CRUD uses server authority and atomic DB functions',()=>{
  assert.match(routes,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities', \.\.\.salesGuard/);
  assert.match(routes,/app\.patch\('\/api\/owner\/sales\/kanban\/opportunities\/:leadId', \.\.\.salesGuard/);
  assert.match(routes,/app\.delete\('\/api\/owner\/sales\/kanban\/opportunities\/:leadId', \.\.\.salesGuard/);
  assert.match(crudSql,/public\.create_sales_kanban_opportunities_v1/);
  assert.match(crudSql,/public\.update_sales_kanban_opportunity_v1/);
  assert.match(crudSql,/public\.delete_sales_kanban_opportunity_v1/);
  assert.match(crudSql,/PHONE_ALREADY_EXISTS/);
  assert.match(crudSql,/DUPLICATE_IN_BATCH/);
  assert.match(crudSql,/idempotency_key text primary key/);
  assert.match(crudSql,/for update;/i);
  assert.match(crudSql,/sales_kanban_creation_batches enable row level security/);
  assert.match(crudSql,/revoke all on function public\.create_sales_kanban_opportunities_v1/);
  assert.match(crudSql,/contact_consent_at drop not null/);
  assert.match(crudSql,/owner_manual_no_consent/);
  assert.match(crudSql,/deleted_at=clock_timestamp\(\)/);
  assert.match(crudSql,/status not in \('cancelled','expired'\)/);
});

test('Kanban supports batch entry, edit/save, confirmed soft delete and immediate updates',()=>{
  assert.match(kanban,/Nova oportunidade/);
  assert.match(kanban,/Salvar oportunidades/);
  assert.match(kanban,/Salvar alterações/);
  assert.match(kanban,/Excluir oportunidade/);
  assert.match(kanban,/onLeadsCreated\(json\.leads/);
  assert.match(kanban,/onLeadDeleted\(lead\.id\)/);
  assert.match(superAdmin,/onLeadsCreated=/);
  assert.match(superAdmin,/onLeadDeleted=/);
});

test('phone and WhatsApp cards are counters only, and loss needs explicit owner confirmation',()=>{
  assert.doesNotMatch(kanban,/wa\.me|href=\{'tel:'/);
  assert.match(kanban,/Contabilizar operadora/);
  assert.match(kanban,/Contabilizar WhatsApp/);
  assert.match(kanban,/recordAttempt\(lead,'phone','no_decisor'\)/);
  assert.match(kanban,/recordAttempt\(lead,'whatsapp_call','no_decisor'\)/);
  assert.match(kanban,/window\.confirm\('Foram registradas 10 tentativas/);
  assert.match(crudSql,/needsLossDecision/);
  assert.doesNotMatch(crudSql,/prospecting-auto-lost/);
});

test('business day guard enforces local weekday/office hours and one attempt per date',()=>{
  assert.match(guardSql,/extract\(isodow from v_at at time zone 'America\/Sao_Paulo'\) not between 1 and 5/);
  assert.match(guardSql,/time '09:00'/);
  assert.match(guardSql,/time '17:30'/);
  assert.match(guardSql,/PROSPECTING_ALREADY_TODAY/);
  assert.match(guardSql,/PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.match(routes,/message.includes\('PROSPECTING_ALREADY_TODAY'\)/);
  assert.match(kanban,/nextSalesCadenceSlots/);
  assert.match(kanban,/setAttemptDialog/);
});

test('Super Admin sidebar stays fixed on desktop and uses an accessible mobile hamburger',()=>{
  assert.match(superAdmin,/const \[mobileMenuOpen, setMobileMenuOpen\] = useState\(false\)/);
  assert.match(superAdmin,/aria-label="Abrir menu de navegação"/);
  assert.match(superAdmin,/aria-expanded=\{mobileMenuOpen\}/);
  assert.match(superAdmin,/aria-controls="super-admin-navigation"/);
  assert.match(superAdmin,/id="super-admin-navigation"/);
  assert.match(superAdmin,/fixed inset-y-0 left-0 z-50/);
  assert.match(superAdmin,/compactDesktopMenu \? ' md:w-\[66px\]' : ' md:w-72'/);
  assert.match(superAdmin,/md:ml-\[66px\]/);
  assert.match(superAdmin,/md:ml-72 md:p-8/);
  assert.match(superAdmin,/className="sticky top-0 z-30[^"]*md:hidden"/);
  assert.match(superAdmin,/compactDesktopMenu \? 'md:hidden' : ''/);
  assert.match(superAdmin,/onClick=\{\(\) => selectAdminTab\('leads'\)\}/);
  assert.match(superAdmin,/onClick=\{closeMobileMenu\}/);
  assert.match(superAdmin,/if \(mobileMenuOpen\) closeMobileMenu\(\)/);
  assert.match(superAdmin,/mobileMenuCloseRef.current\?\.focus\(\)/);
  assert.match(superAdmin,/event.key === 'Escape'/);
  assert.match(superAdmin,/mobileMenuTriggerRef.current\?\.focus\(\)/);
  assert.doesNotMatch(superAdmin,/h-screen sticky top-0 flex flex-col overflow-x-hidden/);
});

test('Kanban page scrolls vertically without clipping cards while keeping horizontal column navigation',()=>{
  const mainClass = superAdmin.match(/<main className=\{compactDesktopMenu\s*\? '([^']+)'/)?.[1];
  assert.ok(mainClass, 'Super Admin Kanban main class exists');
  assert.match(mainClass,/min-h-\[calc\(100dvh-3\.5rem\)\]/);
  assert.match(mainClass,/md:min-h-screen/);
  assert.doesNotMatch(mainClass,/(?:^|\s)(?:h-screen|md:h-screen|overflow-hidden)(?:\s|$)/);
  assert.match(kanban,/ref=\{scrollRef\} className="min-w-0 overflow-x-auto pb-2"/);
  assert.match(kanban,/className="flex min-h-\[380px\] w-max min-w-full gap-2\.5"/);
  assert.match(kanban,/className="flex-1 space-y-2 p-2"/);
  assert.doesNotMatch(kanban,/ref=\{scrollRef\} className="[^"]*overflow-y-hidden/);
  assert.match(superAdmin,/fixed inset-y-0 left-0 z-50/);
  assert.match(kanban,/Navegar horizontalmente no Kanban/);
});

const contactSql=readFileSync('supabase/migrations/20261028181000_sales_decisor_contact_followup_v1.sql','utf8');

test('conversation success uses explicitly saved Brazilian date/time instead of click time',()=>{
  assert.match(kanban,/brazilInputToIso\(input\)/);
  assert.match(kanban,/type="datetime-local" value=\{spokenAtDraft\}/);
  assert.match(kanban,/Salvar contato com decisor/);
  assert.match(kanban,/Salvar alteração/);
  assert.match(kanban,/setAttempts\(old=>attempt/);
  assert.match(kanban,/onLeadPatch\(lead\.id,\{status:json\.data\.status/);
  assert.match(routes,/app\.put\('\/api\/owner\/sales\/leads\/:leadId\/decisor-contact'/);
  assert.match(routes,/save_sales_decisor_contact_v1/);
});

test('conversation edit is locked, audited, idempotent and protected from manipulation',()=>{
  assert.equal((contactSql.match(/\$\$/g)||[]).length,4);
  assert.match(contactSql,/p_attempt_id is not null then/);
  assert.match(contactSql,/outcome='decisor_spoken' for update/);
  assert.match(contactSql,/where id=p_lead_id and deleted_at is null for update/);
  assert.match(contactSql,/v_attempt\.channel<>p_channel/);
  assert.match(contactSql,/PROSPECTING_ALREADY_TODAY/);
  assert.match(contactSql,/PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.match(contactSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(contactSql,/decisor_time_corrected/);
  assert.match(contactSql,/not exists\(select 1 from public\.platform_admins/);
  assert.match(contactSql,/grant execute on function public\.save_sales_decisor_contact_v1\([\s\S]*to service_role;/);
  assert.doesNotMatch(contactSql,/grant execute on function[^;]*to (?:anon|authenticated);/);
});

test('return date/time is stored as owner CRM metadata without notifications',()=>{
  assert.match(kanban,/Próximo retorno de contato/);
  assert.match(kanban,/Salvar retorno/);
  assert.match(kanban,/Cancelar retorno/);
  assert.match(routes,/save_sales_contact_followup_v1/);
  assert.match(routes,/eq\('actor_user_id',actorId\)/);
  assert.match(contactSql,/unique\(lead_id,actor_user_id\)/);
  assert.match(contactSql,/sales_contact_followups enable row level security/);
  assert.match(contactSql,/followup_canceled/);
  assert.match(contactSql,/followup_saved/);
  assert.doesNotMatch(contactSql,/notification_jobs|push_subscriptions|sendNotification|cron|queue/i);
  assert.doesNotMatch(routes,/callback-push-subscribe|save_sales_callback_reminder_v1/);
  assert.doesNotMatch(kanban,/Ativar notificações de retorno|Antecedência da notificação/);
});


const messageSql=readFileSync('supabase/migrations/20261028194500_sales_whatsapp_text_contact_channel_v1.sql','utf8');

test('WhatsApp text has an explicit selectable channel and persists only through Save',()=>{
  assert.match(kanban,/label:'Mensagem WhatsApp'/);
  assert.match(kanban,/aria-pressed=\{spokenChannel===item.channel\}/);
  assert.match(kanban,/Salvar contato com decisor/);
  assert.match(kanban,/Histórico de ligações e mensagens/);
  assert.match(kanban,/a.channel==='whatsapp_call'\?'Ligação WhatsApp':'Mensagem WhatsApp'/);
  assert.match(kanban,/Decisor por mensagem/);
  assert.match(kanban,/setAttempts\(old=>attempt/);
  assert.match(routes,/!\['phone', 'whatsapp_call'\]\.includes\(channel\)/);
  assert.match(routes,/!\['phone','whatsapp_call','whatsapp_message'\]\.includes\(channel\)/);
});

test('text contact never increments phone or WhatsApp call counters and preserves future follow-ups',()=>{
  const counts=kanban.split('const countByLead = useMemo(() => {')[1].split('const leadCounts = ')[0];
  assert.match(counts,/if \(attempt\.channel === 'phone'\) r\.phone\+\+/);
  assert.match(counts,/else if \(attempt\.channel === 'whatsapp_call'\) r\.whatsapp\+\+/);
  assert.doesNotMatch(counts,/else r\.whatsapp\+\+/);
  assert.match(counts,/r\.spokenVia = attempt\.channel/);
  assert.match(kanban,/selectedCounts\.spokenVia==='whatsapp_message'/);
  assert.match(kanban,/Próximo retorno de contato/);
});

test('text contact is success-only, auditable, idempotent, independently validated on the server',()=>{
  assert.equal((messageSql.match(/\$\$/g)||[]).length,4);
  assert.match(messageSql,/channel in \('phone','whatsapp_call','whatsapp_message'\)/);
  assert.match(messageSql,/channel <> 'whatsapp_message' or outcome = 'decisor_spoken'/);
  assert.match(messageSql,/if p_channel <> 'whatsapp_message' and \(/);
  assert.equal((messageSql.match(/if p_channel <> 'whatsapp_message' and exists\(/g)||[]).length,2);
  assert.match(messageSql,/p_channel <> 'whatsapp_message' and v_count>=5/);
  assert.match(messageSql,/where id=p_lead_id and deleted_at is null for update/);
  assert.match(messageSql,/DECISOR_ALREADY_CONTACTED/);
  assert.match(messageSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(messageSql,/decisor_time_corrected/);
  assert.match(messageSql,/from public,anon,authenticated/);
  assert.match(messageSql,/to service_role/);
  assert.doesNotMatch(messageSql,/notification_jobs|push_subscriptions|cron\.schedule/i);
});

test('analytics keep calls and messages separate, including contacted-lead conversion rate',()=>{
  assert.match(messageSql,/'messageContacts'/);
  assert.match(messageSql,/'callContactedLeads'/);
  assert.match(messageSql,/'totalCalls',\(select count\(\*\) from scoped where channel<>'whatsapp_message'\)/);
  assert.match(messageSql,/'successfulCalls',\(select count\(\*\) from scoped where outcome='decisor_spoken' and channel<>'whatsapp_message'\)/);
  assert.match(dashboard,/Por mensagem WhatsApp/);
  assert.match(dashboard,/overview\?\.callContactedLeads\?\?overview\?\.contactedLeads/);
  assert.match(dashboard,/Mensagens não entram nos indicadores de quantidade e efetividade das ligações/);
});


const attemptTimeSql=readFileSync('supabase/migrations/20261028201000_sales_attempt_actual_time_v1.sql','utf8');
test('all call attempt buttons open the editable timestamp dialog and only Save writes',()=>{
  assert.match(kanban,/const recordAttempt =/);
  assert.match(kanban,/setAttemptDialog\(\{leadId:lead\.id,channel,localAt/);
  assert.match(kanban,/aria-label=\{attemptDialog\.attemptId\?'Editar data e hora da tentativa'/);
  assert.match(kanban,/type="datetime-local" value=\{attemptDialog\.localAt\}/);
  assert.match(kanban,/Usar horário atual/);
  assert.match(kanban,/Salvar tentativa/);
  assert.match(kanban,/onClick=\{\(\)=>recordAttempt\(lead,'phone','no_decisor'\)\}/);
  assert.match(kanban,/onClick=\{\(\)=>recordAttempt\(lead,'whatsapp_call','no_decisor'\)\}/);
  assert.match(kanban,/onClick=\{\(\)=>recordAttempt\(selected,'phone','no_decisor'\)\}/);
  assert.match(kanban,/onClick=\{\(\)=>recordAttempt\(selected,'whatsapp_call','no_decisor'\)\}/);
  assert.doesNotMatch(kanban,/body:JSON\.stringify\(\{channel,outcome\}\)/);
});
test('historical failed calls can be corrected, not re-counted or reclassified',()=>{
  assert.match(kanban,/attemptId:a\.id,localAt:brazilLocalInput\(a\.occurred_at\)/);
  assert.match(kanban,/setAttempts\(old=>draft\.attemptId/);
  assert.match(routes,/app\.put\('\/api\/owner\/sales\/leads\/:leadId\/prospecting-attempt-time'/);
  assert.match(routes,/save_sales_prospecting_attempt_time_v1/);
  assert.match(attemptTimeSql,/outcome='no_decisor' for update/);
  assert.match(attemptTimeSql,/update public\.sales_prospecting_attempts set occurred_at=p_occurred_at/);
  assert.match(attemptTimeSql,/attempt_time_corrected/);
});
test('actual attempt time is checked under a lead lock with MFA and idempotency',()=>{
  assert.equal((attemptTimeSql.match(/\$\$/g)||[]).length,2);
  assert.match(attemptTimeSql,/platform_admins where user_id=p_actor_user_id and active=true/);
  assert.match(attemptTimeSql,/where id=p_lead_id and deleted_at is null for update/);
  assert.match(attemptTimeSql,/PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.match(attemptTimeSql,/PROSPECTING_ALREADY_TODAY/);
  assert.match(attemptTimeSql,/v_phone>=5/);
  assert.match(attemptTimeSql,/v_whatsapp>=5/);
  assert.match(attemptTimeSql,/needsLossDecision/);
  assert.match(attemptTimeSql,/idempotency_key=p_action_key/);
  assert.match(attemptTimeSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(attemptTimeSql,/revoke all on function public\.save_sales_prospecting_attempt_time_v1/);
  assert.match(attemptTimeSql,/to service_role/);
  assert.doesNotMatch(attemptTimeSql,/notification_jobs|push_subscriptions|cron\.schedule/);
});
