import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync('supabase/migrations/20261027143000_sales_prospecting_attempts_v1.sql', 'utf8');
const routes = readFileSync('services/salesProspectingRoutes.ts', 'utf8');
const creationRoutes = readFileSync('services/salesKanbanOpportunityCreationRoutes.ts', 'utf8');
const creationTransport = readFileSync('src/services/salesKanbanOpportunityCreation.ts', 'utf8');
const activityRoutes = readFileSync('services/salesProspectingActivityRoutes.ts', 'utf8');
const movementRoutes = readFileSync('services/salesKanbanMovementRoutes.ts', 'utf8');
const activityTransport = readFileSync('src/services/salesKanbanActivity.ts', 'utf8');
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
  assert.match(activityRoutes, /record_sales_prospecting_attempt_v1/);
  // Existing manual-loss route now requires a chosen reason and uses one atomic
  // server-side RPC; the older function remains only for legacy compatibility.
  assert.match(activityRoutes, /mark_sales_lead_lost_with_reason_v1/);
  assert.match(activityRoutes, /const reasonId = sanitizeString\(req\.body\?\.reasonId,120\)/);
  assert.match(movementRoutes, /target\.data\?\.kind==='lost'/);
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
  assert.match(activityTransport, /\/prospecting-attempt-time/);
  assert.match(activityTransport, /\/mark-lost/);
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
  assert.doesNotMatch(kanban,/Editar colunas/);
  assert.match(kanban,/aria-label=\{'Editar '\+col\.title\}/);
  assert.match(kanban,/type="color"/);
  assert.match(kanban,/Adicionar coluna/);
  assert.match(kanban,/Excluir etapa personalizada/);
  assert.match(kanban,/onDragStart/);
  assert.match(kanban,/onDrop/);
  assert.match(kanban,/onOpenLead/);
  assert.match(kanban,/Carregar mais /);
  assert.match(activityTransport,/\/kanban\/leads\//);
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
  assert.match(creationRoutes,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities', \.\.\.salesGuard/);
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
  assert.doesNotMatch(kanban,/window\.confirm\('Foram registradas 10 tentativas/);
  assert.match(crudSql,/needsLossDecision/);
  assert.doesNotMatch(crudSql,/prospecting-auto-lost/);
});

test('business day guard enforces local weekday/office hours and one attempt per date',()=>{
  assert.match(guardSql,/extract\(isodow from v_at at time zone 'America\/Sao_Paulo'\) not between 1 and 5/);
  assert.match(guardSql,/time '09:00'/);
  assert.match(guardSql,/time '17:30'/);
  assert.match(guardSql,/PROSPECTING_ALREADY_TODAY/);
  assert.match(guardSql,/PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.match(activityRoutes,/message.includes\('PROSPECTING_ALREADY_TODAY'\)/);
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
  assert.match(activityRoutes,/app\.put\('\/api\/owner\/sales\/leads\/:leadId\/decisor-contact'/);
  assert.match(activityRoutes,/save_sales_decisor_contact_v2/);
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
  assert.match(activityRoutes,/save_sales_contact_followup_v1/);
  assert.match(activityRoutes,/eq\('actor_user_id',actorId\)/);
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
  assert.match(activityRoutes,/!\['phone', 'whatsapp_call'\]\.includes\(channel\)/);
  assert.match(activityRoutes,/!\['phone','whatsapp_call','whatsapp_message'\]\.includes\(channel\)/);
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
  assert.match(activityRoutes,/app\.put\('\/api\/owner\/sales\/leads\/:leadId\/prospecting-attempt-time'/);
  assert.match(activityRoutes,/save_sales_prospecting_attempt_time_v2/);
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


const scriptsSql=readFileSync('supabase/migrations/20261028220000_sales_script_versions_analytics_v1.sql','utf8');
const compatSql=readFileSync('supabase/migrations/20261028222000_sales_script_legacy_attempt_compat_v1.sql','utf8');
const scriptRoutes=readFileSync('services/salesScriptRoutes.ts','utf8');
const scriptPanel=readFileSync('src/components/CommercialScriptsPanel.tsx','utf8');

test('script version library supports manual text, external maps and private file assets',()=>{
  assert.match(scriptPanel,/Texto manual/);
  assert.match(scriptPanel,/Link de mapa mental ou site/);
  assert.match(scriptPanel,/Arquivo \/ imagem \(privado\)/);
  assert.match(scriptPanel,/uploadToSignedUrl/);
  assert.match(scriptRoutes,/createSignedUploadUrl/);
  assert.match(scriptRoutes,/createSignedUrl/);
  assert.match(scriptRoutes,/4194304/);
  assert.match(scriptRoutes,/const guards=\[checkAuth,checkPlatformAdmin\]/);
  assert.match(scriptsSql,/sales_script_source_shape/);
  assert.match(scriptsSql,/sales-script-assets-private/);
  assert.match(scriptsSql,/sales_script_versions_unique_name_version_idx/);
  assert.doesNotMatch(scriptRoutes,/supabase\.from\('patient/);
});

test('only Save attributes a script and decision-maker interest; edits preserve historical version',()=>{
  assert.match(kanban,/Scripts \/ Testes A-B/);
  assert.match(kanban,/scriptSelect\(attemptDialog\.scriptVersionId/);
  assert.match(kanban,/scriptSelect\(selectedScriptId/);
  assert.match(kanban,/scriptVersionId,contactResult:resolvedResult/);
  assert.match(kanban,/Demonstrou interesse/);
  assert.match(kanban,/Não demonstrou interesse/);
  assert.match(kanban,/scriptLabel\(a\.script_version_id\)/);
  assert.match(activityRoutes,/save_sales_prospecting_attempt_time_v2/);
  assert.match(activityRoutes,/save_sales_decisor_contact_v2/);
  assert.match(scriptsSql,/SCRIPT_ATTRIBUTION_IMMUTABLE/);
  assert.match(scriptsSql,/script_version_id uuid references public\.sales_script_versions\(id\)/);
  assert.match(compatSql,/new\.contact_result:='no_answer'/);
  assert.doesNotMatch(compatSql,/notification_jobs|push_subscriptions|cronService/);
});

test('script comparisons separate contactability and interested decisions without historical guesswork',()=>{
  assert.match(scriptsSql,/count\(a\.id\) filter\(where a\.contact_result='no_answer'\)/);
  assert.match(scriptsSql,/count\(a\.id\) filter\(where a\.contact_result='not_interested'\)/);
  assert.match(scriptsSql,/count\(a\.id\) filter\(where a\.contact_result='interested'\)/);
  assert.match(scriptPanel,/pct\(m\.decision_conversations,m\.total_attempts\)/);
  assert.match(scriptPanel,/pct\(m\.interested,m\.decision_conversations\)/);
  assert.match(scriptPanel,/pode manter várias vigentes/);
  assert.match(scriptPanel,/Não incluem históricos sem fluxo/);
  assert.match(scriptsSql,/is_active boolean not null default true/);
});


const acquisitionSql=readFileSync('supabase/migrations/20261028233000_sales_acquisition_multiselect_v1.sql','utf8');
const acquisitionApi=readFileSync('services/salesAcquisitionRoutes.ts','utf8');
const acquisitionPanel=readFileSync('src/components/CommercialAcquisitionPanel.tsx','utf8');
test('global acquisition catalog seeds event, paid traffic and referral with owner-only isolation',()=>{
  assert.match(acquisitionSql,/values\('Evento'\),\('Tráfego pago'\),\('Indicação'\)/);
  assert.match(acquisitionSql,/sales_acquisition_channels_name_uidx/);
  assert.match(acquisitionSql,/sales_lead_acquisition_channels\(/);
  assert.match(acquisitionSql,/primary key\(lead_id,channel_id\)/);
  assert.match(acquisitionSql,/enable row level security/g);
  assert.match(acquisitionSql,/from public,anon,authenticated/);
  assert.match(acquisitionSql,/to service_role;/);
  assert.match(acquisitionApi,/const guard=\[checkAuth,checkPlatformAdmin\]/);
  assert.match(routes,/registerSalesAcquisitionRoutes\(app/);
});
test('every card supports acquisition multiselect without F5 and serialized Save authority',()=>{
  assert.match(kanban,/Selecionar canais de aquisição para/);
  assert.match(kanban,/Canais de aquisição · selecionar/);
  assert.match(kanban,/checked=\{inlineChannelIds\.includes\(channel\.id\)\}/);
  assert.match(kanban,/type="checkbox" checked=\{checked\}/);
  assert.match(kanban,/Salvar canais/);
  assert.match(kanban,/setAcquisitionByLead\(old=>/);
  assert.match(kanban,/acquisition\/board\?leadIds=/);
  assert.match(acquisitionApi,/save_sales_lead_acquisition_channels_v1/);
  assert.match(acquisitionSql,/where id=p_lead_id and deleted_at is null for update/);
  assert.match(acquisitionSql,/acquisition_channels_saved/);
  assert.match(acquisitionSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(acquisitionSql,/ACQUISITION_CHANNEL_UNAVAILABLE/);
});
test('channel comparison uses lead-based counts and discloses multi-touch attribution',()=>{
  assert.match(acquisitionPanel,/Atribuição múltipla/);
  assert.match(acquisitionPanel,/Compare taxas, não some os totais entre canais/);
  assert.match(acquisitionPanel,/rate\(m\.converted,m\.opportunities\)/);
  assert.match(acquisitionPanel,/Cadastrar canal/);
  assert.match(acquisitionPanel,/Desativar/);
  assert.match(acquisitionSql,/count\(l\.id\)::int as opportunities/);
  assert.match(acquisitionSql,/l\.status='converted'/);
  assert.match(acquisitionSql,/a\.contact_result='interested'/);
  assert.doesNotMatch(acquisitionSql,/notification_jobs|push_subscriptions|cron\.schedule/);
});


// Pure calendar and visual helpers are imported to test their real behavior,
// not only matching strings in the React source.
const {brazilDateKey,followupBucket,matchesFollowup,progressColor,progressWidth,followupFilters}=
  await import('../src/utils/salesKanbanFollowupVisuals.mjs');

test('return today follows Brazil calendar across UTC midnight and distinguishes overdue appointments',()=>{
  assert.equal(brazilDateKey('2026-10-29T02:59:59Z'),'2026-10-28');
  assert.equal(brazilDateKey('2026-10-29T03:00:00Z'),'2026-10-29');
  const today='2026-10-28';
  const callback={status:'scheduled',contact_due_at:'2026-10-28T10:30:00-03:00'};
  assert.equal(followupBucket(callback,today),'today');
  assert.equal(matchesFollowup(callback,'today',today,'contact_started'),true);
  assert.equal(matchesFollowup(callback,'overdue',today,'contact_started'),false);
  assert.equal(matchesFollowup({status:'scheduled',contact_due_at:'2026-10-27T16:00:00-03:00'},'overdue',today,'new'),true);
  assert.equal(matchesFollowup(callback,'today',today,'converted'),false);
  assert.equal(matchesFollowup(callback,'all',today,'converted'),true);
});

test('follow-up date filters handle the coming week, canceled and absent returns without guessing',()=>{
  const base='2026-10-28';
  const in7={status:'scheduled',contact_due_at:'2026-11-04T09:00:00-03:00'};
  const after7={status:'scheduled',contact_due_at:'2026-11-05T09:00:00-03:00'};
  assert.equal(matchesFollowup(in7,'next7',base,'new'),true);
  assert.equal(matchesFollowup(after7,'next7',base,'new'),false);
  assert.equal(matchesFollowup(after7,'future',base,'new'),true);
  assert.equal(matchesFollowup(in7,'today',base,'new'),false);
  assert.equal(matchesFollowup(null,'none',base,'new'),true);
  assert.equal(matchesFollowup({status:'canceled',contact_due_at:'2026-10-28T10:00:00Z'},'none',base,'new'),true);
  assert.equal(matchesFollowup(null,'none',base,'lost'),false);
  assert.deepEqual(followupFilters.map(x=>x.value),['all','today','overdue','next7','future','none']);
});

test('call progress moves monotonically from green to red and never exceeds ten phone attempts',()=>{
  const hues=Array.from({length:11},(_,n)=>{
    const value=/^hsl\((\d+) 78% 42%\)$/.exec(progressColor(n));
    assert.ok(value,'valid progress color for '+n);
    return Number(value[1]);
  });
  assert.equal(hues[0],138);
  assert.equal(hues[10],0);
  assert.ok(hues.every((value,index)=>index===0||hues[index-1]>value));
  assert.equal(progressColor(15),progressColor(10));
  assert.equal(progressWidth(0),'0%');
  assert.equal(progressWidth(4),'40%');
  assert.equal(progressWidth(10),'100%');
  assert.equal(progressWidth(17),'100%');
  assert.equal(progressWidth(-2),'0%');
});

test('Kanban shows shared filters in each column, same-day badge and identical progress on card and drawer',()=>{
  assert.match(kanban,/Filtrar retornos da coluna/);
  assert.match(kanban,/Filtrar todos os retornos/);
  assert.match(kanban,/Retornar hoje/);
  assert.match(kanban,/Retorno atrasado/);
  assert.match(kanban,/matchReturnFilter\(l,columnFilter\)/);
  assert.match(kanban,/setFollowups\(old=>/);
  assert.match(kanban,/progressColor\(total\)/);
  assert.match(kanban,/progressColor\(selectedCounts\.phone\+selectedCounts\.whatsapp\)/);
  assert.match(kanban,/progressWidth\(total\)/);
  assert.match(kanban,/progressWidth\(selectedCounts\.phone\+selectedCounts\.whatsapp\)/);
  assert.match(kanban,/remaining>0&&<p className="w-full/);
  assert.doesNotMatch(kanban,/style=\{\{width:\(total\*10\)\+'%',backgroundColor:col.color\}\}/);
});


const {agendaMatches,compareAgendaPriority,resolveAgendaMoment,isCallDueToday}=
  await import('../src/utils/salesKanbanFollowupVisuals.mjs');

test('manual appointments are authoritative over cadenced suggestions and canceled dates fall back',()=>{
  const scheduled={status:'scheduled',contact_due_at:'2026-10-28T10:00:00-03:00'};
  const suggestion=new Date('2026-10-28T15:00:00-03:00');
  assert.deepEqual(resolveAgendaMoment(scheduled,suggestion),{
    at:'2026-10-28T13:00:00.000Z',source:'scheduled',
  });
  assert.deepEqual(resolveAgendaMoment({status:'canceled',contact_due_at:'2026-10-28T10:00:00-03:00'},suggestion),{
    at:'2026-10-28T18:00:00.000Z',source:'suggested',
  });
  assert.equal(resolveAgendaMoment(scheduled,suggestion,false),null);
  assert.equal(resolveAgendaMoment(null,null),null);
});

test('agenda date, São Paulo hour interval and source selection filter next callbacks',()=>{
  const now=Date.parse('2026-10-28T09:30:00-03:00');
  const manually={at:'2026-10-28T13:45:00.000Z',source:'scheduled'};
  const suggested={at:'2026-10-28T14:45:00.000Z',source:'suggested'};
  assert.equal(agendaMatches(manually,{mode:'today',now,source:'scheduled'}),true);
  assert.equal(agendaMatches(manually,{mode:'today',now,source:'suggested'}),false);
  assert.equal(agendaMatches(manually,{mode:'next2h',now}),true);
  assert.equal(agendaMatches(suggested,{mode:'next2h',now}),false);
  assert.equal(agendaMatches(manually,{mode:'date',date:'2026-10-28',from:'10:00',to:'11:00',now}),true);
  assert.equal(agendaMatches(manually,{mode:'date',date:'2026-10-29',now}),false);
  assert.equal(agendaMatches(suggested,{mode:'today',from:'11:00',to:'12:00',now}),true);
  assert.equal(agendaMatches(suggested,{mode:'today',from:'09:00',to:'10:00',now}),false);
  assert.equal(agendaMatches(null,{mode:'priority',now}),false);
  assert.equal(agendaMatches(null,{mode:'all',now}),true);
});

test('urgent returns surface before tomorrow and next hours, with stable actual-date preference',()=>{
  const now=Date.parse('2026-10-28T11:00:00-03:00');
  const old={at:'2026-10-27T13:00:00.000Z',source:'scheduled'};
  const overdue={at:'2026-10-28T12:30:00.000Z',source:'scheduled'};
  const upcoming={at:'2026-10-28T15:00:00.000Z',source:'suggested'};
  const later={at:'2026-10-29T13:00:00.000Z',source:'scheduled'};
  const values=[upcoming,later,overdue,old].sort((a,b)=>compareAgendaPriority(a,b,now));
  assert.deepEqual(values,[old,overdue,upcoming,later]);
  assert.ok(compareAgendaPriority({at:upcoming.at,source:'scheduled'},upcoming,now)<0);
  assert.equal(agendaMatches(old,{mode:'overdue',now}),true);
  assert.equal(agendaMatches(upcoming,{mode:'overdue',now}),false);
});

test('Kanban integrates date time and source options while reusing saved followups and cadence',()=>{
  assert.match(kanban,/Agenda priorizada de contatos/);
  assert.match(kanban,/Próximas 2 horas/);
  assert.match(kanban,/Data específica do retorno/);
  assert.match(kanban,/Horário inicial do retorno/);
  assert.match(kanban,/Horário final do retorno/);
  assert.match(kanban,/Somente cadastrados/);
  assert.match(kanban,/Somente sugeridos/);
  assert.match(kanban,/resolveAgendaMoment\(followups\[lead\.id\],suggestion,eligible\)/);
  assert.match(kanban,/nextSalesCadenceSlots\(attemptsByLead\.get\(lead\.id\)\|\|\[\],new Date\(clockNow\)\)/);
  assert.match(kanban,/filterAgendaAndSort\(allCards\.filter/);
  assert.match(kanban,/compareAgendaPriority\(agendaByLead\.get/);
  assert.match(kanban,/setInterval\(update,60000\)/);
  assert.match(kanban,/Sugestões não são agendamentos e não enviam notificações/);
});


const drilldownSql=readFileSync('supabase/migrations/20261028235000_sales_prospecting_chart_drilldown_v1.sql','utf8');
test('every commercial funnel stage can open the exact paginated underlying lead list',()=>{
  assert.match(dashboard,/status:x.status,leads:x.leads/);
  assert.match(dashboard,/onClick=\{\(entry:any\)=>showLeads\('stage',String\(entry\?\.payload\?\.status/);
  assert.match(dashboard,/onClick=\{\(entry:any\)=>showLeads\('stage'/);
  assert.match(dashboard,/stages\.map\(stage=><button/);
  assert.match(dashboard,/Leads identificados/);
  assert.match(dashboard,/clinic_name/);
  assert.match(dashboard,/converted_clinic_id/);
  assert.match(dashboard,/converted_user_id/);
  assert.match(dashboard,/Próximos leads/);
  assert.match(dashboard,/Ver leads <ChevronRight/);
});

test('chart point drilldowns support all commercial dimensions and distinguish attempts from distinct leads',()=>{
  for(const dimension of ['daily','cumulative','hour','weekday','channel','attempt','stage','overview'])
    assert.match(drilldownSql,new RegExp("'"+dimension+"'"));
  assert.match(dashboard,/const clickedPoint=/);
  assert.match(dashboard,/onClick=\{\(entry:any\)=>showLeads\('channel'.*'failures'/);
  assert.match(dashboard,/onClick=\{\(entry:any\)=>showLeads\('channel'.*'conversations'/);
  assert.match(dashboard,/O agregado inclui/);
  assert.match(dashboard,/matching_events/);
  assert.match(dashboard,/matchingEvents/);
  assert.match(dashboard,/Registros telefônicos são eventos/);
  assert.match(dashboard,/const query=new URLSearchParams/);
});

test('commercial drilldown enforces owner MFA, window bounds, paging and SQL execute privileges',()=>{
  assert.match(routes,/app\.get\('\/api\/owner\/sales\/prospecting\/analytics\/drilldown', \.\.\.salesGuard/);
  assert.match(routes,/sales_prospecting_drilldown_v1/);
  assert.match(routes,/p_limit:25/);
  assert.match(drilldownSql,/platform_admins where user_id=p_actor_user_id and active=true/);
  assert.match(drilldownSql,/p_offset>100000/);
  assert.match(drilldownSql,/p_limit>50/);
  assert.match(drilldownSql,/public\.sales_leads l where l\.deleted_at is null/);
  assert.match(drilldownSql,/a\.channel in\('phone','whatsapp_call'\)/);
  assert.match(drilldownSql,/revoke all on function public\.sales_prospecting_drilldown_v1/);
  assert.match(drilldownSql,/from public,anon,authenticated/);
  assert.match(drilldownSql,/to service_role/);
  assert.doesNotMatch(drilldownSql,/notification_jobs|patient_sessions|public\.stripe/i);
});


test('optional script/channel failures cannot blank the canonical Kanban or overwrite saved origins',()=>{
  assert.match(kanban,/const scriptsPromise=request\('\/api\/owner\/sales\/scripts\/active'\)/);
  assert.match(kanban,/\.catch\(\(\)=>\(\{data:\{versions:\[\]\},failed:true\}\)\)/);
  assert.match(kanban,/request\('\/api\/owner\/sales\/acquisition\/board\?leadIds='\+q\)/);
  assert.match(kanban,/\.catch\(\(\)=>\(\{data:\{channels:\[\],links:\[\]\},failed:true\}\)\)/);
  assert.match(kanban,/const \[board,history,acquisitionResult\] = await Promise\.all/);
  assert.match(kanban,/setAcquisitionCatalogUnavailable\(pages\.some\(page=>page\.acquisitionFailed\)\)/);
  assert.match(kanban,/setScriptCatalogUnavailable\(scriptResult\.failed\)/);
  assert.match(kanban,/if\(savingAcquisition\|\|acquisitionCatalogUnavailable\)/);
  assert.match(kanban,/if\(!dialog\|\|savingAcquisition\|\|acquisitionCatalogUnavailable\)return/);
  assert.match(kanban,/scripts? indisponíveis|Scripts indisponíveis/);
});

test('legacy success timestamp correction preserves null script and historical outcome',()=>{
  assert.match(kanban,/const scriptVersionId=attempt\?attempt\.script_version_id\?\?null:selectedScriptId\|\|null/);
  assert.match(kanban,/const resolvedResult=attempt\?attempt\.contact_result\?\?null:contactResult\|\|null/);
  assert.match(kanban,/const scriptVersionId=original\s*\? original\.script_version_id\?\?null\s*: draft\.scriptVersionId\|\|null/);
  assert.match(kanban,/if\(!attempt&&scriptCatalogUnavailable\)/);
  assert.match(kanban,/if\(!draft\.attemptId&&scriptCatalogUnavailable\)/);
  assert.match(kanban,/setScriptCatalogUnavailable\(false\)/);
  assert.match(kanban,/setAcquisitionCatalogUnavailable\(false\)/);
});


const visibleAnalyticsSql=readFileSync('supabase/migrations/20261028235800_sales_commercial_visible_leads_analytics_v1.sql','utf8');

test('deleted Kanban opportunities disappear from every CRM chart without deleting canonical conversions',()=>{
  assert.match(visibleAnalyticsSql,/CREATE OR REPLACE FUNCTION public\.sales_prospecting_analytics_v1/i);
  assert.match(visibleAnalyticsSql,/CREATE OR REPLACE FUNCTION public\.sales_prospecting_drilldown_v1/i);
  assert.match(visibleAnalyticsSql,/public\.sales_kanban_opportunity_overrides hidden where hidden\.lead_id=/);
  assert.match(visibleAnalyticsSql,/hidden\.hidden_at is not null/);
  // All stage totals, overview counts, attempts over time and lead drilldown
  // must share the same visibility contract.
  assert.ok((visibleAnalyticsSql.match(/hidden\.hidden_at is not null/g)||[]).length>=15);
  assert.match(visibleAnalyticsSql,/from public\.sales_leads visible_lead where visible_lead\.deleted_at is null/);
  assert.match(visibleAnalyticsSql,/from public\.sales_prospecting_attempts event/);
  assert.match(visibleAnalyticsSql,/where l\.deleted_at is null and not exists/);
});

test('hidden leads are excluded from script and acquisition conversion metrics, without history mutation',()=>{
  assert.match(visibleAnalyticsSql,/CREATE OR REPLACE FUNCTION public\.sales_acquisition_channel_metrics_v1/i);
  assert.match(visibleAnalyticsSql,/CREATE OR REPLACE FUNCTION public\.sales_script_metrics_v1/i);
  assert.match(visibleAnalyticsSql,/left join public\.sales_leads l on l\.id=sel\.lead_id and l\.deleted_at is null and not exists/);
  assert.match(visibleAnalyticsSql,/left join public\.sales_prospecting_attempts a on a\.script_version_id=s\.id and exists/);
  assert.doesNotMatch(visibleAnalyticsSql,/\b(?:update|delete from|truncate)\s+(?:public\.)?(?:sales_leads|sales_offers|sales_checkout_links|sales_prospecting_attempts)/i);
  assert.match(visibleAnalyticsSql,/revoke all on function public\.sales_prospecting_analytics_v1\(integer\) from public,anon,authenticated/);
  assert.match(visibleAnalyticsSql,/grant execute on function public\.sales_prospecting_drilldown_v1/);
});

test('commercial UI states only Kanban-visible leads count, and hidden clients retain payment history',()=>{
  assert.match(dashboard,/Oportunidades visíveis no Kanban/);
  assert.match(dashboard,/Oportunidades removidas do Kanban não entram nesses indicadores/);
  assert.match(dashboard,/vínculos históricos de clientes e pagamentos são preservados/);
  assert.match(kanban,/hidden:Boolean\(item\.hidden_at\)/);
  assert.match(kanban,/\.filter\(lead => !overrides\[lead\.id\]\?\.hidden\)/);
});


const anyStageCallsSql=readFileSync('supabase/migrations/20261029001000_sales_calls_any_kanban_stage_v1.sql','utf8');

test('operator and WhatsApp calls are never disabled by column, stage, or prior decision-maker contact',()=>{
  assert.match(kanban,/const callEnabled=\(_lead:Lead,_ch:'phone'\|'whatsapp_call'\)=>!busyLead/);
  assert.match(kanban,/disabled=\{!callEnabled\(lead,'phone'\)\}/);
  assert.match(kanban,/disabled=\{!callEnabled\(lead,'whatsapp_call'\)\}/);
  assert.match(kanban,/disabled=\{!callEnabled\(selected,'phone'\)\}/);
  assert.match(kanban,/disabled=\{!callEnabled\(selected,'whatsapp_call'\)\}/);
  assert.doesNotMatch(kanban,/selected\.status\)\&\&<div className="mt-3 space-y-2">/);
  assert.doesNotMatch(kanban,/selectedCounts\.phone>=5|selectedCounts\.whatsapp>=5/);
  assert.doesNotMatch(kanban,/Operadora \{a\.phone\}\/5|WhatsApp \{a\.whatsapp\}\/5/);
  assert.match(kanban,/Ten calls is a visual cadence reference, not a hard stop/);
});

test('new attempt, actual-time and conversation RPCs accept all funnel stages and unlimited calls while retaining safety guards',()=>{
  for(const fn of ['record_sales_prospecting_attempt_v1','save_sales_prospecting_attempt_time_v1',
    'save_sales_prospecting_attempt_time_v2','save_sales_decisor_contact_v2'])
    assert.match(anyStageCallsSql,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+fn));
  assert.doesNotMatch(anyStageCallsSql,/DECISOR_ALREADY_CONTACTED|CHANNEL_ATTEMPT_LIMIT/);
  assert.doesNotMatch(anyStageCallsSql,/v_lead\.status in \('lost','archived','converted'\)/);
  assert.match(anyStageCallsSql,/v_lead\.do_not_contact/);
  assert.match(anyStageCallsSql,/sales_kanban_opportunity_overrides h/);
  assert.match(anyStageCallsSql,/PROSPECTING_ALREADY_TODAY/);
  assert.match(anyStageCallsSql,/PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.match(anyStageCallsSql,/sales_lead_events/);
  assert.match(anyStageCallsSql,/revoke all on function public\.save_sales_decisor_contact_v2/);
  assert.doesNotMatch(anyStageCallsSql,/delete from public\.sales_leads|drop table|truncate/i);
});


const repeatCallsSql=readFileSync('supabase/migrations/20261029003000_sales_contacts_multiple_same_day_v1.sql','utf8');

test('same-day real phone/WhatsApp attempts and conversations do not hit artificial daily or office-hour quota',()=>{
  assert.match(repeatCallsSql,/CREATE OR REPLACE FUNCTION public\.save_sales_prospecting_attempt_time_v2/i);
  assert.match(repeatCallsSql,/CREATE OR REPLACE FUNCTION public\.save_sales_decisor_contact_v2/i);
  assert.doesNotMatch(repeatCallsSql,/PROSPECTING_ALREADY_TODAY|PROSPECTING_OUTSIDE_BUSINESS_HOURS|CHANNEL_ATTEMPT_LIMIT/);
  assert.match(repeatCallsSql,/idempotency_key=p_action_key/);
  assert.match(repeatCallsSql,/where id=p_lead_id and deleted_at is null for update/);
  assert.match(repeatCallsSql,/v_lead\.do_not_contact/);
  assert.match(repeatCallsSql,/h\.hidden_at is not null/);
  assert.match(repeatCallsSql,/p_script_version_id/);
  assert.match(repeatCallsSql,/from public,anon,authenticated/);
  assert.match(repeatCallsSql,/to service_role/);
});

test('call/save UI now labels cadence as advisory and reports only real remaining 409 conflicts',()=>{
  assert.match(kanban,/inclusive se houve outra ligação no mesmo dia/);
  assert.match(kanban,/A cadência é apenas sugestão/);
  assert.match(kanban,/Horários sugeridos não bloqueiam registros reais/);
  assert.doesNotMatch(kanban,/É permitida uma ligação por dia/);
  assert.match(activityRoutes,/Oportunidade removida ou com preferência explícita de não receber contatos/);
  assert.match(activityRoutes,/Esta tentativa já foi salva com outros dados/);
  assert.match(activityRoutes,/Este contato já foi salvo com outros dados/);
  const attemptRoute=activityRoutes.slice(activityRoutes.indexOf("app.put('/api/owner/sales/leads/:leadId/prospecting-attempt-time'"),activityRoutes.indexOf("app.put('/api/owner/sales/leads/:leadId/decisor-contact'"));
  const contactRoute=activityRoutes.slice(activityRoutes.indexOf("app.put('/api/owner/sales/leads/:leadId/decisor-contact'"),activityRoutes.indexOf("app.put('/api/owner/sales/leads/:leadId/followup'"));
  assert.doesNotMatch(attemptRoute,/PROSPECTING_ALREADY_TODAY|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
  assert.doesNotMatch(contactRoute,/PROSPECTING_ALREADY_TODAY|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_OUTSIDE_BUSINESS_HOURS/);
});


const bulkCreationSql=readFileSync('supabase/migrations/20261028235930_sales_bulk_acquisition_atomic_v1.sql','utf8');
const bulkExistingSql=readFileSync('supabase/migrations/20261028235940_sales_acquisition_multicard_atomic_v1.sql','utf8');
const acquisitionRoutes=readFileSync('services/salesAcquisitionRoutes.ts','utf8');

test('bulk lead import preselects any subset and assigns different active acquisition channels by contact',()=>{
  assert.match(kanban,/Selecionar todos/);
  assert.match(kanban,/Desmarcar todos/);
  assert.match(kanban,/Aplicar canais aos \{bulkSelectedRows\.length\} selecionados/);
  assert.match(kanban,/Editar canais deste contato/);
  assert.match(kanban,/phones\.map\(\(_,index\)=>bulkChannelsByRow\[index\]\|\|\[\]\)/);
  // Existing phone-only callers retain the same exact two-field request body;
  // the new manual form can opt into per-phone identification atomically.
  assert.match(creationTransport,/detailsByPhone \? \{phones,channelsByPhone,detailsByPhone\} : \{phones,channelsByPhone\}/);
  assert.match(kanban,/for\(const item of json\.leads\|\|\[\]\)next\[item\.id\]=item\.channelIds\|\|\[\]/);
  assert.match(creationRoutes,/create_sales_kanban_opportunities_v2/);
  assert.match(creationRoutes,/channelsByPhone\.length!==phones\.length/);
  assert.match(bulkCreationSql,/create_sales_kanban_opportunities_v1\(p_phones,p_actor_id,p_action_key\)/);
  assert.match(bulkCreationSql,/sales_lead_acquisition_channels\(lead_id,channel_id,assigned_by\)/);
  assert.match(bulkCreationSql,/IDEMPOTENCY_CONFLICT/);
  assert.match(bulkCreationSql,/ACQUISITION_CHANNEL_UNAVAILABLE/);
});

test('existing cards can be chosen in a group with add-preserving or explicit replace semantics',()=>{
  assert.match(kanban,/Selecionar vários cards/);
  assert.match(kanban,/Incluir na classificação em lote/);
  assert.match(kanban,/Selecionar até 100 visíveis/);
  assert.match(kanban,/Substituir os canais atuais \(em vez de adicionar\)/);
  assert.match(kanban,/\[\.\.\.new Set\(\[\.\.\.\(acquisitionByLead\[leadId\]\|\|\[\]\),\.\.\.bulkExistingChannels\]\)\]/);
  assert.match(kanban,/request\('\/api\/owner\/sales\/acquisition\/leads\/bulk'/);
  assert.match(kanban,/for\(const item of result\.selections\|\|\[\]\)next\[item\.leadId\]=item\.channelIds\|\|\[\]/);
  assert.match(acquisitionRoutes,/app\.put\('\/api\/owner\/sales\/acquisition\/leads\/bulk',\.\.\.guard/);
  assert.match(bulkExistingSql,/save_sales_lead_acquisition_channels_v1\(/);
  assert.match(bulkExistingSql,/DUPLICATE_ACQUISITION_LEAD/);
});

test('bulk mutations are SQL atomic, audited, private and block partial invalid selections',()=>{
  for(const contents of [bulkCreationSql,bulkExistingSql]){
    assert.match(contents,/^begin;/m);
    assert.match(contents,/^commit;/m);
    assert.match(contents,/enable row level security/);
    assert.match(contents,/revoke all on[\s\S]*?from public,anon,authenticated/);
    assert.match(contents,/to service_role/);
    assert.match(contents,/platform_admins/);
    assert.match(contents,/pg_advisory_xact_lock/);
    assert.doesNotMatch(contents,/notification_jobs|patient_sessions|public\.stripe|update public\.sales_leads set/i);
  }
  assert.match(bulkExistingSql,/order by value->>'leadId'/);
  assert.match(bulkCreationSql,/bulk_acquisition_assigned/);
});

test('lead feedback is isolated by card id so a new drawer never inherits a prior action confirmation',()=>{
  assert.match(kanban,/const \[cardFeedback,setCardFeedback\]/);
  assert.match(kanban,/const feedbackFor=\(leadId:string\)=>cardFeedback\?\.leadId===leadId\?cardFeedback:null/);
  assert.match(kanban,/const openCard=\(leadId:string\)=>\{/);
  assert.match(kanban,/setError\(null\);setInfo\(null\);setCardFeedback\(null\)/);
  assert.match(kanban,/onClick=\{\(\)=>openCard\(lead\.id\)\}/);
  assert.match(kanban,/feedbackFor\(selected\.id\)\?\.info/);
  assert.match(kanban,/feedbackFor\(selected\.id\)\?\.error/);
  assert.match(kanban,/cardInfo\(draft\.leadId,/);
  assert.match(kanban,/cardInfo\(dialog\.leadId,/);
  assert.match(kanban,/cardError\(lead\.id,/);
  assert.doesNotMatch(kanban,/selected&&<div[\s\S]*?\{info&&<p className="rounded-lg bg-emerald-50/);
});

test('smart follow-up queue highlights only active reachable due or overdue leads',()=>{
  const today='2026-10-29';
  const due={at:'2026-10-29T13:30:00.000Z',source:'suggested'};
  const overdue={at:'2026-10-27T13:30:00.000Z',source:'suggested'};
  const future={at:'2026-10-30T13:30:00.000Z',source:'suggested'};
  assert.equal(isCallDueToday(due,today,'new',true,false),true);
  assert.equal(isCallDueToday(overdue,today,'contact_started',true,false),true);
  assert.equal(isCallDueToday(future,today,'new',true,false),false);
  assert.equal(isCallDueToday(due,today,'converted',true,false),false);
  assert.equal(isCallDueToday(due,today,'lost',true,false),false);
  assert.equal(isCallDueToday(due,today,'new',false,false),false);
  assert.equal(isCallDueToday(due,today,'new',true,true),false);
  assert.equal(isCallDueToday({...due,source:'scheduled'},today,'new',true,true),true);
  assert.equal(isCallDueToday(overdue,'2026-10-31','new',true,false),false);
});

test('Kanban tags genuinely uncalled leads after loading and exposes a daily phone queue',()=>{
  assert.match(kanban,/const \[historyReady,setHistoryReady\]=useState\(false\)/);
  assert.match(kanban,/setHistoryReady\(true\)/);
  assert.match(kanban,/historyReady&&total===0/);
  assert.match(kanban,/>Novo<\/span>/);
  assert.match(kanban,/aria-label="Filtrar leads para ligar hoje"/);
  assert.match(kanban,/aria-pressed=\{callTodayOnly\}/);
  assert.match(kanban,/<Phone size=\{11\} aria-hidden="true"\/> Ligar hoje/);
  assert.match(kanban,/const callTodayCount=filtered\.filter\(callDueToday\)\.length/);
  assert.match(kanban,/const callFilterPass=\(lead:Lead\)=>!callTodayOnly\|\|callDueToday\(lead\)/);
  assert.match(kanban,/matchReturnFilter\(l,columnFilter\)&&callFilterPass\(l\)/);
  assert.match(kanban,/setCallTodayOnly\(false\)/);
  assert.match(kanban,/Ligação sugerida pendente/);
  assert.doesNotMatch(kanban,/disabled=\{.*canRecordSalesAttemptNow/);
});

test('suggested calls remain read-only and honor historic attempts and actual saved appointments',()=>{
  assert.match(kanban,/nextSalesCadenceSlots\(attemptsByLead\.get\(lead\.id\)\|\|\[\],new Date\(clockNow\)\)\[0\]/);
  assert.match(kanban,/resolveAgendaMoment\(followups\[lead\.id\],suggestion,eligible\)/);
  assert.match(kanban,/Próximas ligações sugeridas — intervalo mínimo de 2 dias/);
  assert.match(kanban,/Não são previsão garantida de atendimento, agendamentos ou notificações/);
  assert.match(kanban,/const callEnabled=\(_lead:Lead,_ch:'phone'\|'whatsapp_call'\)=>!busyLead/);
  assert.doesNotMatch(kanban,/POST.*schedule.*suggestion/);
});


test('Kanban manual refresh reuses the paginated sales endpoint without reloading unrelated owner data', () => {
  assert.match(superAdmin, /const refreshKanbanLeads = async \(\) =>/);
  assert.match(superAdmin, /onRefresh=\{refreshKanbanLeads\}/);
  assert.match(superAdmin, /setLeadRecoveryItems\(result\.data \|\| \[\]\)/);
  assert.match(superAdmin, /setLeadNextPage\(2\)/);
  const leanRefresh = superAdmin.split('const refreshKanbanLeads = async () => {')[1].split('const loadMoreLeads = async () => {')[0];
  assert.doesNotMatch(leanRefresh, /\/api\/owner\/(?:stats|financial-overview|clients|financial-feature-surveys)/);
  assert.doesNotMatch(leanRefresh, /fetchProtocolRequests|fetchDemoSandboxes/);
});

test('Acquisition catalog reuses one fetched result after save, without another catalog request', () => {
  const editor = readFileSync('src/components/CommercialAcquisitionPanel.tsx', 'utf8');
  assert.match(editor, /onChanged:\(channels:Channel\[\]\)=>Promise<void>/);
  assert.match(editor, /return board\.channels\|\|\[\]/);
  assert.match(editor, /onChanged\(await refresh\(\)\)/);
  assert.match(kanban, /if\(channels\)\{[\s\S]*?setAcquisitionChannels\(channels\)/);
});
