import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const wellbeingChart = fs.readFileSync(new URL('../src/components/AdultWellbeingTrendChart.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/components/ClinicGlobalSettingsPanel.tsx', import.meta.url), 'utf8');
const plan = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260829000000_smoke_corrections_block6.sql', import.meta.url), 'utf8');
const block6Followup = fs.readFileSync(new URL('../supabase/migrations/20260829114500_smoke_corrections_block6_followup.sql', import.meta.url), 'utf8');

// 1) Adult mood/energy uses a dedicated canonical store and a longitudinal 0-100 chart.
assert.match(migration, /create table if not exists public\.patient_wellbeing_checkins/);
assert.match(migration, /metric_kind in \('mood', 'energy'\)/);
assert.match(migration, /metric_value between 0 and 100/);
assert.match(migration, /unique \(clinic_id, patient_id, metric_kind, local_date\)/);
assert.match(block6Followup, /drop constraint %I/);
assert.match(block6Followup, /array\['clinic_id','patient_id','metric_kind','local_date'\]::text\[\]/);
assert.match(block6Followup, /revoke update, delete on table public\.patient_wellbeing_checkins from service_role/);
assert.match(block6Followup, /grant select, insert on table public\.patient_wellbeing_checkins to service_role/);
assert.match(block6Followup, /with legacy_wellbeing as/);
assert.match(block6Followup, /from public\.history history_row/);
assert.match(block6Followup, /on conflict \(id\) do nothing/);
assert.doesNotMatch(block6Followup, /delete from public\.history|update public\.history/, 'legacy wellbeing backfill must not mutate history');
assert.match(server, /app\.post\('\/api\/patient\/self\/wellbeing-checkins'/);
assert.match(server, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/);
assert.match(server, /app\.get\(\s*'\/api\/patients\/:patientId\/wellbeing-checkins'/);
assert.match(dataService, /savePatientSelfWellbeingCheckin/);
assert.match(dataService, /clientEventId: payload\.clientEventId \|\| crypto\.randomUUID\(\)/);
assert.match(app, /savePatientSelfWellbeingCheckin/);
const wellbeingPostRoute = server.slice(
  server.indexOf("app.post('/api/patient/self/wellbeing-checkins'"),
  server.indexOf("app.get(\n    '/api/patients/:patientId/wellbeing-checkins'"),
);
assert.match(wellbeingPostRoute, /patient-wellbeing-event:v2/);
assert.match(wellbeingPostRoute, /\.insert\(row\)/);
assert.doesNotMatch(wellbeingPostRoute, /onConflict: 'clinic_id,patient_id,metric_kind,local_date'/);
assert.doesNotMatch(wellbeingPostRoute, /\.upsert\(/);
assert.match(server, /resolveWellbeingReadWindow/);
assert.match(server, /\.gte\('created_at', readWindow\.fromIso\)/);
const moodCheckinHandler = app.slice(app.indexOf('const handleMoodCheckin'), app.indexOf('const handleCompleteTask'));
assert.doesNotMatch(moodCheckinHandler, /addHistoryItem|setHistory\(/);
assert.match(wellbeingChart, /ReferenceLine y=\{50\}/);
assert.match(wellbeingChart, /gradientUnits="userSpaceOnUse"/);
assert.match(wellbeingChart, /wellbeingPointColor/);
assert.match(wellbeingChart, /#dc2626/);
assert.match(wellbeingChart, /#16a34a/);
assert.match(wellbeingChart, /Não representa diagnóstico nem score clínico global/);
assert.match(wellbeingChart, /type WellbeingPeriod = 'day' \| 'week' \| 'month' \| 'year'/);
assert.match(wellbeingChart, /Dia/);
assert.match(wellbeingChart, /Semana/);
assert.match(wellbeingChart, /Mês/);
assert.match(wellbeingChart, /Ano/);
assert.match(wellbeingChart, /dot=\{renderEmojiDot\}/);
assert.match(wellbeingChart, /Anotação do paciente/);
assert.match(wellbeingChart, /setSelectedPoint\(point\)/);
assert.match(patientDashboard, /AdultWellbeingTrendChart/);
assert.match(patientDashboard, /period=\{wellbeingPeriod\}/);
assert.match(patientDashboard, /onPeriodChange=\{setWellbeingPeriod\}/);
assert.match(patientDashboard, /!isKidsProfile \? \([\s\S]{0,350}<AdultWellbeingTrendChart/);
assert.match(patientDashboard, /\) : \([\s\S]{0,350}<Trophy size=\{16\} \/> Histórico/);
assert.match(patientDetail, /AdultWellbeingTrendChart/);
assert.match(patientDetail, /onPeriodChange=\{setWellbeingPeriod\}/);

// 2) Message badges are based on persisted per-recipient unread state.
assert.match(migration, /create table if not exists public\.patient_message_reads/);
assert.match(migration, /unique \(clinic_id, patient_id, note_id, recipient_user_id\)/);
assert.match(server, /\/api\/patient\/self\/message-reads/);
assert.match(server, /\/api\/patient\/self\/messages\/read/);
assert.match(server, /noteIsReadableByPatient\(note\)/);
assert.match(patientDashboard, /unreadPortalSharedNotes/);
assert.match(patientDashboard, /markPatientSelfMessagesRead/);
assert.match(patientDashboard, /\{unreadPortalSharedNotes\.length\}/);

// 3) Mixed professional+patient identities must choose a context on fresh login.
assert.match(server, /const hasClinicLoginContext = loginAccessContexts\.some/);
assert.match(server, /const hasPatientLoginContext = loginAccessContexts\.some/);
assert.match(server, /const mustChooseLoginMode = !invitedWorkspaceId && hasClinicLoginContext && hasPatientLoginContext/);
assert.match(server, /mustChooseLoginMode\s*\? null/);
assert.match(app, />Cuidar de mim<\/h2>/);
assert.match(app, />Trabalhar<\/h2>/);

// 4) Completion keeps clinical link immutable but does not revalidate it during lifecycle-only UPDATEs.
assert.match(migration, /if tg_op = 'UPDATE' then[\s\S]{0,900}return new;/);
assert.match(migration, /ASSIGNED_TASK_CLINICAL_LINK_IMMUTABLE/);
assert.match(server, /ASSIGNED_TASK_CLINICAL_CONTEXT_CONFLICT/);
assert.match(server, /ASSIGNED_TASK_HISTORY_THERAPIST_UNRESOLVED/);
assert.match(block6Followup, /create or replace function public\.complete_patient_assigned_task_v2/);
assert.match(block6Followup, /v_task_professional_uuid := nullif\(trim\(v_task\.professional_id\), ''\)::uuid/);
assert.match(block6Followup, /exists \(select 1 from auth\.users auth_user where auth_user\.id = v_task_professional_uuid\)/);
assert.match(block6Followup, /select p\.clinic_id, p\.therapist_id[\s\S]{0,180}into v_patient_clinic, v_patient_therapist_id/);
assert.match(block6Followup, /v_history_therapist_id := v_patient_therapist_id/);
assert.match(block6Followup, /v_history_therapist_id,[\s\S]{0,180}coalesce\(v_task\.completed_at/);
assert.doesNotMatch(block6Followup, /v_task\.professional_id,[\s\S]{0,180}coalesce\(v_task\.completed_at/, 'legacy TEXT professional_id must not be written directly into history.therapist_id UUID');

// 5) Patient check-in no longer goes through generic POST /api/history and rejects out-of-range values instead of clamping them.
const moodHandler = app.slice(app.indexOf('const handleMoodCheckin'), app.indexOf('const handleCompleteTask'));
assert.match(moodHandler, /savePatientSelfWellbeingCheckin/);
assert.doesNotMatch(moodHandler, /\/api\/history|addHistoryItem|setHistory\(/);
assert.match(wellbeingPostRoute, /const rawMetricValue = req\.body\?\.metricValue/);
assert.match(wellbeingPostRoute, /!Number\.isFinite\(metricValue\)/);
assert.match(wellbeingPostRoute, /metricValue < 0/);
assert.match(wellbeingPostRoute, /metricValue > 100/);
assert.doesNotMatch(wellbeingPostRoute, /asSafeNumber\(req\.body\?\.metricValue/, 'wellbeing writes must reject invalid values instead of clamping them');

// 6) Council field is a real select, while the flexible registry input remains separate.
const councilStart = settings.indexOf('Conselho / tipo de registro');
const councilEnd = settings.indexOf('Registro profissional / identificação', councilStart);
const councilBlock = settings.slice(councilStart, councilEnd);
assert.match(councilBlock, /<select/);
assert.match(councilBlock, /PROFESSIONAL_COUNCIL_OPTIONS\.map/);
assert.doesNotMatch(councilBlock, /<datalist|list="clinic-professional-council-options"/);
const profilePostRoute = server.slice(server.indexOf("app.post('/api/profile/:userId'"), server.indexOf("app.post('/api/profile/media"));
assert.match(profilePostRoute, /professionalProfileInput\?\.council/);
assert.match(profilePostRoute, /professionalProfileInput\?\.councilType/);
assert.match(profilePostRoute, /professionalProfileInput\?\.councilNumber/);
assert.match(profilePostRoute, /professionalProfileInput\?\.crp/);
const storedCouncilHelpers = server.slice(server.indexOf('function resolveStoredCrp'), server.indexOf('function maskEmail'));
assert.match(storedCouncilHelpers, /metadata\?\.councilNumber/);
assert.match(storedCouncilHelpers, /metadata\?\.council/);
assert.match(storedCouncilHelpers, /metadata\?\.councilType/);

// 7) Draft plans use the parent plan as the clinical activation gate, paused programs can resume, and lifecycle colors stay explicit.
assert.match(plan, /programa\(s\) configurado\(s\) no rascunho · ativação clínica após publicação/);
assert.match(plan, /effectiveProgramStatus/);
assert.match(plan, /Programa configurado no rascunho, ainda sem fase clínica ativa/);
assert.match(plan, /Retomar ensino/);
assert.match(plan, /updateStatus\(program, 'teaching'\)/);
assert.match(plan, /scopeFilterOptions/);
assert.match(plan, /scopeIsPaused[\s\S]{0,260}\['all', 'paused'\]/);
assert.match(plan, /Pausado · retome o ensino para reativar a coleta/);
assert.match(plan, /String\(scope\?\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
assert.match(plan, /!border-l-amber-400/);
assert.match(plan, /!border-l-emerald-500/);
assert.match(plan, /!border-l-red-500/);
assert.match(server, /reason: 'inactive_scope'/);
assert.match(server, /SESSION_THERAPEUTIC_PLAN_NOT_ACTIVE/);
assert.match(server, /Apenas planos ativos podem iniciar sessão/);
assert.match(server, /parentPlanIsDraft/);
assert.match(server, /Programa configurado no rascunho; ativação clínica após publicação do plano/);
assert.match(server, /THERAPEUTIC_PLAN_STATUS_TRANSITION_INVALID/);
assert.match(server, /THERAPEUTIC_PROGRAM_STATUS_TRANSITION_INVALID/);
assert.match(server, /THERAPEUTIC_PROGRAM_PARENT_PLAN_NOT_ACTIVE/);

// 8) Payment failure has a stable seven-day grace and a clear in-product warning.
assert.match(migration, /interval '7 days'/);
assert.match(migration, /create or replace function public\.apply_billing_payment_failure_v1/);
assert.match(migration, /stripe_payment_failed_at = coalesce\(stripe_payment_failed_at, v_failed_at\)/);
assert.match(migration, /stripe_access_block_at = coalesce\(stripe_payment_failed_at, v_failed_at\) \+ interval '7 days'/);
assert.doesNotMatch(migration, /stripe_access_block_at = greatest\(/, 'payment retries must not extend the canonical seven-day deadline');
assert.match(server, /apply_billing_payment_failure_v1/);
assert.doesNotMatch(server.slice(server.indexOf('async function markClinicPaymentFailed'), server.indexOf('async function clearClinicPaymentFailure')), /3 \* 24 \* 60 \* 60/);
assert.match(app, /\['owner', 'admin', 'director', 'biller'\]\.includes\(billingWarningRole\)/);
assert.match(app, /Pagamento pendente:/);
assert.match(app, /período de 7 dias/);
assert.match(app, /Os dados clínicos não são apagados/);

// Security: both new PHI-supporting tables remain server-only behind RLS.
for (const table of ['patient_wellbeing_checkins', 'patient_message_reads']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
}

console.log('smokeCorrectionsBlock6.regression: PASS');
