import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260905163000_conventional_session_lifecycle.sql');
const server = read('server.ts');
const patientDetail = read('src/components/PatientDetailView.tsx');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const monthlyMigration = read('supabase/migrations/20260905101500_monthly_session_patient_billing.sql');

// Start is persisted and repeat-safe.
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('conventional-session:'/);
assert.match(migration, /idempotency_key = p_idempotency_key/);
assert.match(migration, /CONVENTIONAL_SESSION_IDEMPOTENCY_CONFLICT/);
assert.match(migration, /actual_start_at IS NOT NULL[\s\S]*RETURN jsonb_build_object\([\s\S]*idempotentReplay[\s\S]*true/);

// NO_SHOW cannot be bypassed in the conventional lifecycle either.
assert.match(migration, /CONVENTIONAL_SESSION_NO_SHOW_REOPEN_REQUIRED/);
assert.match(server, /APPOINTMENT_NO_SHOW_REOPEN_REQUIRED/);

// Finish writes note + completed appointment inside the same database transaction.
const completeAt = migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_conventional_appointment_session_v1');
assert.ok(completeAt > 0);
const completeBlock = migration.slice(completeAt);
assert.match(completeBlock, /INSERT INTO public\.notes|UPDATE public\.notes/);
assert.match(completeBlock, /UPDATE public\.appointments[\s\S]*status = 'completed'/);
assert.match(completeBlock, /attendance_status = 'ATTENDED'/);
assert.match(completeBlock, /CONVENTIONAL_SESSION_COMPLETED/);
assert.match(completeBlock, /appointment_id/);

// The session evolution is one canonical editable note for this specific source, not a global one-note-per-appointment rule.
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_conventional_session_one_per_appointment_v1[\s\S]*lower\(coalesce\(source, ''\)\) = 'conventional_session'/);
assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[^;]*ON public\.notes \(appointment_id\)\s*;/);

// Retry after completion returns the existing canonical note before any note/appointment mutation.
const completedReplayAt = completeBlock.indexOf("IF lower(coalesce(v_appointment.status, '')) IN ('completed','concluida','concluido')");
const firstOpenFlowNoteMutationAt = Math.min(
  ...['UPDATE public.notes', 'INSERT INTO public.notes'].map((token) => {
    const index = completeBlock.indexOf(token);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  })
);
const completedReplayBlock = completeBlock.slice(completedReplayAt, firstOpenFlowNoteMutationAt);
assert.ok(completedReplayAt >= 0 && completedReplayAt < firstOpenFlowNoteMutationAt);
assert.match(completedReplayBlock, /idempotentReplay[\s\S]*true/);
assert.match(completedReplayBlock, /noteId[\s\S]*v_existing_note\.id/);


// Agenda start keeps using the existing patient-record navigation and supplies the persisted appointment context.
assert.match(coordinator, /setScheduledSessionContext\(sessionAppointment\)/);
assert.match(coordinator, /setScheduledSessionStartKey/);
assert.match(coordinator, /\{ tab: "session" \}/);
assert.match(patientDetail, /dataService\.startConventionalSession\(String\(patient\.id\), appointmentId/);

// Finance remains trigger-driven from the canonical completed appointment.
assert.match(monthlyMigration, /create trigger[\s\S]*sync_monthly_session_billing_for_appointment_v1/i);
assert.match(completeBlock, /UPDATE public\.appointments[\s\S]*status = 'completed'/);
assert.doesNotMatch(completeBlock, /INSERT INTO public\.payments|create_patient_financial_charge|sync_private_appointment_finance/i);

// A 70h+ conventional session is not truncated by a React timer or a fixed duration cap.
assert.match(completeBlock, /extract\(epoch from \(v_ended_at - v_started_at\)\)/);
assert.doesNotMatch(completeBlock, /interval '24 hours'|interval '12 hours'|least\([^\n]*duration/i);

// UI supports reload-resume and does not save on every timer tick.
assert.match(patientDetail, /Sessão em andamento/);
assert.match(patientDetail, /Iniciada às/);
assert.match(patientDetail, /Tempo decorrido/);
assert.doesNotMatch(patientDetail, /setInterval\([\s\S]{0,180}saveConventionalSessionNote/);

console.log('conventionalSessionLifecycle.regression.test.mjs: ok');
