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

// 1) Adult mood/energy uses a dedicated canonical store and a longitudinal 0-100 chart.
assert.match(migration, /create table if not exists public\.patient_wellbeing_checkins/);
assert.match(migration, /metric_kind in \('mood', 'energy'\)/);
assert.match(migration, /metric_value between 0 and 100/);
assert.match(migration, /unique \(clinic_id, patient_id, metric_kind, local_date\)/);
assert.match(server, /app\.post\('\/api\/patient\/self\/wellbeing-checkins'/);
assert.match(server, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/);
assert.match(server, /app\.get\(\s*'\/api\/patients\/:patientId\/wellbeing-checkins'/);
assert.match(dataService, /savePatientSelfWellbeingCheckin/);
assert.match(app, /savePatientSelfWellbeingCheckin/);
assert.doesNotMatch(app.slice(app.indexOf('const handleMoodCheckin'), app.indexOf('const handleCompleteTask')), /addHistoryItem/);
assert.match(wellbeingChart, /ReferenceLine y=\{50\}/);
assert.match(wellbeingChart, /gradientUnits="userSpaceOnUse"/);
assert.match(wellbeingChart, /wellbeingPointColor/);
assert.match(wellbeingChart, /#dc2626/);
assert.match(wellbeingChart, /#16a34a/);
assert.match(wellbeingChart, /Não representa diagnóstico nem score clínico global/);
assert.match(patientDashboard, /AdultWellbeingTrendChart/);
assert.match(patientDetail, /AdultWellbeingTrendChart/);

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

// 5) Patient check-in no longer goes through generic POST /api/history.
const moodHandler = app.slice(app.indexOf('const handleMoodCheckin'), app.indexOf('const handleCompleteTask'));
assert.match(moodHandler, /savePatientSelfWellbeingCheckin/);
assert.doesNotMatch(moodHandler, /\/api\/history|addHistoryItem/);

// 6) Council field is a real select, while the flexible registry input remains separate.
const councilStart = settings.indexOf('Conselho / tipo de registro');
const councilEnd = settings.indexOf('Registro profissional / identificação', councilStart);
const councilBlock = settings.slice(councilStart, councilEnd);
assert.match(councilBlock, /<select/);
assert.match(councilBlock, /PROFESSIONAL_COUNCIL_OPTIONS\.map/);
assert.doesNotMatch(councilBlock, /<datalist|list="clinic-professional-council-options"/);

// 7) Draft plans do not visually claim active teaching/maintenance states.
assert.match(plan, /programa\(s\) configurado\(s\) no rascunho · ativação clínica após publicação/);
assert.match(plan, /String\(scope\?\.status \|\| 'draft'\)\.toLowerCase\(\) === 'draft'/);

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
